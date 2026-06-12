"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CaptionStage } from "../components/CaptionStage";
import { ControlStrip } from "../components/ControlStrip";
import { FloatingCaptionWindow } from "../components/FloatingCaptionWindow";
import { SavePanel } from "../components/SavePanel";
import { TrialEndedCard, type TrialNoticeVariant } from "../components/TrialEndedCard";
import { useAudioInputs } from "../hooks/useAudioInputs";
import { useFloatingWindow } from "../hooks/useFloatingWindow";
import { useOpenAiTranslation } from "../hooks/useOpenAiTranslation";
import { useSonioxTranslation } from "../hooks/useSonioxTranslation";
import { useSourceLanguage } from "../hooks/useSourceLanguage";
import { useTranscriptSession } from "../hooks/useTranscriptSession";
import {
  clampCaptionFontSize,
  createEmptyCaptionMap,
  formatCaptionFontSizeInput,
  getFocusTargetLanguage,
  roundCaptionFontSize,
} from "../lib/caption-text";
import {
  LANGUAGE_PAIR_STORAGE_KEY,
  MIN_CAPTION_FONT_SIZE,
  MISSING_OPENAI_API_KEY_CAPTION,
  MISSING_OPENAI_API_KEY_MESSAGE,
  OPENAI_API_KEY_STORAGE_KEY,
  SONIOX_API_KEY_STORAGE_KEY,
  SPLIT_CAPTION_TARGET_LINES,
  WATERMARK_IMAGE,
} from "../lib/constants";
import {
  DEFAULT_LANGUAGE_PAIR,
  getCaptionLineHeightRatio,
  getDefaultCaptionFontSize,
  getDefaultCaptionFontSizes,
  getLanguageLabel,
  getLanguageShortLabel,
  getOpenAiLanguageCodes,
  getOtherPairLanguage,
  getPairLanguages,
  getPairTargets,
  isLanguageCode,
  LANGUAGE_CODES,
  toOpenAiLanguagePair,
} from "../lib/languages";
import type { TrialDenyReason } from "../lib/trial";
import type {
  ApiProvider,
  CaptionFontSizeInputMap,
  CaptionFontSizeMap,
  CaptionMap,
  DisplayMode,
  LanguagePair,
  Status,
  TargetLanguage,
} from "../lib/types";

function buildDefaultFontSizeInputs(pair: LanguagePair): CaptionFontSizeInputMap {
  const inputs: CaptionFontSizeInputMap = {};
  getPairLanguages(pair).forEach((code) => {
    inputs[code] = String(getDefaultCaptionFontSize(code));
  });
  return inputs;
}

type CaptionFontStyle = CSSProperties & {
  "--caption-font-size-a": string;
  "--caption-font-size-b": string;
  "--caption-line-height-a": string;
  "--caption-line-height-b": string;
  "--watermark-image": string;
};

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [captions, setCaptions] = useState<CaptionMap>(() => createEmptyCaptionMap());
  const [translationCaptions, setTranslationCaptions] = useState<CaptionMap>(() => createEmptyCaptionMap());
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("dual");
  const [error, setError] = useState("");
  const [languagePair, setLanguagePair] = useState<LanguagePair>(DEFAULT_LANGUAGE_PAIR);
  const [captionFontSizes, setCaptionFontSizes] = useState<CaptionFontSizeMap>(() =>
    getDefaultCaptionFontSizes(DEFAULT_LANGUAGE_PAIR)
  );
  const [captionFontSizeInputs, setCaptionFontSizeInputs] = useState<CaptionFontSizeInputMap>(() =>
    buildDefaultFontSizeInputs(DEFAULT_LANGUAGE_PAIR)
  );
  const [apiProvider, setApiProvider] = useState<ApiProvider>("soniox");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [sonioxApiKey, setSonioxApiKey] = useState("");
  const [controlsAwake, setControlsAwake] = useState(false);
  const [trialCountdownSeconds, setTrialCountdownSeconds] = useState<number | null>(null);
  const [trialNotice, setTrialNotice] = useState<TrialNoticeVariant | null>(null);
  const [focusDirectionLock, setFocusDirectionLock] = useState<TargetLanguage | null>(null);

  const statusRef = useRef<Status>("idle");
  const apiProviderRef = useRef<ApiProvider>("soniox");
  const openaiApiKeyRef = useRef("");
  const sonioxApiKeyRef = useRef("");
  const languagePairRef = useRef<LanguagePair>(DEFAULT_LANGUAGE_PAIR);
  // Remembers the Soniox-mode pair while OpenAI (13 output languages only)
  // temporarily narrows the selection.
  const sonioxLanguagePairRef = useRef<LanguagePair>(DEFAULT_LANGUAGE_PAIR);
  const applyLanguagePairRef = useRef<(next: LanguagePair) => void>(() => {});
  const focusTargetLockRef = useRef<TargetLanguage | null>(null);
  const displayModeRef = useRef<DisplayMode>("dual");
  const restartSonioxSessionRef = useRef<(mode?: DisplayMode) => Promise<void>>(async () => {});
  const sonioxRestartInFlightRef = useRef(false);
  const sourceLanguageRef = useRef<TargetLanguage>(DEFAULT_LANGUAGE_PAIR.a);
  const captionScrollerRefs = useRef<Partial<Record<TargetLanguage, HTMLDivElement>>>({});
  const manualCaptionFontSizeOverridesRef = useRef<Partial<Record<TargetLanguage, boolean>>>({});
  const cleanupRealtimeRef = useRef<() => void>(() => {});
  const switchSingleTargetRef = useRef<(language: TargetLanguage) => void>(() => {});
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const setRealtimeStatus = useCallback((nextStatus: Status) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const getAccessCodeHeaders = useCallback((): Record<string, string> => {
    return {};
  }, []);

  const {
    focusSegments,
    transcriptSessions,
    transcriptReadyVisible,
    setTranscriptReadyVisible,
    appendSessionTranscriptText,
    appendFocusTranslationDelta,
    finalizeCurrentFocusSegments,
    beginTranscriptSession,
    discardActiveTranscriptSession,
    finishActiveTranscriptSession,
    resetTranscriptCaptureState,
    downloadTranscriptSession,
    deleteTranscriptSession,
    clearTranscriptSessionHistory,
  } = useTranscriptSession({ apiProviderRef, sourceLanguageRef, languagePairRef, focusTargetLockRef, setError });

  const handleCommittedSourceLanguageChange = useCallback((language: TargetLanguage) => {
    // A locked Focus direction overrides automatic source-language switching.
    if (focusTargetLockRef.current) return;
    if (apiProviderRef.current === "soniox") {
      // Soniox one_way streams translate into a fixed target; a Focus session
      // follows the speaker by restarting toward the new direction.
      if (displayModeRef.current === "single") void restartSonioxSessionRef.current();
      return;
    }
    switchSingleTargetRef.current(language);
  }, []);

  const handleTrialSession = useCallback((trialSeconds: number) => {
    setTrialCountdownSeconds(trialSeconds);
  }, []);

  const handleTrialDenied = useCallback(
    (_reason: TrialDenyReason) => {
      // Denial can also hit mid-session (a Focus direction flip consuming the
      // last slot), so finish — which saves captured text and deletes empty
      // drafts — rather than discard.
      void finishActiveTranscriptSession();
      setTrialCountdownSeconds(null);
      setTrialNotice("exhausted");
    },
    [finishActiveTranscriptSession]
  );

  const handleTrialEnded = useCallback(() => {
    setTrialCountdownSeconds(null);
    setTrialNotice("ended");
    void stopRef.current();
  }, []);

  const {
    sourceLanguage,
    lastInputLanguageRef,
    trackSourceLanguage,
    trackSourceLanguageEvidence,
    resetSourceLanguageTracking,
  } = useSourceLanguage({
    sourceLanguageRef,
    languagePairRef,
    finalizeCurrentFocusSegments,
    onCommittedSourceLanguageChange: handleCommittedSourceLanguageChange,
  });

  const { audioInputs, selectedAudioInputId, selectedAudioInputIdRef, selectAudioInput, refreshAudioInputs } =
    useAudioInputs({ setError });

  const { floatingContainer, floatingWindowOpen, toggleFloatingWindow, closeFloatingWindow } = useFloatingWindow({
    setError,
  });

  const { startOpenAiTranslation, switchSingleTarget, switchAudioInput, cleanupOpenAi } = useOpenAiTranslation({
    statusRef,
    languagePairRef,
    focusTargetLockRef,
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
  });

  const {
    startSonioxTranslation,
    cancelSonioxRecording,
    stopSonioxRecording,
    resetSonioxBuffers,
    resetSonioxFinalTokenKeys,
  } = useSonioxTranslation({
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
      onTrialSession: handleTrialSession,
      onTrialDenied: handleTrialDenied,
      onTrialEnded: handleTrialEnded,
    });

  const cleanupRealtime = useCallback(() => {
    cancelSonioxRecording();
    cleanupOpenAi();
  }, [cancelSonioxRecording, cleanupOpenAi]);

  useEffect(() => {
    cleanupRealtimeRef.current = cleanupRealtime;
  }, [cleanupRealtime]);

  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  useEffect(() => {
    switchSingleTargetRef.current = (language: TargetLanguage) => {
      if (apiProviderRef.current !== "openai") return;
      void switchSingleTarget(language);
    };
  }, [switchSingleTarget]);

  const pairTargets = useMemo(() => getPairTargets(languagePair), [languagePair]);

  const autoFitSplitCaptionFontSizes = useCallback(() => {
    if (displayMode !== "dual") return;

    const fittedSizes: Partial<CaptionFontSizeMap> = {};

    pairTargets.forEach(({ code }) => {
      if (manualCaptionFontSizeOverridesRef.current[code]) return;

      const scroller = captionScrollerRefs.current[code];
      const paragraph = scroller?.querySelector("p");
      if (!scroller || !paragraph) return;

      const paragraphStyle = window.getComputedStyle(paragraph);
      const currentFontSize = Number.parseFloat(paragraphStyle.fontSize) || getDefaultCaptionFontSize(code);
      const computedLineHeight = Number.parseFloat(paragraphStyle.lineHeight);
      const lineHeightRatio =
        Number.isFinite(computedLineHeight) && computedLineHeight > 0 && currentFontSize > 0
          ? computedLineHeight / currentFontSize
          : getCaptionLineHeightRatio(code);
      const paddingTop = Number.parseFloat(paragraphStyle.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(paragraphStyle.paddingBottom) || 0;
      const availableHeight = scroller.clientHeight - paddingTop - paddingBottom;
      const targetLines = SPLIT_CAPTION_TARGET_LINES;

      if (availableHeight <= 0 || lineHeightRatio <= 0) return;

      fittedSizes[code] = roundCaptionFontSize(clampCaptionFontSize(availableHeight / (targetLines * lineHeightRatio)));
    });

    if (!Object.keys(fittedSizes).length) return;

    setCaptionFontSizes((previous) => {
      const next = { ...previous };
      let changed = false;

      pairTargets.forEach(({ code }) => {
        const fittedSize = fittedSizes[code];
        if (!fittedSize || Math.abs((previous[code] ?? 0) - fittedSize) < 0.05) return;

        next[code] = fittedSize;
        changed = true;
      });

      return changed ? next : previous;
    });
    setCaptionFontSizeInputs((previous) => {
      const next = { ...previous };
      let changed = false;

      pairTargets.forEach(({ code }) => {
        const fittedSize = fittedSizes[code];
        if (!fittedSize) return;

        const fittedInput = formatCaptionFontSizeInput(fittedSize);
        if (previous[code] === fittedInput) return;

        next[code] = fittedInput;
        changed = true;
      });

      return changed ? next : previous;
    });
  }, [displayMode, pairTargets]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      pairTargets.forEach(({ code }) => {
        const scroller = captionScrollerRefs.current[code];
        if (!scroller) return;
        scroller.scrollTop = scroller.scrollHeight;
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [captionFontSizes, captions, displayMode, focusSegments, pairTargets, translationCaptions]);

  useEffect(() => {
    if (displayMode !== "dual") return;

    let frame: number | null = null;
    const scheduleAutoFit = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        autoFitSplitCaptionFontSizes();
      });
    };

    scheduleAutoFit();
    window.addEventListener("resize", scheduleAutoFit);
    window.visualViewport?.addEventListener("resize", scheduleAutoFit);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleAutoFit);
      window.visualViewport?.removeEventListener("resize", scheduleAutoFit);
    };
  }, [autoFitSplitCaptionFontSizes, displayMode]);

  useEffect(() => {
    try {
      const storedApiKey = window.localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY) ?? "";
      openaiApiKeyRef.current = storedApiKey;
      setOpenaiApiKey(storedApiKey);
    } catch {
      openaiApiKeyRef.current = "";
    }
  }, []);

  useEffect(() => {
    try {
      const storedApiKey = window.localStorage.getItem(SONIOX_API_KEY_STORAGE_KEY) ?? "";
      sonioxApiKeyRef.current = storedApiKey;
      setSonioxApiKey(storedApiKey);
    } catch {
      sonioxApiKeyRef.current = "";
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LANGUAGE_PAIR_STORAGE_KEY);
      if (!raw) return;

      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const { a, b } = parsed as { a?: unknown; b?: unknown };
      if (!isLanguageCode(a) || !isLanguageCode(b) || a === b) return;

      const stored: LanguagePair = { a, b };
      languagePairRef.current = stored;
      sonioxLanguagePairRef.current = stored;
      setLanguagePair(stored);
      setCaptionFontSizes(getDefaultCaptionFontSizes(stored));
      setCaptionFontSizeInputs(buildDefaultFontSizeInputs(stored));
    } catch {
      // Corrupted storage falls back to the default pair.
    }
  }, []);

  const handleApiProviderChange = useCallback((value: string) => {
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;

    const nextProvider: ApiProvider = value === "soniox" ? "soniox" : "openai";
    apiProviderRef.current = nextProvider;
    setApiProvider(nextProvider);
    setDisplayMode(nextProvider === "openai" ? "single" : "dual");
    setError("");

    // OpenAI serves 13 output languages; narrow the pair while remembering
    // the Soniox-mode selection so switching back restores it.
    const currentPair = languagePairRef.current;
    if (nextProvider === "openai") {
      sonioxLanguagePairRef.current = currentPair;
      const narrowed = toOpenAiLanguagePair(currentPair);
      if (narrowed.a !== currentPair.a || narrowed.b !== currentPair.b) {
        applyLanguagePairRef.current(narrowed);
      }
    } else {
      const remembered = sonioxLanguagePairRef.current;
      if (remembered.a !== currentPair.a || remembered.b !== currentPair.b) {
        applyLanguagePairRef.current(remembered);
      }
    }
  }, []);


  const handleOpenAiApiKeyChange = useCallback((value: string) => {
    const nextApiKey = value.trim();
    openaiApiKeyRef.current = nextApiKey;
    setOpenaiApiKey(nextApiKey);

    try {
      if (nextApiKey) {
        window.localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, nextApiKey);
      } else {
        window.localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
      }
    } catch {
      // The key still works for this tab even when local storage is unavailable.
    }
  }, []);

  const handleSonioxApiKeyChange = useCallback((value: string) => {
    const nextApiKey = value.trim();
    sonioxApiKeyRef.current = nextApiKey;
    setSonioxApiKey(nextApiKey);

    try {
      if (nextApiKey) {
        window.localStorage.setItem(SONIOX_API_KEY_STORAGE_KEY, nextApiKey);
      } else {
        window.localStorage.removeItem(SONIOX_API_KEY_STORAGE_KEY);
      }
    } catch {
      // The key still works for this tab even when local storage is unavailable.
    }
  }, []);

  const handleApiKeyChange = useCallback(
    (value: string) => {
      if (apiProviderRef.current === "openai") {
        handleOpenAiApiKeyChange(value);
      } else {
        handleSonioxApiKeyChange(value);
      }
    },
    [handleOpenAiApiKeyChange, handleSonioxApiKeyChange]
  );

  const stop = useCallback(async () => {
    if (statusRef.current !== "idle") setRealtimeStatus("stopping");

    await stopSonioxRecording();
    cleanupRealtime();
    await finishActiveTranscriptSession();
    setRealtimeStatus("idle");
  }, [cleanupRealtime, finishActiveTranscriptSession, setRealtimeStatus, stopSonioxRecording]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // The countdown only ticks while live; the server-side key limit is the
  // real enforcement, this is just the visible mirror of it.
  const trialCountdownActive = trialCountdownSeconds !== null;
  useEffect(() => {
    if (status !== "live" || !trialCountdownActive) return;

    const interval = window.setInterval(() => {
      setTrialCountdownSeconds((previous) => (previous === null ? null : Math.max(previous - 1, 0)));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [status, trialCountdownActive]);

  useEffect(() => {
    if (trialCountdownSeconds !== 0) return;

    setTrialCountdownSeconds(null);
    setTrialNotice("ended");
    void stopRef.current();
  }, [trialCountdownSeconds]);

  useEffect(() => {
    if (status === "idle" || status === "error") setTrialCountdownSeconds(null);
  }, [status]);

  const resetCaptionState = useCallback(() => {
    setCaptions(createEmptyCaptionMap(languagePairRef.current));
    setTranslationCaptions(createEmptyCaptionMap(languagePairRef.current));
    resetTranscriptCaptureState();
    resetSourceLanguageTracking();
    resetSonioxBuffers();
  }, [resetSonioxBuffers, resetSourceLanguageTracking, resetTranscriptCaptureState]);

  const applyLanguagePair = useCallback(
    (next: LanguagePair) => {
      languagePairRef.current = next;
      setLanguagePair(next);
      focusTargetLockRef.current = null;
      setFocusDirectionLock(null);
      manualCaptionFontSizeOverridesRef.current = {};
      setCaptionFontSizes(getDefaultCaptionFontSizes(next));
      setCaptionFontSizeInputs(buildDefaultFontSizeInputs(next));
      resetCaptionState();

      try {
        window.localStorage.setItem(LANGUAGE_PAIR_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // The selection still applies to this tab without persistence.
      }
    },
    [resetCaptionState]
  );

  useEffect(() => {
    applyLanguagePairRef.current = applyLanguagePair;
  }, [applyLanguagePair]);

  const handleLanguagePairChange = useCallback((side: "a" | "b", value: string) => {
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;
    if (!isLanguageCode(value)) return;

    const current = languagePairRef.current;
    let next: LanguagePair = side === "a" ? { a: value, b: current.b } : { a: current.a, b: value };
    // Picking the language already on the other side swaps the pair.
    if (next.a === next.b) next = { a: current.b, b: current.a };
    if (apiProviderRef.current === "openai") next = toOpenAiLanguagePair(next);

    sonioxLanguagePairRef.current = next;
    applyLanguagePairRef.current(next);
  }, []);

  const handleFocusDirectionChange = useCallback(
    (lock: TargetLanguage | null) => {
      focusTargetLockRef.current = lock;
      setFocusDirectionLock(lock);

      if (statusRef.current !== "live" && statusRef.current !== "connecting") return;

      // A live Focus session translates into one target only; rebuild it so
      // the locked (or re-detected) direction takes effect immediately.
      if (apiProviderRef.current === "soniox") {
        if (displayModeRef.current === "single") void restartSonioxSessionRef.current();
        return;
      }

      const desiredSource = lock
        ? getOtherPairLanguage(languagePairRef.current, lock)
        : sourceLanguageRef.current;
      void switchSingleTarget(desiredSource);
    },
    [switchSingleTarget]
  );

  const start = useCallback(
    async (audioInputId = selectedAudioInputIdRef.current) => {
      setError("");
      setTrialNotice(null);
      setTrialCountdownSeconds(null);
      if (apiProviderRef.current === "openai" && !openaiApiKeyRef.current) {
        resetCaptionState();
        setRealtimeStatus("idle");
        setError(MISSING_OPENAI_API_KEY_MESSAGE);
        return;
      }

      setRealtimeStatus("connecting");
      cleanupRealtime();
      resetCaptionState();
      beginTranscriptSession();

      try {
        if (apiProviderRef.current === "openai") {
          await startOpenAiTranslation(audioInputId, displayMode);
        } else {
          await startSonioxTranslation(audioInputId, displayMode);
        }
      } catch (caughtError) {
        cleanupRealtime();
        await discardActiveTranscriptSession();
        setRealtimeStatus("error");
        setError(caughtError instanceof Error ? caughtError.message : "Unknown error.");
      }
    },
    [
      beginTranscriptSession,
      cleanupRealtime,
      discardActiveTranscriptSession,
      displayMode,
      resetCaptionState,
      selectedAudioInputIdRef,
      setRealtimeStatus,
      startOpenAiTranslation,
      startSonioxTranslation,
    ]
  );

  const handleAudioInputChange = useCallback(
    async (deviceId: string) => {
      selectAudioInput(deviceId);

      if (statusRef.current !== "live") return;

      if (apiProviderRef.current === "openai") {
        try {
          await switchAudioInput(deviceId);
        } catch (caughtError) {
          setError(
            caughtError instanceof Error
              ? `Could not switch audio input: ${caughtError.message}`
              : "Could not switch audio input."
          );
        }
        return;
      }

      // Soniox has no in-flight source swap; restart the connection while
      // keeping the active transcript session and on-screen captions.
      setRealtimeStatus("stopping");
      await stopSonioxRecording();
      resetSonioxFinalTokenKeys();
      setRealtimeStatus("connecting");

      try {
        await startSonioxTranslation(deviceId, displayModeRef.current);
      } catch (caughtError) {
        cleanupRealtime();
        await finishActiveTranscriptSession();
        setRealtimeStatus("error");
        setError(caughtError instanceof Error ? caughtError.message : "Could not switch audio input.");
      }
    },
    [
      cleanupRealtime,
      finishActiveTranscriptSession,
      resetSonioxFinalTokenKeys,
      selectAudioInput,
      setRealtimeStatus,
      startSonioxTranslation,
      stopSonioxRecording,
      switchAudioInput,
    ]
  );

  // Rebuilds the live Soniox session in place (transcript and captions kept)
  // so one_way streams can change target or stream count: Focus direction
  // flips, direction-lock changes, and Split/Focus switches all land here.
  const restartSonioxSession = useCallback(
    async (mode?: DisplayMode) => {
      if (apiProviderRef.current !== "soniox") return;
      if (statusRef.current !== "live" && statusRef.current !== "connecting") return;
      if (sonioxRestartInFlightRef.current) return;

      sonioxRestartInFlightRef.current = true;
      try {
        setRealtimeStatus("stopping");
        await stopSonioxRecording();
        resetSonioxFinalTokenKeys();
        setRealtimeStatus("connecting");
        await startSonioxTranslation(selectedAudioInputIdRef.current, mode ?? displayModeRef.current);
      } catch (caughtError) {
        cleanupRealtime();
        await finishActiveTranscriptSession();
        setRealtimeStatus("error");
        setError(caughtError instanceof Error ? caughtError.message : "Could not restart the Soniox session.");
      } finally {
        sonioxRestartInFlightRef.current = false;
      }
    },
    [
      cleanupRealtime,
      finishActiveTranscriptSession,
      resetSonioxFinalTokenKeys,
      selectedAudioInputIdRef,
      setRealtimeStatus,
      startSonioxTranslation,
      stopSonioxRecording,
    ]
  );

  useEffect(() => {
    restartSonioxSessionRef.current = restartSonioxSession;
  }, [restartSonioxSession]);

  const handleDisplayModeChange = useCallback(
    (mode: DisplayMode) => {
      setDisplayMode(mode);
      displayModeRef.current = mode;
      // Soniox stream layout differs per view (one stream in Focus, two in
      // Split); apply it to the live session. OpenAI keeps its documented
      // behavior of reconfiguring only on the next Start.
      if (apiProviderRef.current === "soniox") void restartSonioxSession(mode);
    },
    [restartSonioxSession]
  );

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setError("Fullscreen is not available in this browser.");
    }
  }, []);

  const handleCaptionFontSizeChange = useCallback((language: TargetLanguage, value: string) => {
    manualCaptionFontSizeOverridesRef.current[language] = true;
    setCaptionFontSizeInputs((previous) => ({ ...previous, [language]: value }));

    const nextSize = Number(value);
    if (Number.isFinite(nextSize)) {
      setCaptionFontSizes((previous) => ({ ...previous, [language]: clampCaptionFontSize(nextSize) }));
    }
  }, []);

  const commitCaptionFontSize = useCallback(
    (language: TargetLanguage) => {
      setCaptionFontSizeInputs((previous) => ({
        ...previous,
        [language]: formatCaptionFontSizeInput(captionFontSizes[language] ?? getDefaultCaptionFontSize(language)),
      }));
    },
    [captionFontSizes]
  );

  const openSavePanel = useCallback(() => {
    setTranscriptReadyVisible(false);
    setSavePanelOpen(true);
  }, [setTranscriptReadyVisible]);

  const setScrollerRef = useCallback((code: TargetLanguage, element: HTMLDivElement | null) => {
    if (element) {
      captionScrollerRefs.current[code] = element;
    } else {
      delete captionScrollerRefs.current[code];
    }
  }, []);

  const handleAudioInputSelect = useCallback(
    (deviceId: string) => {
      void handleAudioInputChange(deviceId);
    },
    [handleAudioInputChange]
  );
  const handleRefreshAudioInputs = useCallback(() => {
    void refreshAudioInputs();
  }, [refreshAudioInputs]);
  const handleToggleFloatingWindow = useCallback(() => {
    void toggleFloatingWindow();
  }, [toggleFloatingWindow]);
  const handleToggleFullscreen = useCallback(() => {
    void toggleFullscreen();
  }, [toggleFullscreen]);
  const handleStart = useCallback(() => {
    void start();
  }, [start]);
  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);
  const closeSavePanel = useCallback(() => setSavePanelOpen(false), []);
  const closeTrialNotice = useCallback(() => setTrialNotice(null), []);
  const handleDeleteTranscriptSession = useCallback(
    (sessionId: string) => {
      void deleteTranscriptSession(sessionId);
    },
    [deleteTranscriptSession]
  );
  const handleClearTranscriptHistory = useCallback(() => {
    void clearTranscriptSessionHistory();
  }, [clearTranscriptSessionHistory]);

  const languageOptions = useMemo(
    () =>
      (apiProvider === "openai" ? getOpenAiLanguageCodes() : LANGUAGE_CODES).map((code) => ({
        code,
        label: getLanguageLabel(code),
      })),
    [apiProvider]
  );

  const isRunning = status === "connecting" || status === "live" || status === "stopping";
  const apiKeyLabel = apiProvider === "openai" ? "OpenAI API key" : "Soniox API key";
  const apiKeyPlaceholder = apiProvider === "openai" ? "OpenAI key" : "Soniox key";
  const apiKeyValue = apiProvider === "openai" ? openaiApiKey : sonioxApiKey;
  const singleTargetLanguage = getFocusTargetLanguage(sourceLanguage, languagePair);
  const latestFocusSegment = focusSegments[focusSegments.length - 1];
  const focusPanelLanguage = focusDirectionLock ?? latestFocusSegment?.targetLanguage ?? singleTargetLanguage;
  const focusTarget = pairTargets.find((target) => target.code === focusPanelLanguage) ?? pairTargets[0];
  const missingOpenAiApiKey = apiProvider === "openai" && !openaiApiKey.trim();
  const trialMode = apiProvider === "soniox" && !sonioxApiKey.trim();
  const waitingTranslationText = missingOpenAiApiKey ? MISSING_OPENAI_API_KEY_CAPTION : "等待翻译 Waiting translate";
  const captionStyle: CaptionFontStyle = {
    "--caption-font-size-a": `${captionFontSizes[languagePair.a] ?? getDefaultCaptionFontSize(languagePair.a)}px`,
    "--caption-font-size-b": `${captionFontSizes[languagePair.b] ?? getDefaultCaptionFontSize(languagePair.b)}px`,
    "--caption-line-height-a": String(getCaptionLineHeightRatio(languagePair.a)),
    "--caption-line-height-b": String(getCaptionLineHeightRatio(languagePair.b)),
    "--watermark-image": WATERMARK_IMAGE,
  };

  return (
    <>
      <main className="meeting-shell" style={captionStyle}>
        <ControlStrip
          status={status}
          isRunning={isRunning}
          trialMode={trialMode}
          trialCountdownSeconds={trialCountdownSeconds}
          apiProvider={apiProvider}
          apiKeyLabel={apiKeyLabel}
          apiKeyPlaceholder={apiKeyPlaceholder}
          apiKeyValue={apiKeyValue}
          audioInputs={audioInputs}
          selectedAudioInputId={selectedAudioInputId}
          displayMode={displayMode}
          floatingWindowOpen={floatingWindowOpen}
          languagePair={languagePair}
          languageOptions={languageOptions}
          onLanguagePairChange={handleLanguagePairChange}
          onApiProviderChange={handleApiProviderChange}
          onApiKeyChange={handleApiKeyChange}
          onAudioInputChange={handleAudioInputSelect}
          onRefreshAudioInputs={handleRefreshAudioInputs}
          onOpenSavePanel={openSavePanel}
          onDisplayModeChange={handleDisplayModeChange}
          onToggleFloatingWindow={handleToggleFloatingWindow}
          onToggleFullscreen={handleToggleFullscreen}
          onStart={handleStart}
          onStop={handleStop}
          onAwakeChange={setControlsAwake}
        />

        <CaptionStage
          displayMode={displayMode}
          captions={captions}
          targets={pairTargets}
          focusSegments={focusSegments}
          focusPanelLanguage={focusPanelLanguage}
          focusPanelLabel={focusTarget.label}
          waitingTranslationText={waitingTranslationText}
          error={error}
          setScrollerRef={setScrollerRef}
        />

        {transcriptReadyVisible ? (
          <div className="transcript-ready-banner" role="status">
            <span>Transcript ready</span>
            <button className="tiny-button" onClick={openSavePanel} type="button">
              Open
            </button>
            <button className="tiny-button" onClick={() => setTranscriptReadyVisible(false)} title="Dismiss" type="button">
              ×
            </button>
          </div>
        ) : null}

        {savePanelOpen ? (
          <SavePanel
            sessions={transcriptSessions}
            onClose={closeSavePanel}
            onDownload={downloadTranscriptSession}
            onDelete={handleDeleteTranscriptSession}
            onClearAll={handleClearTranscriptHistory}
          />
        ) : null}

        {trialNotice ? <TrialEndedCard variant={trialNotice} onClose={closeTrialNotice} /> : null}

        <div className={`font-dock ${controlsAwake ? "font-dock-awake" : ""}`} aria-label="Caption display controls">
          {displayMode === "single" ? (
            <div aria-label="Focus translation direction" className="segmented-switch direction-switch" role="group">
              <button
                aria-pressed={focusDirectionLock === null}
                className={`switch-option ${focusDirectionLock === null ? "switch-option-active" : ""}`}
                onClick={() => handleFocusDirectionChange(null)}
                title="Follow the detected spoken language automatically"
                type="button"
              >
                Auto
              </button>
              {pairTargets.map((target) => (
                <button
                  aria-pressed={focusDirectionLock === target.code}
                  className={`switch-option ${focusDirectionLock === target.code ? "switch-option-active" : ""}`}
                  key={target.code}
                  onClick={() => handleFocusDirectionChange(focusDirectionLock === target.code ? null : target.code)}
                  title={`Always show ${target.label} translations`}
                  type="button"
                >
                  {getLanguageShortLabel(target.code)}
                </button>
              ))}
            </div>
          ) : null}
          {pairTargets.map((target) => (
            <label className="font-control" key={target.code} title={`${target.label} caption font size`}>
              <span>{getLanguageShortLabel(target.code)}</span>
              <input
                aria-label={`${target.label} caption font size`}
                className="font-input"
                inputMode="numeric"
                min={MIN_CAPTION_FONT_SIZE}
                onBlur={() => commitCaptionFontSize(target.code)}
                onChange={(event) => handleCaptionFontSizeChange(target.code, event.currentTarget.value)}
                step="0.1"
                type="number"
                value={captionFontSizeInputs[target.code] ?? ""}
              />
            </label>
          ))}
        </div>
      </main>

      {floatingContainer
        ? createPortal(
            <FloatingCaptionWindow
              captionFontSizes={captionFontSizes}
              captions={captions}
              displayMode={displayMode}
              focusSegments={focusSegments}
              languagePair={languagePair}
              onClose={closeFloatingWindow}
              singleFallbackCaption={waitingTranslationText}
              sourceLanguage={sourceLanguage}
              targets={pairTargets}
            />,
            floatingContainer
          )
        : null}
    </>
  );
}
