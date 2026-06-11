"use client";

import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  appendCaptionDelta,
  detectInputLanguage,
  getClientSecret,
  getErrorMessage,
  getFocusTargetLanguage,
  isOutputTranscriptDoneEvent,
} from "../lib/caption-text";
import { DISPLAY_CAPTION_MAX_CHARS, INPUT_TRANSCRIPT_TARGET, TARGETS } from "../lib/constants";
import type { CaptionMap, RealtimeEvent, Status, TargetLanguage } from "../lib/types";

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

  const connectTranslation = useCallback(
    async (targetLanguage: TargetLanguage, sourceStream: MediaStream) => {
      const clientSecret = await createClientSecret(targetLanguage);
      const pc = new RTCPeerConnection();
      peerConnectionsRef.current[targetLanguage] = pc;

      pc.onconnectionstatechange = () => {
        if (peerConnectionsRef.current[targetLanguage] !== pc) return;

        if (pc.connectionState === "connected") {
          connectedTargetsRef.current.add(targetLanguage);
          if (connectedTargetsRef.current.size === TARGETS.length) setRealtimeStatus("live");
          return;
        }

        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          if (statusRef.current === "stopping" || statusRef.current === "idle") return;
          setError(`${targetLanguage.toUpperCase()} translation connection ended. Click Start to reconnect.`);
          cleanupRealtimeRef.current();
          setRealtimeStatus("error");
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
              [targetLanguage]: appendCaptionDelta(previous[targetLanguage], event.delta as string, DISPLAY_CAPTION_MAX_CHARS),
            }));
            setCaptions((previous) => ({
              ...previous,
              [targetLanguage]: appendCaptionDelta(previous[targetLanguage], event.delta as string, DISPLAY_CAPTION_MAX_CHARS),
            }));
          }

          if (isOutputTranscriptDoneEvent(event.type) && targetLanguage === getFocusTargetLanguage(sourceLanguageRef.current)) {
            finalizeCurrentFocusSegments();
          }

          if (
            targetLanguage === INPUT_TRANSCRIPT_TARGET &&
            event.type === "session.input_transcript.delta" &&
            typeof event.delta === "string"
          ) {
            const inputLanguage = detectInputLanguage(event.delta, lastInputLanguageRef.current);
            lastInputLanguageRef.current = inputLanguage;
            trackSourceLanguage(inputLanguage, event.delta);
            appendSessionTranscriptText(inputLanguage, event.delta);
            setCaptions((previous) => ({
              ...previous,
              [inputLanguage]: appendCaptionDelta(previous[inputLanguage], event.delta as string, DISPLAY_CAPTION_MAX_CHARS),
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
      cleanupRealtimeRef,
      createClientSecret,
      finalizeCurrentFocusSegments,
      getAccessCodeHeaders,
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

  const startOpenAiTranslation = useCallback(
    async (audioInputId?: string) => {
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

      await Promise.all(TARGETS.map((target) => connectTranslation(target.code, sourceStream)));
      setRealtimeStatus("live");
    },
    [connectTranslation, refreshAudioInputs, setRealtimeStatus]
  );

  const cleanupOpenAi = useCallback(() => {
    Object.values(dataChannelsRef.current).forEach((channel) => channel?.close());
    dataChannelsRef.current = {};

    Object.values(peerConnectionsRef.current).forEach((peerConnection) => {
      peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
      peerConnection?.getReceivers().forEach((receiver) => receiver.track?.stop());
      peerConnection?.close();
    });
    peerConnectionsRef.current = {};
    connectedTargetsRef.current.clear();

    const sourceStream = sourceStreamRef.current;
    sourceStreamRef.current = null;
    sourceStream?.getTracks().forEach((track) => track.stop());
  }, []);

  return {
    startOpenAiTranslation,
    cleanupOpenAi,
  };
}
