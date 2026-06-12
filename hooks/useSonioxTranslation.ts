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
import { createEmptyCaptionMap, getErrorMessage, getFocusTargetLanguage } from "../lib/caption-text";
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
import type {
  CaptionMap,
  DisplayMode,
  LanguagePair,
  SonioxCaptionBuffer,
  SonioxTokenKind,
  Status,
  TargetLanguage,
} from "../lib/types";

// Every Soniox session now runs one_way translation streams so that speech in
// ANY language — including languages outside the selected pair — is always
// translated. Split view runs one stream per pair language (双倍音频费用,
// deliberate trade-off); Focus view runs a single stream whose target follows
// the detected source language or the manual direction lock.

type SonioxRecordingRole = {
  index: number;
  // Translation tokens this recording is allowed to display; null shows all.
  // In split mode each stream only contributes its own target's translations.
  translationFilter: TargetLanguage | null;
  // Exactly one recording transcribes originals, drives language detection,
  // and finalizes focus segments, so duplicates never reach the buffers.
  isOriginalSource: boolean;
};

type ActiveSonioxRecording = {
  recording: SonioxRecording;
  role: SonioxRecordingRole;
};

type UseSonioxTranslationParams = {
  statusRef: MutableRefObject<Status>;
  languagePairRef: MutableRefObject<LanguagePair>;
  sourceLanguageRef: MutableRefObject<TargetLanguage>;
  focusTargetLockRef: MutableRefObject<TargetLanguage | null>;
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
  sourceLanguageRef,
  focusTargetLockRef,
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
  const sonioxRecordingsRef = useRef<ActiveSonioxRecording[]>([]);
  const connectedRecordingIndicesRef = useRef<Set<number>>(new Set());
  const plannedRecordingCountRef = useRef(0);
  const trialSessionRef = useRef(false);
  // Keys minted in one gated batch request, handed to recordings as they connect.
  const keyStashRef = useRef<string[]>([]);
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

  const fetchSonioxKeys = useCallback(
    async (keyCount: number): Promise<string[]> => {
      const response = await fetch("/api/soniox/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAccessCodeHeaders() },
        body: JSON.stringify({ sonioxApiKey: sonioxApiKeyRef.current || undefined, keyCount }),
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

      const keys = Array.isArray(record.api_keys)
        ? record.api_keys.filter((key): key is string => typeof key === "string")
        : typeof record.api_key === "string"
          ? [record.api_key]
          : [];
      if (keys.length < keyCount) {
        throw new Error("The Soniox temporary key response did not include enough api_keys.");
      }

      if (record.trial === true) {
        trialSessionRef.current = true;
        const trialSeconds =
          typeof record.trial_seconds === "number" && Number.isFinite(record.trial_seconds) && record.trial_seconds > 0
            ? Math.floor(record.trial_seconds)
            : FALLBACK_TRIAL_SECONDS;
        onTrialSession?.(trialSeconds);
      }

      return keys;
    },
    [getAccessCodeHeaders, onTrialSession, sonioxApiKeyRef]
  );

  const createSonioxConnectionConfig = useCallback(async (): Promise<SonioxConnectionConfig> => {
    const stashedKey = keyStashRef.current.shift();
    if (stashedKey) return { api_key: stashedKey };

    // No stashed key means the SDK is reconnecting. A trial reconnect would
    // silently consume another trial slot, so end the session instead.
    if (trialSessionRef.current && !sonioxApiKeyRef.current) {
      throw new TrialSessionEndedError();
    }

    const [key] = await fetchSonioxKeys(1);
    return { api_key: key };
  }, [fetchSonioxKeys, sonioxApiKeyRef]);

  const updateSonioxCaptionState = useCallback(() => {
    const next = getSonioxCaptionMaps(sonioxCaptionBufferRef.current, languagePairRef.current);
    setCaptions(next.captions);
    setTranslationCaptions(next.translationCaptions);
  }, [languagePairRef, setCaptions, setTranslationCaptions]);

  const teardownSonioxRecordings = useCallback(() => {
    const active = sonioxRecordingsRef.current;
    sonioxRecordingsRef.current = [];
    connectedRecordingIndicesRef.current = new Set();
    active.forEach((entry) => {
      try {
        entry.recording.cancel();
      } catch {
        // The recording may already be finished.
      }
    });
  }, []);

  const processSonioxResult = useCallback(
    (role: SonioxRecordingRole, result: SonioxRealtimeResult) => {
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
        // Originals (and language detection) come from one designated stream
        // only; in split mode each stream contributes only its own target's
        // translations. This keeps dual streams from double-writing buffers.
        if (translationStatus === "original" && !role.isOriginalSource) return;

        const language = getSonioxOutputLanguage(token, translationStatus, pair);
        const sourceLanguageFromToken = normalizeSonioxLanguage(token.source_language, pair);
        if (!language || (translationStatus === "translation" && role.translationFilter && language !== role.translationFilter)) {
          if (debugEnabled) {
            console.debug("[soniox-token]", {
              finalAudioProcessedMs: result.final_audio_proc_ms,
              index: tokenIndex,
              isFinal: token.is_final === true,
              rawLanguage: token.language,
              recordingIndex: role.index,
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
        } else if (sourceLanguageFromToken && role.isOriginalSource) {
          trackSourceLanguageEvidence(
            sourceLanguageFromToken,
            Math.max(getMinSwitchEvidence(sourceLanguageFromToken), token.text.trim().length)
          );
        }

        const finalTokenKey = token.is_final
          ? `${role.index}:${getSonioxFinalTokenKey(token, translationStatus, language, result, tokenIndex)}`
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
    async (audioInputId: string | undefined, displayMode: DisplayMode) => {
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
      keyStashRef.current = [];

      const pair = languagePairRef.current;
      const plans: Array<{ targetLanguage: TargetLanguage; role: SonioxRecordingRole }> =
        displayMode === "single"
          ? [
              {
                targetLanguage:
                  focusTargetLockRef.current ?? getFocusTargetLanguage(sourceLanguageRef.current, pair),
                role: { index: 0, translationFilter: null, isOriginalSource: true },
              },
            ]
          : [
              { targetLanguage: pair.a, role: { index: 0, translationFilter: pair.a, isOriginalSource: false } },
              { targetLanguage: pair.b, role: { index: 1, translationFilter: pair.b, isOriginalSource: true } },
            ];

      // One gated request mints every key the session needs: a Start consumes
      // one trial slot whether it opens one stream or two.
      try {
        keyStashRef.current = await fetchSonioxKeys(plans.length);
      } catch (caughtError) {
        if (
          caughtError instanceof TrialDeniedError &&
          (caughtError.reason === "client_exhausted" || caughtError.reason === "global_exhausted")
        ) {
          setRealtimeStatus("idle");
          onTrialDenied?.(caughtError.reason);
          return;
        }
        throw caughtError;
      }

      const active: ActiveSonioxRecording[] = [];
      sonioxRecordingsRef.current = active;
      connectedRecordingIndicesRef.current = new Set();
      plannedRecordingCountRef.current = plans.length;

      plans.forEach((plan) => {
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
            type: "one_way",
            target_language: plan.targetLanguage,
          },
          auto_reconnect: true,
          source,
        });

        const entry: ActiveSonioxRecording = { recording, role: plan.role };
        active.push(entry);

        const isCurrent = () => sonioxRecordingsRef.current.includes(entry);

        recording.on("connected", () => {
          if (!isCurrent()) return;
          connectedRecordingIndicesRef.current.add(plan.role.index);
          if (connectedRecordingIndicesRef.current.size >= plannedRecordingCountRef.current) {
            setRealtimeStatus("live");
          }
        });
        recording.on("result", (result) => {
          if (!isCurrent()) return;
          processSonioxResult(entry.role, result);
        });
        recording.on("finalized", () => {
          if (!isCurrent()) return;
          const buffer = sonioxCaptionBufferRef.current;
          if (entry.role.translationFilter) {
            buffer.partialTranslation[entry.role.translationFilter] = "";
          } else {
            buffer.partialTranslation = createEmptyCaptionMap(pair);
          }
          if (entry.role.isOriginalSource) {
            buffer.partialDisplay = createEmptyCaptionMap(pair);
            buffer.partialOriginal = createEmptyCaptionMap(pair);
            finalizeCurrentFocusSegments();
          }
          updateSonioxCaptionState();
        });
        recording.on("finished", () => {
          if (!isCurrent()) return;
          // One stream ending ends the session: in split mode a single
          // surviving stream would show half the captions.
          teardownSonioxRecordings();
          if (statusRef.current === "stopping") return;
          setRealtimeStatus("idle");
          if (trialSessionRef.current) onTrialEnded?.();
        });
        recording.on("error", (caughtError) => {
          if (!isCurrent()) return;
          teardownSonioxRecordings();
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
          if (!isCurrent()) return;
          if (new_state === "recording") {
            connectedRecordingIndicesRef.current.add(plan.role.index);
            if (connectedRecordingIndicesRef.current.size >= plannedRecordingCountRef.current) {
              setRealtimeStatus("live");
            }
          }
          if (new_state === "reconnecting" || new_state === "connecting") {
            connectedRecordingIndicesRef.current.delete(plan.role.index);
            setRealtimeStatus("connecting");
          }
        });
      });

      void refreshAudioInputs();
    },
    [
      createSonioxConnectionConfig,
      fetchSonioxKeys,
      finalizeCurrentFocusSegments,
      focusTargetLockRef,
      languagePairRef,
      onTrialDenied,
      onTrialEnded,
      processSonioxResult,
      refreshAudioInputs,
      setError,
      setRealtimeStatus,
      sourceLanguageRef,
      statusRef,
      teardownSonioxRecordings,
      updateSonioxCaptionState,
    ]
  );

  const cancelSonioxRecording = useCallback(() => {
    teardownSonioxRecordings();
  }, [teardownSonioxRecordings]);

  const stopSonioxRecording = useCallback(async () => {
    const active = sonioxRecordingsRef.current;
    if (!active.length) return;

    const results = await Promise.allSettled(active.map((entry) => entry.recording.stop()));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) {
      setError(
        failure.reason instanceof Error ? failure.reason.message : "Could not stop Soniox recording cleanly."
      );
    }

    if (sonioxRecordingsRef.current === active) {
      sonioxRecordingsRef.current = [];
      connectedRecordingIndicesRef.current = new Set();
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
