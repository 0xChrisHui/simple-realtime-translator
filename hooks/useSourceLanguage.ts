"use client";

import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { getInputLanguageEvidence } from "../lib/caption-text";
import {
  SOURCE_LANGUAGE_SWITCH_DELAY_MS,
  SOURCE_LANGUAGE_SWITCH_MAX_GAP_MS,
  SOURCE_LANGUAGE_SWITCH_MIN_CHUNKS,
} from "../lib/constants";
import { getMinSwitchEvidence } from "../lib/languages";
import type { LanguagePair, SourceLanguageSwitchCandidate, TargetLanguage } from "../lib/types";

type UseSourceLanguageParams = {
  sourceLanguageRef: MutableRefObject<TargetLanguage>;
  languagePairRef: MutableRefObject<LanguagePair>;
  finalizeCurrentFocusSegments: () => void;
  onCommittedSourceLanguageChange?: (language: TargetLanguage) => void;
};

export function useSourceLanguage({
  sourceLanguageRef,
  languagePairRef,
  finalizeCurrentFocusSegments,
  onCommittedSourceLanguageChange,
}: UseSourceLanguageParams) {
  const [sourceLanguage, setSourceLanguage] = useState<TargetLanguage>(languagePairRef.current.a);

  const sourceLanguageConfirmedRef = useRef(false);
  const sourceLanguageSwitchCandidateRef = useRef<SourceLanguageSwitchCandidate | null>(null);
  const lastInputLanguageRef = useRef<TargetLanguage>(languagePairRef.current.a);

  const commitSourceLanguage = useCallback(
    (language: TargetLanguage) => {
      const languageChanged = sourceLanguageRef.current !== language;
      if (sourceLanguageConfirmedRef.current && languageChanged) {
        finalizeCurrentFocusSegments();
      }

      sourceLanguageRef.current = language;
      sourceLanguageConfirmedRef.current = true;
      sourceLanguageSwitchCandidateRef.current = null;
      setSourceLanguage(language);

      if (languageChanged) onCommittedSourceLanguageChange?.(language);
    },
    [finalizeCurrentFocusSegments, onCommittedSourceLanguageChange, sourceLanguageRef]
  );

  const trackSourceLanguageEvidence = useCallback(
    (inputLanguage: TargetLanguage, evidence: number) => {
      if (evidence <= 0) return;

      const committedLanguage = sourceLanguageRef.current;
      if (!sourceLanguageConfirmedRef.current) {
        commitSourceLanguage(inputLanguage);
        return;
      }

      if (inputLanguage === committedLanguage) {
        sourceLanguageSwitchCandidateRef.current = null;
        return;
      }

      const now = Date.now();
      const pending = sourceLanguageSwitchCandidateRef.current;
      const shouldStartCandidate =
        !pending ||
        pending.language !== inputLanguage ||
        now - pending.lastSeenAt > SOURCE_LANGUAGE_SWITCH_MAX_GAP_MS;

      const candidate: SourceLanguageSwitchCandidate = shouldStartCandidate
        ? {
            language: inputLanguage,
            firstSeenAt: now,
            lastSeenAt: now,
            chunks: 1,
            evidence,
          }
        : {
            ...pending,
            lastSeenAt: now,
            chunks: pending.chunks + 1,
            evidence: pending.evidence + evidence,
          };

      sourceLanguageSwitchCandidateRef.current = candidate;

      const hasStayedLongEnough = now - candidate.firstSeenAt >= SOURCE_LANGUAGE_SWITCH_DELAY_MS;
      const hasEnoughEvidence =
        candidate.chunks >= SOURCE_LANGUAGE_SWITCH_MIN_CHUNKS &&
        candidate.evidence >= getMinSwitchEvidence(candidate.language);

      if (hasStayedLongEnough && hasEnoughEvidence) {
        commitSourceLanguage(candidate.language);
      }
    },
    [commitSourceLanguage, sourceLanguageRef]
  );

  const trackSourceLanguage = useCallback(
    (inputLanguage: TargetLanguage, delta: string) => {
      trackSourceLanguageEvidence(inputLanguage, getInputLanguageEvidence(delta, inputLanguage));
    },
    [trackSourceLanguageEvidence]
  );

  const resetSourceLanguageTracking = useCallback(() => {
    const initialLanguage = languagePairRef.current.a;
    setSourceLanguage(initialLanguage);
    sourceLanguageRef.current = initialLanguage;
    sourceLanguageConfirmedRef.current = false;
    sourceLanguageSwitchCandidateRef.current = null;
    lastInputLanguageRef.current = initialLanguage;
  }, [languagePairRef, sourceLanguageRef]);

  return {
    sourceLanguage,
    lastInputLanguageRef,
    trackSourceLanguage,
    trackSourceLanguageEvidence,
    resetSourceLanguageTracking,
  };
}
