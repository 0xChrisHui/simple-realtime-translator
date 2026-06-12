"use client";

import { memo } from "react";
import { API_PROVIDERS, TRIAL_LOW_REMAINING_SECONDS } from "../lib/constants";
import { getLanguageShortLabel, type PairTarget } from "../lib/languages";
import { formatTrialCountdown } from "../lib/trial";
import type { ApiProvider, AudioInputDevice, DisplayMode, LanguagePair, Status, TargetLanguage } from "../lib/types";

export type LanguageOption = { code: TargetLanguage; label: string };

type ControlStripProps = {
  status: Status;
  isRunning: boolean;
  trialMode: boolean;
  trialCountdownSeconds: number | null;
  apiProvider: ApiProvider;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyValue: string;
  audioInputs: AudioInputDevice[];
  selectedAudioInputId: string;
  displayMode: DisplayMode;
  floatingWindowOpen: boolean;
  languagePair: LanguagePair;
  languageOptions: LanguageOption[];
  pairTargets: PairTarget[];
  focusDirectionLock: TargetLanguage | null;
  onLanguagePairChange: (side: "a" | "b", code: string) => void;
  onFocusDirectionChange: (lock: TargetLanguage | null) => void;
  onApiProviderChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onAudioInputChange: (deviceId: string) => void;
  onRefreshAudioInputs: () => void;
  onOpenSavePanel: () => void;
  onDisplayModeChange: (mode: DisplayMode) => void;
  onToggleFloatingWindow: () => void;
  onToggleFullscreen: () => void;
  onStart: () => void;
  onStop: () => void;
  onAwakeChange: (awake: boolean) => void;
};

export const ControlStrip = memo(function ControlStrip({
  status,
  isRunning,
  trialMode,
  trialCountdownSeconds,
  apiProvider,
  apiKeyLabel,
  apiKeyPlaceholder,
  apiKeyValue,
  audioInputs,
  selectedAudioInputId,
  displayMode,
  floatingWindowOpen,
  languagePair,
  languageOptions,
  pairTargets,
  focusDirectionLock,
  onLanguagePairChange,
  onFocusDirectionChange,
  onApiProviderChange,
  onApiKeyChange,
  onAudioInputChange,
  onRefreshAudioInputs,
  onOpenSavePanel,
  onDisplayModeChange,
  onToggleFloatingWindow,
  onToggleFullscreen,
  onStart,
  onStop,
  onAwakeChange,
}: ControlStripProps) {
  return (
    <header
      className="control-strip"
      aria-label="Translation controls"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onAwakeChange(false);
      }}
      onFocus={() => onAwakeChange(true)}
      onMouseEnter={() => onAwakeChange(true)}
      onMouseLeave={() => onAwakeChange(false)}
    >
      <div className="status-chip">
        <span className={`status-dot ${status}`} />
        <span>
          {status === "idle" && "Ready"}
          {status === "connecting" && "Connecting"}
          {status === "live" && "Live"}
          {status === "stopping" && "Stopping"}
          {status === "error" && "Error"}
        </span>
      </div>

      {trialCountdownSeconds !== null ? (
        <div
          aria-label="Trial time remaining"
          className={`trial-countdown${trialCountdownSeconds <= TRIAL_LOW_REMAINING_SECONDS ? " trial-countdown-low" : ""}`}
          role="timer"
        >
          Trial {formatTrialCountdown(trialCountdownSeconds)}
        </div>
      ) : null}

      <div className="switch-control" title="API provider">
        <span className="switch-label">Provider</span>
        <div aria-label="API provider" className="segmented-switch" role="group">
          {API_PROVIDERS.map((provider) => (
            <button
              aria-pressed={apiProvider === provider.code}
              className={`switch-option ${apiProvider === provider.code ? "switch-option-active" : ""}`}
              disabled={isRunning}
              key={provider.code}
              onClick={() => onApiProviderChange(provider.code)}
              type="button"
            >
              {provider.label}
            </button>
          ))}
        </div>
      </div>

      <label className="api-key-control" title={apiKeyLabel}>
        <span>API</span>
        <input
          aria-label={apiKeyLabel}
          autoCapitalize="none"
          autoComplete="off"
          className="api-key-input"
          disabled={isRunning}
          onChange={(event) => onApiKeyChange(event.currentTarget.value)}
          placeholder={apiKeyPlaceholder}
          spellCheck={false}
          type="password"
          value={apiKeyValue}
        />
      </label>

      <div className="switch-control" title="Translation language pair">
        <span className="switch-label">Lang</span>
        <select
          aria-label="First language"
          className="device-select language-select"
          disabled={isRunning}
          onChange={(event) => onLanguagePairChange("a", event.currentTarget.value)}
          value={languagePair.a}
        >
          {languageOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="language-swap">
          ⇄
        </span>
        <select
          aria-label="Second language"
          className="device-select language-select"
          disabled={isRunning}
          onChange={(event) => onLanguagePairChange("b", event.currentTarget.value)}
          value={languagePair.b}
        >
          {languageOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <label className="device-control" title="Audio input source">
        <span>Input</span>
        <select
          className="device-select"
          disabled={status === "connecting" || status === "stopping"}
          onChange={(event) => onAudioInputChange(event.currentTarget.value)}
          value={selectedAudioInputId}
        >
          <option value="">Default microphone</option>
          {audioInputs.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>

      <button className="tiny-button" onClick={onRefreshAudioInputs} title="Refresh audio inputs" type="button">
        Scan
      </button>

      <button className="tiny-button" onClick={onOpenSavePanel} title="Open saved transcript sessions" type="button">
        Save
      </button>

      <div className="segmented-switch view-switch" role="group" aria-label="Caption view">
        <button
          aria-pressed={displayMode === "dual"}
          className={`switch-option ${displayMode === "dual" ? "switch-option-active" : ""}`}
          onClick={() => onDisplayModeChange("dual")}
          title="Show English and Chinese captions together"
          type="button"
        >
          Split
        </button>
        <button
          aria-pressed={displayMode === "single"}
          className={`switch-option ${displayMode === "single" ? "switch-option-active" : ""}`}
          onClick={() => onDisplayModeChange("single")}
          title="Show one focused translation based on the spoken language"
          type="button"
        >
          Focus
        </button>
      </div>

      {displayMode === "single" ? (
        <div aria-label="Focus translation direction" className="segmented-switch direction-switch" role="group">
          <button
            aria-pressed={focusDirectionLock === null}
            className={`switch-option ${focusDirectionLock === null ? "switch-option-active" : ""}`}
            onClick={() => onFocusDirectionChange(null)}
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
              onClick={() => onFocusDirectionChange(focusDirectionLock === target.code ? null : target.code)}
              title={`Always show ${target.label} translations`}
              type="button"
            >
              {getLanguageShortLabel(target.code)}
            </button>
          ))}
        </div>
      ) : null}

      <button
        aria-pressed={floatingWindowOpen}
        className={`tiny-button ${floatingWindowOpen ? "mode-active" : ""}`}
        onClick={onToggleFloatingWindow}
        title="Open floating captions for PPT presentation"
        type="button"
      >
        Float
      </button>

      <button className="tiny-button" onClick={onToggleFullscreen} title="Toggle fullscreen" type="button">
        FS
      </button>

      <button className={isRunning ? "tiny-button danger" : "tiny-button primary"} onClick={isRunning ? onStop : onStart} type="button">
        {isRunning ? "Stop" : trialMode ? "Try 3 min free" : "Start"}
      </button>
    </header>
  );
});
