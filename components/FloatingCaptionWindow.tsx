"use client";

import { memo } from "react";
import type { CSSProperties } from "react";
import { getFloatingCaptionText, getFocusTargetLanguage } from "../lib/caption-text";
import { TARGETS } from "../lib/constants";
import type { CaptionFontSizeMap, CaptionMap, DisplayMode, FocusTranscriptSegment, TargetLanguage } from "../lib/types";

type FloatingCaptionStyle = CSSProperties & {
  "--floating-font-size-en": string;
  "--floating-font-size-zh": string;
};

type FloatingCaptionWindowProps = {
  captionFontSizes: CaptionFontSizeMap;
  captions: CaptionMap;
  displayMode: DisplayMode;
  focusSegments: FocusTranscriptSegment[];
  onClose: () => void;
  singleFallbackCaption: string;
  sourceLanguage: TargetLanguage;
};

export const FloatingCaptionWindow = memo(function FloatingCaptionWindow({
  captionFontSizes,
  captions,
  displayMode,
  focusSegments,
  onClose,
  singleFallbackCaption,
  sourceLanguage,
}: FloatingCaptionWindowProps) {
  const singleTargetLanguage = getFocusTargetLanguage(sourceLanguage);
  const latestFocusSegment = focusSegments[focusSegments.length - 1];
  const focusPanelLanguage = latestFocusSegment?.targetLanguage ?? singleTargetLanguage;
  const focusTarget = TARGETS.find((target) => target.code === focusPanelLanguage) ?? TARGETS[0];
  const singleCaption = getFloatingCaptionText(
    focusSegments.map((segment) => segment.text).join(" "),
    singleFallbackCaption
  );
  const floatingStyle: FloatingCaptionStyle = {
    "--floating-font-size-en": `${captionFontSizes.en}px`,
    "--floating-font-size-zh": `${captionFontSizes.zh}px`,
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
            {TARGETS.map((target) => (
              <section className={`floating-caption-card floating-caption-card-${target.code}`} key={target.code}>
                <span className="floating-language-label">{target.label}</span>
                <p>{getFloatingCaptionText(captions[target.code], target.placeholder)}</p>
              </section>
            ))}
          </div>
        ) : (
          <section
            className={`floating-caption-card floating-caption-card-${focusPanelLanguage} floating-caption-card-focus`}
          >
            <span className="floating-language-label">{focusTarget.label}</span>
            <p>{singleCaption}</p>
          </section>
        )}
      </div>
    </div>
  );
});
