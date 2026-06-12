"use client";

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  appendCaptionDelta,
  detectInputLanguage,
  getClientSecret,
  getErrorMessage,
  getFocusTargetLanguage,
  isOutputTranscriptDoneEvent,
} from "../lib/caption-text";
import { DISPLAY_CAPTION_MAX_CHARS, INPUT_TRANSCRIPT_TARGET, TARGETS } from "../lib/constants";
import type { CaptionMap, DisplayMode, RealtimeEvent, Status, TargetLanguage } from "../lib/types";

const RECONNECT_DELAYS_MS = [1000, 3000];

type UseOpenAiTranslationParams = {
  statusRef: MutableRefObject<Status>;
  setRealtimeStatus: (nextStatus: Status) => void;
  setError: (message: string) => void;
  setCaptions: Dispatch<SetStateAction<CaptionMap>>;
  setTranslationCaptions: Dispatch<SetStateAction<CaptionMap>>;
  openaiApiKeyRef: MutableRefObject<string>;
  sourceLanguageRef: MutableRefObject<TargetLanguage>;
  lastInputLanguageRef: MutableRefObject<TargetLanguage>;
  getAccessCodeHeaders: () => Record<string, string>;
  appendSessionTranscriptText: (language: TargetLanguage, delta: string, reason?: "final" | "partial") => string;
  appendFocusTranslationDelta: (targetLanguage: TargetLanguage, delta: string) => void;
  finalizeCurrentFocusSegments: () => void;
  trackSourceLanguage: (inputLanguage: TargetLanguage, delta: string) => void;
  refreshAudioInputs: () => Promise<void>;
  cleanupRealtimeRef: MutableRefObject<() => void>;
};

export function useOpenAiTranslation({
  statusRef,
  setRealtimeStatus,
  setError,
  setCaptions,
  setTranslationCaptions,
  openaiApiKeyRef,
  sourceLanguageRef,
  lastInputLanguageRef,
  getAccessCodeHeaders,
  appendSessionTranscriptText,
  appendFocusTranslationDelta,
  finalizeCurrentFocusSegments,
  trackSourceLanguage,
  refreshAudioInputs,
  cleanupRealtimeRef,
}: UseOpenAiTranslationParams) {
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Partial<Record<TargetLanguage, RTCPeerConnection>>>({});
  const dataChannelsRef = useRef<Partial<Record<TargetLanguage, RTCDataChannel>>>({});
  const connectedTargetsRef = useRef<Set<TargetLanguage>>(new Set());
  const activeTargetsRef = useRef<TargetLanguage[]>([]);
  const inputTranscriptTargetRef = useRef<TargetLanguage>(INPUT_TRANSCRIPT_TARGET);
  const reconnectAttemptsRef = useRef<Partial<Record<TargetLanguage, number>>>({});
  const reconnectTimersRef = useRef<Partial<Record<TargetLanguage, number>>>({});
  const sessionEpochRef = useRef(0);
  const singleSwitchInFlightRef = useRef(false);
  const connectTranslationRef = useRef<(targetLanguage: TargetLanguage, sourceStream: MediaStream) => Promise<void>>(
    async () => {}
  );
  const handleConnectionFailureRef = useRef<(targetLanguage: TargetLanguage) => void>(() => {});

  const createClientSecret = useCallback(
    async (targetLanguage: TargetLanguage) => {
      const createSessionRequest = () =>
        fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAccessCodeHeaders() },
          body: JSON.stringify({ targetLanguage, openaiApiKey: openaiApiKeyRef.current || undefined }),
        });

      const sessionResponse = await createSessionRequest();
      const sessionText = await sessionResponse.text();
      let sessionData: unknown = {};
      try {
        sessionData = sessionText ? JSON.parse(sessionText) : {};
      } catch {
        sessionData = {};
      }

      if (!sessionResponse.ok) {
        throw new Error(getErrorMessage(sessionData, sessionText || `Failed to create ${targetLanguage} session.`));
      }

      const clientSecret = getClientSecret(sessionData);
      if (!clientSecret) {
        throw new Error(`The ${targetLanguage} session response did not include a client secret.`);
      }

      return clientSecret;
    },
    [getAccessCodeHeaders, openaiApiKeyRef]
  );

  // Closes one target's connection without touching the shared microphone
  // stream, so the other target (or a reconnect attempt) can keep using it.
  const closeTargetConnection = useCallback((targetLanguage: TargetLanguage) => {
    const timer = reconnectTimersRef.current[targetLanguage];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete reconnectTimersRef.current[targetLanguage];
    }

    const channel = dataChannelsRef.current[targetLanguage];
    delete dataChannelsRef.current[targetLanguage];
    channel?.close();

    const peerConnection = peerConnectionsRef.current[targetLanguage];
    delete peerConnectionsRef.current[targetLanguage];
    if (peerConnection) {
      peerConnection.getReceivers().forEach((receiver) => receiver.track?.stop());
      peerConnection.close();
    }

    connectedTargetsRef.current.delete(targetLanguage);
  }, []);

  const handleConnectionFailure = useCallback(
    (targetLanguage: TargetLanguage) => {
      if (statusRef.current === "stopping" || statusRef.current === "idle") return;

      const attempts = reconnectAttemptsRef.current[targetLanguage] ?? 0;
      if (attempts >= RECONNECT_DELAYS_MS.length) {
        setError(`${targetLanguage.toUpperCase()} translation connection ended. Click Start to reconnect.`);
        cleanupRealtimeRef.current();
        setRealtimeStatus("error");
        return;
      }

      reconnectAttemptsRef.current[targetLanguage] = attempts + 1;
      const epoch = sessionEpochRef.current;
      setRealtimeStatus("connecting");
      setError(`${targetLanguage.toUpperCase()} connection lost. Reconnecting...`);
      closeTargetConnection(targetLanguage);

      reconnectTimersRef.current[targetLanguage] = window.setTimeout(() => {
        delete reconnectTimersRef.current[targetLanguage];
        if (epoch !== sessionEpochRef.current) return;
        if (statusRef.current === "stopping" || statusRef.current === "idle" || statusRef.current === "error") return;

        const sourceStream = sourceStreamRef.current;
        if (!sourceStream) return;

        void connectTranslationRef.current(targetLanguage, sourceStream).catch(() => {
          if (epoch !== sessionEpochRef.current) return;
          handleConnectionFailureRef.current(targetLanguage);
        });
      }, RECONNECT_DELAYS_MS[attempts]);
    },
    [cleanupRealtimeRef, closeTargetConnection, setError, setRealtimeStatus, statusRef]
  );

  useEffect(() => {
    handleConnectionFailureRef.current = handleConnectionFailure;
  }, [handleConnectionFailure]);

  const connectTranslation = useCallback(
    async (targetLanguage: TargetLanguage, sourceStream: MediaStream) => {
      const clientSecret = await createClientSecret(targetLanguage);
      const pc = new RTCPeerConnection();
      peerConnectionsRef.current[targetLanguage] = pc;

      pc.onconnectionstatechange = () => {
        if (peerConnectionsRef.current[targetLanguage] !== pc) return;

        if (pc.connectionState === "connected") {
          connectedTargetsRef.current.add(targetLanguage);
          if (reconnectAttemptsRef.current[targetLanguage]) {
            reconnectAttemptsRef.current[targetLanguage] = 0;
            setError("");
          }
          if (connectedTargetsRef.current.size >= activeTargetsRef.current.length) setRealtimeStatus("live");
          return;
        }

        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          if (statusRef.current === "stopping" || statusRef.current === "idle") return;
          connectedTargetsRef.current.delete(targetLanguage);
          handleConnectionFailure(targetLanguage);
        }
      };

      const [audioTrack] = sourceStream.getAudioTracks();
      pc.addTrack(audioTrack, sourceStream);

      const events = pc.createDataChannel(`oai-events-${targetLanguage}`);
      dataChannelsRef.current[targetLanguage] = events;

      events.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data) as RealtimeEvent;

          if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
            appendSessionTranscriptText(targetLanguage, event.delta);
            appendFocusTranslationDelta(targetLanguage, event.delta);
            setTranslationCaptions((previous) => ({
              ...previous,
              [targetLanguage]: appendCaptionDelta(previous[targetLanguage] ?? "", event.delta as string, DISPLAY_CAPTION_MAX_CHARS),
            }));
            setCaptions((previous) => ({
              ...previous,
              [targetLanguage]: appendCaptionDelta(previous[targetLanguage] ?? "", event.delta as string, DISPLAY_CAPTION_MAX_CHARS),
            }));
          }

          if (isOutputTranscriptDoneEvent(event.type) && targetLanguage === getFocusTargetLanguage(sourceLanguageRef.current)) {
            finalizeCurrentFocusSegments();
          }

          if (
            targetLanguage === inputTranscriptTargetRef.current &&
            event.type === "session.input_transcript.delta" &&
            typeof event.delta === "string"
          ) {
            const inputLanguage = detectInputLanguage(event.delta, lastInputLanguageRef.current);
            lastInputLanguageRef.current = inputLanguage;
            trackSourceLanguage(inputLanguage, event.delta);
            appendSessionTranscriptText(inputLanguage, event.delta);
            setCaptions((previous) => ({
              ...previous,
              [inputLanguage]: appendCaptionDelta(previous[inputLanguage] ?? "", event.delta as string, DISPLAY_CAPTION_MAX_CHARS),
            }));
          }

          if (event.type === "error") {
            setError(event.error?.message ?? `${targetLanguage.toUpperCase()} Realtime API error.`);
          }
        } catch {
          // Ignore non-JSON data channel messages.
        }
      };

      const offer = await pc.createOffer();
      if (!offer.sdp) {
        throw new Error("The browser did not create a valid WebRTC offer.");
      }

      await pc.setLocalDescription(offer);

      const createCallRequest = () =>
        fetch("/api/call", {
          method: "POST",
          headers: {
            "Content-Type": "application/sdp",
            "x-client-secret": clientSecret,
            ...getAccessCodeHeaders(),
          },
          body: offer.sdp,
        });

      const sdpResponse = await createCallRequest();
      const sdpText = await sdpResponse.text();
      let sdpErrorData: unknown = {};
      if (!sdpResponse.ok) {
        try {
          sdpErrorData = sdpText ? JSON.parse(sdpText) : {};
        } catch {
          sdpErrorData = {};
        }
      }

      if (!sdpResponse.ok) {
        throw new Error(getErrorMessage(sdpErrorData, sdpText || "Failed to connect OpenAI Realtime call."));
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: sdpText,
      });
    },
    [
      appendFocusTranslationDelta,
      appendSessionTranscriptText,
      createClientSecret,
      finalizeCurrentFocusSegments,
      getAccessCodeHeaders,
      handleConnectionFailure,
      lastInputLanguageRef,
      setCaptions,
      setError,
      setRealtimeStatus,
      setTranslationCaptions,
      sourceLanguageRef,
      statusRef,
      trackSourceLanguage,
    ]
  );

  useEffect(() => {
    connectTranslationRef.current = connectTranslation;
  }, [connectTranslation]);

  const startOpenAiTranslation = useCallback(
    async (audioInputId: string | undefined, displayMode: DisplayMode) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (audioInputId) {
        audioConstraints.deviceId = { exact: audioInputId };
      }

      const sourceStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      sourceStreamRef.current = sourceStream;
      void refreshAudioInputs();

      sessionEpochRef.current += 1;
      reconnectAttemptsRef.current = {};

      // Focus view only displays one translation direction, so a single
      // session halves the per-minute OpenAI cost. Split view keeps both.
      const targets: TargetLanguage[] =
        displayMode === "single"
          ? [getFocusTargetLanguage(sourceLanguageRef.current)]
          : TARGETS.map((target) => target.code);
      activeTargetsRef.current = targets;
      inputTranscriptTargetRef.current = displayMode === "single" ? targets[0] : INPUT_TRANSCRIPT_TARGET;

      await Promise.all(targets.map((target) => connectTranslation(target, sourceStream)));
      setRealtimeStatus("live");
    },
    [connectTranslation, refreshAudioInputs, setRealtimeStatus, sourceLanguageRef]
  );

  // In single-connection (Focus) mode the translation direction follows the
  // detected source language; rebuild the connection when it flips.
  const switchSingleTarget = useCallback(
    async (newSourceLanguage: TargetLanguage) => {
      if (activeTargetsRef.current.length !== 1) return;
      if (statusRef.current !== "live" && statusRef.current !== "connecting") return;
      if (singleSwitchInFlightRef.current) return;

      const sourceStream = sourceStreamRef.current;
      if (!sourceStream) return;

      const newTarget = getFocusTargetLanguage(newSourceLanguage);
      const oldTarget = activeTargetsRef.current[0];
      if (newTarget === oldTarget) return;

      singleSwitchInFlightRef.current = true;
      const epoch = sessionEpochRef.current;
      setRealtimeStatus("connecting");
      closeTargetConnection(oldTarget);
      activeTargetsRef.current = [newTarget];
      inputTranscriptTargetRef.current = newTarget;

      try {
        await connectTranslation(newTarget, sourceStream);
        if (epoch === sessionEpochRef.current) setRealtimeStatus("live");
      } catch (caughtError) {
        if (epoch === sessionEpochRef.current) {
          setError(caughtError instanceof Error ? caughtError.message : "Could not switch translation direction.");
          cleanupRealtimeRef.current();
          setRealtimeStatus("error");
        }
      } finally {
        singleSwitchInFlightRef.current = false;
      }
    },
    [cleanupRealtimeRef, closeTargetConnection, connectTranslation, setError, setRealtimeStatus, statusRef]
  );

  // Swaps the microphone without tearing down connections or the transcript
  // session. Throws if the new device cannot be opened; the old stream keeps
  // running in that case.
  const switchAudioInput = useCallback(async (audioInputId?: string) => {
    const oldStream = sourceStreamRef.current;
    if (!oldStream) return false;

    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (audioInputId) {
      audioConstraints.deviceId = { exact: audioInputId };
    }

    const newStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    const [newTrack] = newStream.getAudioTracks();

    try {
      await Promise.all(
        Object.values(peerConnectionsRef.current).map((peerConnection) => {
          const sender = peerConnection?.getSenders().find((candidate) => candidate.track?.kind === "audio");
          return sender ? sender.replaceTrack(newTrack) : Promise.resolve();
        })
      );
    } catch (caughtError) {
      newStream.getTracks().forEach((track) => track.stop());
      throw caughtError;
    }

    sourceStreamRef.current = newStream;
    oldStream.getTracks().forEach((track) => track.stop());
    return true;
  }, []);

  const cleanupOpenAi = useCallback(() => {
    sessionEpochRef.current += 1;
    singleSwitchInFlightRef.current = false;
    reconnectAttemptsRef.current = {};

    Object.values(reconnectTimersRef.current).forEach((timer) => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
    reconnectTimersRef.current = {};

    Object.values(dataChannelsRef.current).forEach((channel) => channel?.close());
    dataChannelsRef.current = {};

    Object.values(peerConnectionsRef.current).forEach((peerConnection) => {
      peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
      peerConnection?.getReceivers().forEach((receiver) => receiver.track?.stop());
      peerConnection?.close();
    });
    peerConnectionsRef.current = {};
    connectedTargetsRef.current.clear();
    activeTargetsRef.current = [];
    inputTranscriptTargetRef.current = INPUT_TRANSCRIPT_TARGET;

    const sourceStream = sourceStreamRef.current;
    sourceStreamRef.current = null;
    sourceStream?.getTracks().forEach((track) => track.stop());
  }, []);

  return {
    startOpenAiTranslation,
    switchSingleTarget,
    switchAudioInput,
    cleanupOpenAi,
  };
}
