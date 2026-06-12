"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  formatCaptionFontSizeInput,
  getFocusTargetLanguage,
  roundCaptionFontSize,
} from "../lib/caption-text";
import {
  DEFAULT_CAPTION_FONT_SIZES,
  MIN_CAPTION_FONT_SIZE,
  MISSING_OPENAI_API_KEY_CAPTION,
  MISSING_OPENAI_API_KEY_MESSAGE,
  OPENAI_API_KEY_STORAGE_KEY,
  SONIOX_API_KEY_STORAGE_KEY,
  SPLIT_CAPTION_LINE_HEIGHT_RATIO,
  SPLIT_CAPTION_TARGET_LINES,
  TARGETS,
  WATERMARK_IMAGE,
} from "../lib/constants";
import type { TrialDenyReason } from "../lib/trial";
import type {
  ApiProvider,
  CaptionFontSizeInputMap,
  CaptionFontSizeMap,
  CaptionMap,
  DisplayMode,
  Status,
  TargetLanguage,
} from "../lib/types";

type CaptionFontStyle = CSSProperties & {
  "--caption-font-size-en": string;
  "--caption-font-size-zh": string;
  "--watermark-image": string;
};

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [captions, setCaptions] = useState<CaptionMap>({ en: "", zh: "" });
  const [translationCaptions, setTranslationCaptions] = useState<CaptionMap>({ en: "", zh: "" });
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("dual");
  const [error, setError] = useState("");
  const [captionFontSizes, setCaptionFontSizes] = useState<CaptionFontSizeMap>(DEFAULT_CAPTION_FONT_SIZES);
  const [captionFontSizeInputs, setCaptionFontSizeInputs] = useState<CaptionFontSizeInputMap>({
    en: String(DEFAULT_CAPTION_FONT_SIZES.en),
    zh: String(DEFAULT_CAPTION_FONT_SIZES.zh),
  });
  const [apiProvider, setApiProvider] = useState<ApiProvider>("soniox");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [sonioxApiKey, setSonioxApiKey] = useState("");
  const [controlsAwake, setControlsAwake] = useState(false);
  const [trialCountdownSeconds, setTrialCountdownSeconds] = useState<number | null>(null);
  const [trialNotice, setTrialNotice] = useState<TrialNoticeVariant | null>(null);

  const statusRef = useRef<Status>("idle");
  const apiProviderRef = useRef<ApiProvider>("soniox");
  const openaiApiKeyRef = useRef("");
  const sonioxApiKeyRef = useRef("");
  const sourceLanguageRef = useRef<TargetLanguage>("en");
  const captionScrollerRefs = useRef<Partial<Record<TargetLanguage, HTMLDivElement>>>({});
  const manualCaptionFontSizeOverridesRef = useRef<Record<TargetLanguage, boolean>>({ en: false, zh: false });
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
  } = useTranscriptSession({ apiProviderRef, sourceLanguageRef, setError });

  const handleCommittedSourceLanguageChange = useCallback((language: TargetLanguage) => {
    switchSingleTargetRef.current(language);
  }, []);

  const handleTrialSession = useCallback((trialSeconds: number) => {
    setTrialCountdownSeconds(trialSeconds);
  }, []);

  const handleTrialDenied = useCallback(
    (_reason: TrialDenyReason) => {
      void discardActiveTranscriptSession();
      setTrialCountdownSeconds(null);
      setTrialNotice("exhausted");
    },
    [discardActiveTranscriptSession]
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
    switchSingleTargetRef.current = (language: TargetLanguage) => {
      if (apiProviderRef.current !== "openai") return;
      void switchSingleTarget(language);
    };
  }, [switchSingleTarget]);

  const autoFitSplitCaptionFontSizes = useCallback(() => {
    if (displayMode !== "dual") return;

    const fittedSizes: Partial<CaptionFontSizeMap> = {};

    TARGETS.forEach(({ code }) => {
      if (manualCaptionFontSizeOverridesRef.current[code]) return;

      const scroller = captionScrollerRefs.current[code];
      const paragraph = scroller?.querySelector("p");
      if (!scroller || !paragraph) return;

      const paragraphStyle = window.getComputedStyle(paragraph);
      const currentFontSize = Number.parseFloat(paragraphStyle.fontSize) || DEFAULT_CAPTION_FONT_SIZES[code];
      const computedLineHeight = Number.parseFloat(paragraphStyle.lineHeight);
      const lineHeightRatio =
        Number.isFinite(computedLineHeight) && computedLineHeight > 0 && currentFontSize > 0
          ? computedLineHeight / currentFontSize
          : SPLIT_CAPTION_LINE_HEIGHT_RATIO[code];
      const paddingTop = Number.parseFloat(paragraphStyle.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(paragraphStyle.paddingBottom) || 0;
      const availableHeight = scroller.clientHeight - paddingTop - paddingBottom;
      const targetLines = SPLIT_CAPTION_TARGET_LINES[code];

      if (availableHeight <= 0 || lineHeightRatio <= 0) return;

      fittedSizes[code] = roundCaptionFontSize(clampCaptionFontSize(availableHeight / (targetLines * lineHeightRatio)));
    });

    if (!Object.keys(fittedSizes).length) return;

    setCaptionFontSizes((previous) => {
      const next = { ...previous };
      let changed = false;

      TARGETS.forEach(({ code }) => {
        const fittedSize = fittedSizes[code];
        if (!fittedSize || Math.abs(previous[code] - fittedSize) < 0.05) return;

        next[code] = fittedSize;
        changed = true;
      });

      return changed ? next : previous;
    });
    setCaptionFontSizeInputs((previous) => {
      const next = { ...previous };
      let changed = false;

      TARGETS.forEach(({ code }) => {
        const fittedSize = fittedSizes[code];
        if (!fittedSize) return;

        const fittedInput = formatCaptionFontSizeInput(fittedSize);
        if (previous[code] === fittedInput) return;

        next[code] = fittedInput;
        changed = true;
      });

      return changed ? next : previous;
    });
  }, [displayMode]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      TARGETS.forEach(({ code }) => {
        const scroller = captionScrollerRefs.current[code];
        if (!scroller) return;
        scroller.scrollTop = scroller.scrollHeight;
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [captionFontSizes, captions, displayMode, focusSegments, translationCaptions]);

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

  const handleApiProviderChange = useCallback((value: string) => {
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;

    const nextProvider: ApiProvider = value === "soniox" ? "soniox" : "openai";
    apiProviderRef.current = nextProvider;
    setApiProvider(nextProvider);
    setDisplayMode(nextProvider === "openai" ? "single" : "dual");
    setError("");
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
    setCaptions({ en: "", zh: "" });
    setTranslationCaptions({ en: "", zh: "" });
    resetTranscriptCaptureState();
    resetSourceLanguageTracking();
    resetSonioxBuffers();
  }, [resetSonioxBuffers, resetSourceLanguageTracking, resetTranscriptCaptureState]);

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
          await startSonioxTranslation(audioInputId);
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
        await startSonioxTranslation(deviceId);
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
        [language]: formatCaptionFontSizeInput(captionFontSizes[language]),
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

  const isRunning = status === "connecting" || status === "live" || status === "stopping";
  const apiKeyLabel = apiProvider === "openai" ? "OpenAI API key" : "Soniox API key";
  const apiKeyPlaceholder = apiProvider === "openai" ? "OpenAI key" : "Soniox key";
  const apiKeyValue = apiProvider === "openai" ? openaiApiKey : sonioxApiKey;
  const singleTargetLanguage = getFocusTargetLanguage(sourceLanguage);
  const latestFocusSegment = focusSegments[focusSegments.length - 1];
  const focusPanelLanguage = latestFocusSegment?.targetLanguage ?? singleTargetLanguage;
  const focusTarget = TARGETS.find((target) => target.code === focusPanelLanguage) ?? TARGETS[0];
  const missingOpenAiApiKey = apiProvider === "openai" && !openaiApiKey.trim();
  const trialMode = apiProvider === "soniox" && !sonioxApiKey.trim();
  const waitingTranslationText = missingOpenAiApiKey ? MISSING_OPENAI_API_KEY_CAPTION : "等待翻译 Waiting translate";
  const captionStyle: CaptionFontStyle = {
    "--caption-font-size-en": `${captionFontSizes.en}px`,
    "--caption-font-size-zh": `${captionFontSizes.zh}px`,
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
          onApiProviderChange={handleApiProviderChange}
          onApiKeyChange={handleApiKeyChange}
          onAudioInputChange={handleAudioInputSelect}
          onRefreshAudioInputs={handleRefreshAudioInputs}
          onOpenSavePanel={openSavePanel}
          onDisplayModeChange={setDisplayMode}
          onToggleFloatingWindow={handleToggleFloatingWindow}
          onToggleFullscreen={handleToggleFullscreen}
          onStart={handleStart}
          onStop={handleStop}
          onAwakeChange={setControlsAwake}
        />

        <CaptionStage
          displayMode={displayMode}
          captions={captions}
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

        <div className={`font-dock ${controlsAwake ? "font-dock-awake" : ""}`} aria-label="Caption font size controls">
          <label className="font-control" title="English caption font size">
            <span>EN</span>
            <input
              aria-label="English caption font size"
              className="font-input"
              inputMode="numeric"
              min={MIN_CAPTION_FONT_SIZE}
              onBlur={() => commitCaptionFontSize("en")}
              onChange={(event) => handleCaptionFontSizeChange("en", event.currentTarget.value)}
              step="0.1"
              type="number"
              value={captionFontSizeInputs.en}
            />
          </label>

          <label className="font-control" title="Chinese caption font size">
            <span>中文</span>
            <input
              aria-label="Chinese caption font size"
              className="font-input"
              inputMode="numeric"
              min={MIN_CAPTION_FONT_SIZE}
              onBlur={() => commitCaptionFontSize("zh")}
              onChange={(event) => handleCaptionFontSizeChange("zh", event.currentTarget.value)}
              step="0.1"
              type="number"
              value={captionFontSizeInputs.zh}
            />
          </label>
        </div>
      </main>

      {floatingContainer
        ? createPortal(
            <FloatingCaptionWindow
              captionFontSizes={captionFontSizes}
              captions={captions}
              displayMode={displayMode}
              focusSegments={focusSegments}
              onClose={closeFloatingWindow}
              singleFallbackCaption={waitingTranslationText}
              sourceLanguage={sourceLanguage}
            />,
            floatingContainer
          )
        : null}
    </>
  );
}
