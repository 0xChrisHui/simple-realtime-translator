"use client";

import { memo } from "react";
import { TARGETS } from "../lib/constants";
import type { CaptionMap, DisplayMode, FocusTranscriptSegment, TargetLanguage } from "../lib/types";

type CaptionStageProps = {
  displayMode: DisplayMode;
  captions: CaptionMap;
  focusSegments: FocusTranscriptSegment[];
  focusPanelLanguage: TargetLanguage;
  focusPanelLabel: string;
  waitingTranslationText: string;
  error: string;
  setScrollerRef: (code: TargetLanguage, element: HTMLDivElement | null) => void;
};

export const CaptionStage = memo(function CaptionStage({
  displayMode,
  captions,
  focusSegments,
  focusPanelLanguage,
  focusPanelLabel,
  waitingTranslationText,
  error,
  setScrollerRef,
}: CaptionStageProps) {
  return (
    <section className={displayMode === "dual" ? "dual-caption-stage" : "single-caption-stage"} aria-live="polite">
      {displayMode === "dual" ? (
        TARGETS.map((target) => (
          <article className={`caption-panel caption-panel-${target.code}`} key={target.code}>
            <div className="caption-header">
              <span>{target.label}</span>
            </div>
            <div className="caption-scroll" ref={(element) => setScrollerRef(target.code, element)}>
              <p>{captions[target.code] || target.placeholder}</p>
            </div>
          </article>
        ))
      ) : (
        <article className={`caption-panel caption-panel-${focusPanelLanguage} single-caption-panel`}>
          <div className="caption-header">
            <span>{focusPanelLabel}</span>
          </div>
          <div
            className={`caption-scroll single-caption-scroll ${
              focusSegments.length ? "" : "single-caption-scroll-placeholder"
            }`}
          >
            {focusSegments.length ? (
              <div className="focus-timeline">
                {focusSegments.map((segment) => (
                  <p
                    className={`focus-segment focus-segment-${segment.targetLanguage} ${
                      segment.final ? "focus-segment-final" : "focus-segment-partial"
                    }`}
                    key={segment.id}
                  >
                    {segment.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="single-caption-placeholder">{waitingTranslationText}</p>
            )}
          </div>
        </article>
      )}

      {error ? <div className="error-banner">{error}</div> : null}
    </section>
  );
});
