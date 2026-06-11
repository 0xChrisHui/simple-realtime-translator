"use client";

import { API_PROVIDERS } from "../lib/constants";
import type { ApiProvider, AudioInputDevice, DisplayMode, Status } from "../lib/types";

type ControlStripProps = {
  status: Status;
  isRunning: boolean;
  apiProvider: ApiProvider;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  apiKeyValue: string;
  audioInputs: AudioInputDevice[];
  selectedAudioInputId: string;
  displayMode: DisplayMode;
  floatingWindowOpen: boolean;
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

export function ControlStrip({
  status,
  isRunning,
  apiProvider,
  apiKeyLabel,
  apiKeyPlaceholder,
  apiKeyValue,
  audioInputs,
  selectedAudioInputId,
  displayMode,
  floatingWindowOpen,
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
        {isRunning ? "Stop" : "Start"}
      </button>
    </header>
  );
}
