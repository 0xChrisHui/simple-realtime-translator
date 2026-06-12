"use client";

import { memo } from "react";
import type { CSSProperties } from "react";
import { getFloatingCaptionText, getFocusTargetLanguage } from "../lib/caption-text";
import { getCaptionLineHeightRatio, getDefaultCaptionFontSize, type PairTarget } from "../lib/languages";
import type { CaptionFontSizeMap, CaptionMap, DisplayMode, FocusTranscriptSegment, LanguagePair, TargetLanguage } from "../lib/types";

type FloatingCaptionStyle = CSSProperties & {
  "--floating-font-size-a": string;
  "--floating-font-size-b": string;
  "--floating-line-height-a": string;
  "--floating-line-height-b": string;
};

type FloatingCaptionWindowProps = {
  captionFontSizes: CaptionFontSizeMap;
  captions: CaptionMap;
  displayMode: DisplayMode;
  focusSegments: FocusTranscriptSegment[];
  languagePair: LanguagePair;
  onClose: () => void;
  singleFallbackCaption: string;
  sourceLanguage: TargetLanguage;
  targets: PairTarget[];
};

export const FloatingCaptionWindow = memo(function FloatingCaptionWindow({
  captionFontSizes,
  captions,
  displayMode,
  focusSegments,
  languagePair,
  onClose,
  singleFallbackCaption,
  sourceLanguage,
  targets,
}: FloatingCaptionWindowProps) {
  const singleTargetLanguage = getFocusTargetLanguage(sourceLanguage, languagePair);
  const latestFocusSegment = focusSegments[focusSegments.length - 1];
  const focusPanelLanguage = latestFocusSegment?.targetLanguage ?? singleTargetLanguage;
  const focusTarget = targets.find((target) => target.code === focusPanelLanguage) ?? targets[0];
  const focusSlot = targets[0]?.code === focusPanelLanguage ? "a" : "b";
  const singleCaption = getFloatingCaptionText(
    focusSegments.map((segment) => segment.text).join(" "),
    singleFallbackCaption
  );
  const fontSizeOf = (code: TargetLanguage) => captionFontSizes[code] ?? getDefaultCaptionFontSize(code);
  const floatingStyle: FloatingCaptionStyle = {
    "--floating-font-size-a": `${fontSizeOf(languagePair.a)}px`,
    "--floating-font-size-b": `${fontSizeOf(languagePair.b)}px`,
    "--floating-line-height-a": String(getCaptionLineHeightRatio(languagePair.a)),
    "--floating-line-height-b": String(getCaptionLineHeightRatio(languagePair.b)),
  };

  return (
    <div className="floating-caption-shell" style={floatingStyle}>
      <div className="floating-caption-topbar">
        <span className="floating-caption-title">
          {displayMode === "dual" ? "Split View" : `${focusTarget.label} - Focus View`}
        </span>
        <button className="floating-close-button" onClick={onClose} title="Close floating captions" type="button">
          Close
        </button>
      </div>

      <div className="floating-caption-content" aria-live="polite">
        {displayMode === "dual" ? (
          <div className="floating-dual-grid">
            {targets.map((target, index) => (
              <section className={`floating-caption-card floating-caption-card-${index === 0 ? "a" : "b"}`} key={target.code}>
                <span className="floating-language-label">{target.label}</span>
                <p dir="auto">{getFloatingCaptionText(captions[target.code] ?? "", target.placeholder)}</p>
              </section>
            ))}
          </div>
        ) : (
          <section className={`floating-caption-card floating-caption-card-${focusSlot} floating-caption-card-focus`}>
            <span className="floating-language-label">{focusTarget.label}</span>
            <p dir="auto">{singleCaption}</p>
          </section>
        )}
      </div>
    </div>
  );
});
