"use client";

import {
  MicrophoneSource,
  SonioxClient,
  type RealtimeResult as SonioxRealtimeResult,
  type RealtimeToken as SonioxRealtimeToken,
  type Recording as SonioxRecording,
  type SonioxConnectionConfig,
} from "@soniox/client";
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createEmptyCaptionMap, getErrorMessage } from "../lib/caption-text";
import { SONIOX_FINAL_TOKEN_KEY_LIMIT } from "../lib/constants";
import { getMinSwitchEvidence, getPairLanguages } from "../lib/languages";
import {
  appendSonioxCaptionText,
  createEmptySonioxCaptionBuffer,
  getSonioxCaptionMaps,
  getSonioxFinalTokenKey,
  getSonioxOutputLanguage,
  getSonioxTokenKind,
  isSonioxDebugEnabled,
  logSonioxTokenDebug,
  normalizeSonioxLanguage,
} from "../lib/soniox-captions";
import {
  FALLBACK_TRIAL_SECONDS,
  isTrialDenyReason,
  TrialDeniedError,
  TrialSessionEndedError,
  type TrialDenyReason,
} from "../lib/trial";
import type { CaptionMap, LanguagePair, SonioxCaptionBuffer, SonioxTokenKind, Status, TargetLanguage } from "../lib/types";

type UseSonioxTranslationParams = {
  statusRef: MutableRefObject<Status>;
  languagePairRef: MutableRefObject<LanguagePair>;
  setRealtimeStatus: (nextStatus: Status) => void;
  setError: (message: string) => void;
  setCaptions: Dispatch<SetStateAction<CaptionMap>>;
  setTranslationCaptions: Dispatch<SetStateAction<CaptionMap>>;
  sonioxApiKeyRef: MutableRefObject<string>;
  getAccessCodeHeaders: () => Record<string, string>;
  appendSessionTranscriptText: (language: TargetLanguage, delta: string, reason?: "final" | "partial") => string;
  appendFocusTranslationDelta: (targetLanguage: TargetLanguage, delta: string) => void;
  finalizeCurrentFocusSegments: () => void;
  trackSourceLanguage: (inputLanguage: TargetLanguage, delta: string) => void;
  trackSourceLanguageEvidence: (inputLanguage: TargetLanguage, evidence: number) => void;
  refreshAudioInputs: () => Promise<void>;
  onTrialSession?: (trialSeconds: number) => void;
  onTrialDenied?: (reason: TrialDenyReason) => void;
  onTrialEnded?: () => void;
};

export function useSonioxTranslation({
  statusRef,
  languagePairRef,
  setRealtimeStatus,
  setError,
  setCaptions,
  setTranslationCaptions,
  sonioxApiKeyRef,
  getAccessCodeHeaders,
  appendSessionTranscriptText,
  appendFocusTranslationDelta,
  finalizeCurrentFocusSegments,
  trackSourceLanguage,
  trackSourceLanguageEvidence,
  refreshAudioInputs,
  onTrialSession,
  onTrialDenied,
  onTrialEnded,
}: UseSonioxTranslationParams) {
  const sonioxRecordingRef = useRef<SonioxRecording | null>(null);
  const trialSessionRef = useRef(false);
  const sonioxCaptionBufferRef = useRef<SonioxCaptionBuffer>(createEmptySonioxCaptionBuffer());
  // Dedup keys rotate across two generations so memory stays bounded during
  // multi-hour sessions; lookups check both, inserts go to the current one.
  const sonioxFinalTokenKeysRef = useRef<Set<string>>(new Set());
  const sonioxPreviousFinalTokenKeysRef = useRef<Set<string>>(new Set());

  const hasSonioxFinalTokenKey = useCallback(
    (key: string) => sonioxFinalTokenKeysRef.current.has(key) || sonioxPreviousFinalTokenKeysRef.current.has(key),
    []
  );

  const addSonioxFinalTokenKey = useCallback((key: string) => {
    sonioxFinalTokenKeysRef.current.add(key);
    if (sonioxFinalTokenKeysRef.current.size >= SONIOX_FINAL_TOKEN_KEY_LIMIT) {
      sonioxPreviousFinalTokenKeysRef.current = sonioxFinalTokenKeysRef.current;
      sonioxFinalTokenKeysRef.current = new Set();
    }
  }, []);

  const createSonioxConnectionConfig = useCallback(async (): Promise<SonioxConnectionConfig> => {
    // A reconnect on a trial session would silently consume another trial
    // slot, so end the session instead of requesting a second key.
    if (trialSessionRef.current && !sonioxApiKeyRef.current) {
      throw new TrialSessionEndedError();
    }

    const response = await fetch("/api/soniox/config", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAccessCodeHeaders() },
      body: JSON.stringify({ sonioxApiKey: sonioxApiKeyRef.current || undefined }),
    });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};

    if (!response.ok) {
      const message = getErrorMessage(data, text || "Failed to create Soniox temporary key.");
      if (response.status === 403 && isTrialDenyReason(record.reason)) {
        throw new TrialDeniedError(record.reason, message);
      }
      throw new Error(message);
    }

    if (typeof record.api_key !== "string") {
      throw new Error("The Soniox temporary key response did not include api_key.");
    }

    if (record.trial === true) {
      trialSessionRef.current = true;
      const trialSeconds =
        typeof record.trial_seconds === "number" && Number.isFinite(record.trial_seconds) && record.trial_seconds > 0
          ? Math.floor(record.trial_seconds)
          : FALLBACK_TRIAL_SECONDS;
      onTrialSession?.(trialSeconds);
    }

    return { api_key: record.api_key };
  }, [getAccessCodeHeaders, onTrialSession, sonioxApiKeyRef]);

  const updateSonioxCaptionState = useCallback(() => {
    const next = getSonioxCaptionMaps(sonioxCaptionBufferRef.current, languagePairRef.current);
    setCaptions(next.captions);
    setTranslationCaptions(next.translationCaptions);
  }, [languagePairRef, setCaptions, setTranslationCaptions]);

  const handleSonioxResult = useCallback(
    (result: SonioxRealtimeResult) => {
      const buffer = sonioxCaptionBufferRef.current;
      const pair = languagePairRef.current;
      const debugEnabled = isSonioxDebugEnabled();
      const partialTouched: Record<SonioxTokenKind, Set<TargetLanguage>> = {
        original: new Set(),
        translation: new Set(),
      };
      const finalTouched: Record<SonioxTokenKind, Set<TargetLanguage>> = {
        original: new Set(),
        translation: new Set(),
      };

      result.tokens.forEach((token: SonioxRealtimeToken, tokenIndex) => {
        if (!token.text) return;

        const translationStatus = getSonioxTokenKind(token);
        const language = getSonioxOutputLanguage(token, translationStatus, pair);
        const sourceLanguageFromToken = normalizeSonioxLanguage(token.source_language, pair);
        if (!language) {
          if (debugEnabled) {
            console.debug("[soniox-token]", {
              finalAudioProcessedMs: result.final_audio_proc_ms,
              index: tokenIndex,
              isFinal: token.is_final === true,
              rawLanguage: token.language,
              skipped: true,
              sourceLanguage: sourceLanguageFromToken,
              text: token.text,
              translationStatus,
            });
          }
          return;
        }

        if (translationStatus === "original") {
          trackSourceLanguage(language, token.text);
        } else if (sourceLanguageFromToken) {
          trackSourceLanguageEvidence(
            sourceLanguageFromToken,
            Math.max(getMinSwitchEvidence(sourceLanguageFromToken), token.text.trim().length)
          );
        }

        const finalTokenKey = token.is_final
          ? getSonioxFinalTokenKey(token, translationStatus, language, result, tokenIndex)
          : null;
        if (finalTokenKey && hasSonioxFinalTokenKey(finalTokenKey)) {
          logSonioxTokenDebug(
            debugEnabled,
            result,
            token,
            tokenIndex,
            translationStatus,
            language,
            sourceLanguageFromToken,
            true
          );
          return;
        }

        const targetBuffer =
          translationStatus === "translation"
            ? token.is_final
              ? buffer.finalTranslation
              : buffer.partialTranslation
            : token.is_final
              ? buffer.finalOriginal
              : buffer.partialOriginal;

        if (token.is_final) {
          finalTouched[translationStatus].add(language);
        } else if (!partialTouched[translationStatus].has(language)) {
          targetBuffer[language] = "";
          partialTouched[translationStatus].add(language);
        }

        targetBuffer[language] = appendSonioxCaptionText(targetBuffer[language] ?? "", token.text);

        if (token.is_final) {
          if (finalTokenKey) addSonioxFinalTokenKey(finalTokenKey);
          buffer.finalDisplay[language] = appendSonioxCaptionText(buffer.finalDisplay[language] ?? "", token.text);
          appendSessionTranscriptText(language, token.text, "final");
          if (translationStatus === "translation") {
            appendFocusTranslationDelta(language, token.text);
          }
        }

        logSonioxTokenDebug(
          debugEnabled,
          result,
          token,
          tokenIndex,
          translationStatus,
          language,
          sourceLanguageFromToken,
          false
        );
      });

      (["original", "translation"] as const).forEach((translationStatus) => {
        finalTouched[translationStatus].forEach((language) => {
          if (partialTouched[translationStatus].has(language)) return;

          if (translationStatus === "translation") {
            buffer.partialTranslation[language] = "";
          } else {
            buffer.partialOriginal[language] = "";
          }
        });
      });

      buffer.partialDisplay = createEmptyCaptionMap(pair);
      updateSonioxCaptionState();
    },
    [
      addSonioxFinalTokenKey,
      appendFocusTranslationDelta,
      appendSessionTranscriptText,
      hasSonioxFinalTokenKey,
      languagePairRef,
      trackSourceLanguage,
      trackSourceLanguageEvidence,
      updateSonioxCaptionState,
    ]
  );

  const startSonioxTranslation = useCallback(
    async (audioInputId?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone capture.");
      }

      if (typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support microphone recording.");
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      if (audioInputId) {
        audioConstraints.deviceId = { exact: audioInputId };
      }

      trialSessionRef.current = false;

      const pair = languagePairRef.current;
      const client = new SonioxClient({
        config: createSonioxConnectionConfig,
      });
      const source = new MicrophoneSource({ constraints: audioConstraints });
      const recording = client.realtime.record({
        model: "stt-rt-v4",
        language_hints: getPairLanguages(pair),
        enable_language_identification: true,
        enable_endpoint_detection: true,
        translation: {
          type: "two_way",
          language_a: pair.a,
          language_b: pair.b,
        },
        auto_reconnect: true,
        source,
      });

      sonioxRecordingRef.current = recording;

      recording.on("connected", () => {
        if (sonioxRecordingRef.current !== recording) return;
        setRealtimeStatus("live");
      });
      recording.on("result", handleSonioxResult);
      recording.on("finalized", () => {
        if (sonioxRecordingRef.current !== recording) return;
        sonioxCaptionBufferRef.current.partialDisplay = createEmptyCaptionMap(pair);
        sonioxCaptionBufferRef.current.partialOriginal = createEmptyCaptionMap(pair);
        sonioxCaptionBufferRef.current.partialTranslation = createEmptyCaptionMap(pair);
        finalizeCurrentFocusSegments();
        updateSonioxCaptionState();
      });
      recording.on("finished", () => {
        if (sonioxRecordingRef.current !== recording) return;
        sonioxRecordingRef.current = null;
        if (statusRef.current === "stopping") return;
        setRealtimeStatus("idle");
        if (trialSessionRef.current) onTrialEnded?.();
      });
      recording.on("error", (caughtError) => {
        if (sonioxRecordingRef.current !== recording) return;
        sonioxRecordingRef.current = null;
        if (statusRef.current === "idle" || statusRef.current === "stopping") return;

        if (
          caughtError instanceof TrialDeniedError &&
          (caughtError.reason === "client_exhausted" || caughtError.reason === "global_exhausted")
        ) {
          setRealtimeStatus("idle");
          onTrialDenied?.(caughtError.reason);
          return;
        }

        // The server cuts trial sessions at the time limit, which surfaces
        // here as a websocket error; show the trial-ended card, not a red banner.
        if (trialSessionRef.current || caughtError instanceof TrialSessionEndedError) {
          setRealtimeStatus("idle");
          onTrialEnded?.();
          return;
        }

        setError(caughtError instanceof Error ? caughtError.message : "Soniox realtime API error.");
        setRealtimeStatus("error");
      });
      recording.on("state_change", ({ new_state }) => {
        if (sonioxRecordingRef.current !== recording) return;
        if (new_state === "recording") setRealtimeStatus("live");
        if (new_state === "reconnecting" || new_state === "connecting") setRealtimeStatus("connecting");
      });

      void refreshAudioInputs();
    },
    [
      createSonioxConnectionConfig,
      finalizeCurrentFocusSegments,
      handleSonioxResult,
      languagePairRef,
      onTrialDenied,
      onTrialEnded,
      refreshAudioInputs,
      setError,
      setRealtimeStatus,
      statusRef,
      updateSonioxCaptionState,
    ]
  );

  const cancelSonioxRecording = useCallback(() => {
    const recording = sonioxRecordingRef.current;
    sonioxRecordingRef.current = null;
    recording?.cancel();
  }, []);

  const stopSonioxRecording = useCallback(async () => {
    const recording = sonioxRecordingRef.current;
    if (!recording) return;

    try {
      await recording.stop();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not stop Soniox recording cleanly.");
    }

    if (sonioxRecordingRef.current === recording) {
      sonioxRecordingRef.current = null;
    }
  }, [setError]);

  const resetSonioxBuffers = useCallback(() => {
    sonioxCaptionBufferRef.current = createEmptySonioxCaptionBuffer(languagePairRef.current);
    sonioxFinalTokenKeysRef.current = new Set();
    sonioxPreviousFinalTokenKeysRef.current = new Set();
  }, [languagePairRef]);

  // A fresh connection restarts audio timestamps at zero, so old dedup keys
  // could wrongly skip new tokens. Clearing keeps captions intact.
  const resetSonioxFinalTokenKeys = useCallback(() => {
    sonioxFinalTokenKeysRef.current = new Set();
    sonioxPreviousFinalTokenKeysRef.current = new Set();
  }, []);

  return {
    startSonioxTranslation,
    cancelSonioxRecording,
    stopSonioxRecording,
    resetSonioxBuffers,
    resetSonioxFinalTokenKeys,
  };
}
