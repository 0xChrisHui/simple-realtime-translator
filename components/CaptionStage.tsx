"use client";

import { memo } from "react";
import type { PairTarget } from "../lib/languages";
import type { CaptionMap, DisplayMode, FocusTranscriptSegment, TargetLanguage } from "../lib/types";

type CaptionStageProps = {
  displayMode: DisplayMode;
  captions: CaptionMap;
  targets: PairTarget[];
  focusSegments: FocusTranscriptSegment[];
  focusPanelLanguage: TargetLanguage;
  focusPanelLabel: string;
  waitingTranslationText: string;
  error: string;
  setScrollerRef: (code: TargetLanguage, element: HTMLDivElement | null) => void;
};

// Pair slot of a language: "a" for the first language of the active pair,
// "b" otherwise. Panel colors and font variables are keyed by slot.
function getPairSlot(targets: PairTarget[], code: TargetLanguage) {
  return targets[0]?.code === code ? "a" : "b";
}

export const CaptionStage = memo(function CaptionStage({
  displayMode,
  captions,
  targets,
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
        targets.map((target, index) => (
          <article className={`caption-panel caption-panel-${index === 0 ? "a" : "b"}`} key={target.code}>
            <div className="caption-header">
              <span>{target.label}</span>
            </div>
            <div className="caption-scroll" ref={(element) => setScrollerRef(target.code, element)}>
              <p dir="auto">{captions[target.code] || target.placeholder}</p>
            </div>
          </article>
        ))
      ) : (
        <article className={`caption-panel caption-panel-${getPairSlot(targets, focusPanelLanguage)} single-caption-panel`}>
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
                    className={`focus-segment focus-segment-${getPairSlot(targets, segment.targetLanguage)} ${
                      segment.final ? "focus-segment-final" : "focus-segment-partial"
                    }`}
                    dir="auto"
                    key={segment.id}
                  >
                    {segment.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="single-caption-placeholder" dir="auto">
                {waitingTranslationText}
              </p>
            )}
          </div>
        </article>
      )}

      {error ? <div className="error-banner">{error}</div> : null}
    </section>
  );
});
