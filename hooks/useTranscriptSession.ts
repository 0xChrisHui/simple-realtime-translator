"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  appendSavedCaptionDelta,
  createEmptyCaptionMap,
  createTranscriptId,
  formatTimestampForFile,
  getFocusTargetLanguage,
  normalizeTranscriptText,
} from "../lib/caption-text";
import {
  FOCUS_SEGMENT_MAX_CHARS,
  FOCUS_SEGMENT_STORAGE_LIMIT,
  FOCUS_TIMELINE_MAX_SEGMENTS,
  TRANSCRIPT_AUTOSAVE_DELAY_MS,
  TRANSCRIPT_PARTIAL_CHECKPOINT_MS,
} from "../lib/constants";
import {
  clearStoredTranscriptSessions,
  deleteStoredTranscriptSession,
  loadStoredTranscriptSessions,
  saveStoredTranscriptSession,
} from "../lib/transcript-db";
import {
  cloneCaptionMap,
  createStoredTranscriptSnapshot,
  formatTranscriptSession,
  getSessionLanguages,
  getTranscriptSessionEndTime,
  hasTranscriptText,
  sortStoredTranscriptSessions,
} from "../lib/transcript-session";
import type {
  ApiProvider,
  CaptionMap,
  FocusTranscriptSegment,
  LanguagePair,
  StoredTranscriptSession,
  TargetLanguage,
  TranscriptSessionStatus,
} from "../lib/types";

type UseTranscriptSessionParams = {
  apiProviderRef: MutableRefObject<ApiProvider>;
  sourceLanguageRef: MutableRefObject<TargetLanguage>;
  languagePairRef: MutableRefObject<LanguagePair>;
  // When set, the Focus timeline records this translation direction instead
  // of following the detected source language.
  focusTargetLockRef?: MutableRefObject<TargetLanguage | null>;
  setError: (updater: string | ((currentError: string) => string)) => void;
};

// Segments only feed the Focus timeline display and crash recovery; the full
// export text accumulates separately in transcriptText, so dropping the
// oldest finalized segments here never loses transcript content.
function pruneStoredSegments(session: StoredTranscriptSession) {
  const excess = session.segments.length - FOCUS_SEGMENT_STORAGE_LIMIT;
  if (excess <= 0) return;

  let removed = 0;
  session.segments = session.segments.filter((segment) => {
    if (removed >= excess || !segment.final) return true;
    removed += 1;
    return false;
  });
}

export function useTranscriptSession({
  apiProviderRef,
  sourceLanguageRef,
  languagePairRef,
  focusTargetLockRef,
  setError,
}: UseTranscriptSessionParams) {
  const [focusSegments, setFocusSegments] = useState<FocusTranscriptSegment[]>([]);
  const [transcriptSessions, setTranscriptSessions] = useState<StoredTranscriptSession[]>([]);
  const [transcriptReadyVisible, setTranscriptReadyVisible] = useState(false);

  const savedCaptionsRef = useRef<CaptionMap>(createEmptyCaptionMap());
  const activeTranscriptSessionRef = useRef<StoredTranscriptSession | null>(null);
  const focusPartialSegmentIdsRef = useRef<Partial<Record<TargetLanguage, string>>>({});
  const transcriptAutosaveTimerRef = useRef<number | null>(null);
  const transcriptLastPartialCheckpointRef = useRef(0);
  const pendingTranscriptSavesRef = useRef<Map<string, StoredTranscriptSession>>(new Map());
  const transcriptSaveLoopRef = useRef<Promise<void> | null>(null);
  const transcriptStorageErrorShownRef = useRef(false);
  const storedTranscriptSessionsLoadedRef = useRef(false);

  const notifyTranscriptStorageError = useCallback(() => {
    if (transcriptStorageErrorShownRef.current) return;

    transcriptStorageErrorShownRef.current = true;
    setError(
      (currentError) =>
        currentError ||
        "Transcript autosave is unavailable. Live captions will continue; use Download before closing this page."
    );
  }, [setError]);

  const runTranscriptSaveLoop = useCallback(() => {
    if (transcriptSaveLoopRef.current) return transcriptSaveLoopRef.current;

    const loop = (async () => {
      while (pendingTranscriptSavesRef.current.size) {
        const batch = Array.from(pendingTranscriptSavesRef.current.values());
        pendingTranscriptSavesRef.current.clear();

        for (const session of batch) {
          try {
            await saveStoredTranscriptSession(session);
          } catch (caughtError) {
            console.warn("Transcript autosave failed", caughtError);
            notifyTranscriptStorageError();
          }
        }
      }
    })().finally(() => {
      transcriptSaveLoopRef.current = null;
      if (pendingTranscriptSavesRef.current.size) void runTranscriptSaveLoop();
    });

    transcriptSaveLoopRef.current = loop;
    return loop;
  }, [notifyTranscriptStorageError]);

  const queueStoredTranscriptSessionSave = useCallback(
    (session: StoredTranscriptSession) => {
      pendingTranscriptSavesRef.current.set(session.id, session);
      return runTranscriptSaveLoop();
    },
    [runTranscriptSaveLoop]
  );

  const clearTranscriptAutosaveTimer = useCallback(() => {
    if (transcriptAutosaveTimerRef.current === null) return;

    window.clearTimeout(transcriptAutosaveTimerRef.current);
    transcriptAutosaveTimerRef.current = null;
  }, []);

  const saveActiveTranscriptSnapshot = useCallback(
    (statusOverride?: TranscriptSessionStatus) => {
      const activeSession = activeTranscriptSessionRef.current;
      if (!activeSession) return Promise.resolve();

      const snapshot = createStoredTranscriptSnapshot(activeSession, statusOverride ?? activeSession.status);
      activeSession.status = snapshot.status;
      activeSession.stoppedAt = snapshot.stoppedAt;
      activeSession.updatedAt = snapshot.updatedAt;

      return queueStoredTranscriptSessionSave(snapshot);
    },
    [queueStoredTranscriptSessionSave]
  );

  const scheduleActiveTranscriptAutosave = useCallback(
    (reason: "final" | "partial") => {
      if (!activeTranscriptSessionRef.current) return;

      const now = Date.now();
      if (reason === "partial") {
        if (now - transcriptLastPartialCheckpointRef.current < TRANSCRIPT_PARTIAL_CHECKPOINT_MS) return;
        transcriptLastPartialCheckpointRef.current = now;
      }

      if (transcriptAutosaveTimerRef.current !== null) return;

      transcriptAutosaveTimerRef.current = window.setTimeout(() => {
        transcriptAutosaveTimerRef.current = null;
        void saveActiveTranscriptSnapshot("draft");
      }, TRANSCRIPT_AUTOSAVE_DELAY_MS);
    },
    [saveActiveTranscriptSnapshot]
  );

  const appendSessionTranscriptText = useCallback(
    (language: TargetLanguage, delta: string, reason: "final" | "partial" = "partial") => {
      const activeSession = activeTranscriptSessionRef.current;
      const nextText = appendSavedCaptionDelta(savedCaptionsRef.current[language] ?? "", delta);

      savedCaptionsRef.current = {
        ...savedCaptionsRef.current,
        [language]: nextText,
      };

      if (activeSession) {
        activeSession.transcriptText = {
          ...activeSession.transcriptText,
          [language]: nextText,
        };
        scheduleActiveTranscriptAutosave(reason);
      }

      return nextText;
    },
    [scheduleActiveTranscriptAutosave]
  );

  const deleteStoredTranscriptSessionSafely = useCallback(
    async (sessionId: string) => {
      pendingTranscriptSavesRef.current.delete(sessionId);

      const activeSaveLoop = transcriptSaveLoopRef.current;
      if (activeSaveLoop) await activeSaveLoop;

      try {
        await deleteStoredTranscriptSession(sessionId);
      } catch (caughtError) {
        console.warn("Transcript delete failed", caughtError);
        notifyTranscriptStorageError();
      }
    },
    [notifyTranscriptStorageError]
  );

  useEffect(() => {
    if (storedTranscriptSessionsLoadedRef.current) return;

    storedTranscriptSessionsLoadedRef.current = true;
    let cancelled = false;

    const restoreStoredTranscriptSessions = async () => {
      try {
        const storedSessions = await loadStoredTranscriptSessions();
        const visibleSessions: StoredTranscriptSession[] = [];

        for (const session of storedSessions) {
          const normalizedSession = createStoredTranscriptSnapshot(session, session.status, session.updatedAt);

          if (!hasTranscriptText(normalizedSession)) {
            if (session.status === "draft" || session.status === "recovered") {
              void deleteStoredTranscriptSession(session.id).catch((caughtError) => {
                console.warn("Empty transcript cleanup failed", caughtError);
                notifyTranscriptStorageError();
              });
            }
            continue;
          }

          if (normalizedSession.status === "draft") {
            const recoveredSession: StoredTranscriptSession = {
              ...normalizedSession,
              stoppedAt: getTranscriptSessionEndTime(normalizedSession),
              status: "recovered",
              updatedAt: Date.now(),
            };
            visibleSessions.push(recoveredSession);
            void queueStoredTranscriptSessionSave(recoveredSession);
            continue;
          }

          visibleSessions.push(normalizedSession);
        }

        if (!cancelled) setTranscriptSessions(sortStoredTranscriptSessions(visibleSessions));
      } catch (caughtError) {
        console.warn("Transcript restore failed", caughtError);
        notifyTranscriptStorageError();
      }
    };

    void restoreStoredTranscriptSessions();

    return () => {
      cancelled = true;
    };
  }, [notifyTranscriptStorageError, queueStoredTranscriptSessionSave]);

  useEffect(() => clearTranscriptAutosaveTimer, [clearTranscriptAutosaveTimer]);

  const publishFocusSegments = useCallback((segments?: FocusTranscriptSegment[]) => {
    const source = segments ?? activeTranscriptSessionRef.current?.segments ?? [];
    setFocusSegments(source.slice(-FOCUS_TIMELINE_MAX_SEGMENTS));
  }, []);

  const finalizeCurrentFocusSegments = useCallback(() => {
    const session = activeTranscriptSessionRef.current;
    if (!session) return;

    const now = Date.now();
    let changed = false;
    session.segments = session.segments.map((segment) => {
      if (segment.final) return segment;

      changed = true;
      return {
        ...segment,
        text: normalizeTranscriptText(segment.text),
        final: true,
        updatedAt: now,
      };
    });
    focusPartialSegmentIdsRef.current = {};

    if (changed) {
      publishFocusSegments(session.segments);
      scheduleActiveTranscriptAutosave("final");
    }
  }, [publishFocusSegments, scheduleActiveTranscriptAutosave]);

  const appendFocusTranslationDelta = useCallback(
    (targetLanguage: TargetLanguage, delta: string) => {
      const session = activeTranscriptSessionRef.current;
      if (!session) return;

      const sourceLanguage = sourceLanguageRef.current;
      const desiredTarget =
        focusTargetLockRef?.current ?? getFocusTargetLanguage(sourceLanguage, languagePairRef.current);
      if (targetLanguage !== desiredTarget) return;

      const normalizedDelta = delta.replace(/[ \t\r\n]+/g, " ");
      if (!normalizedDelta.trim()) return;

      const now = Date.now();
      const partialId = focusPartialSegmentIdsRef.current[targetLanguage];
      let segment = session.segments.find(
        (candidate) =>
          candidate.id === partialId &&
          !candidate.final &&
          candidate.sourceLanguage === sourceLanguage &&
          candidate.targetLanguage === targetLanguage
      );

      if (segment) {
        const nextText = normalizeTranscriptText(`${segment.text}${normalizedDelta}`);
        if (segment.text && nextText.length > FOCUS_SEGMENT_MAX_CHARS) {
          segment.final = true;
          segment.updatedAt = now;
          segment = undefined;
        } else {
          segment.text = nextText;
          segment.updatedAt = now;
        }
      }

      if (!segment) {
        segment = {
          id: createTranscriptId("focus"),
          sourceLanguage,
          targetLanguage,
          text: normalizeTranscriptText(normalizedDelta),
          final: false,
          startedAt: now,
          updatedAt: now,
        };
        session.segments.push(segment);
        focusPartialSegmentIdsRef.current[targetLanguage] = segment.id;
        pruneStoredSegments(session);
      }

      publishFocusSegments(session.segments);
      scheduleActiveTranscriptAutosave("partial");
    },
    [focusTargetLockRef, languagePairRef, publishFocusSegments, scheduleActiveTranscriptAutosave, sourceLanguageRef]
  );

  const beginTranscriptSession = useCallback(() => {
    const now = Date.now();
    const pair = languagePairRef.current;
    const session: StoredTranscriptSession = {
      id: createTranscriptId("session"),
      startedAt: now,
      stoppedAt: 0,
      provider: apiProviderRef.current,
      languages: [pair.a, pair.b],
      segments: [],
      transcriptText: createEmptyCaptionMap(pair),
      status: "draft",
      updatedAt: now,
    };
    activeTranscriptSessionRef.current = session;
    focusPartialSegmentIdsRef.current = {};
    transcriptLastPartialCheckpointRef.current = now;
    setFocusSegments([]);
    setTranscriptReadyVisible(false);
    void queueStoredTranscriptSessionSave(session);
  }, [apiProviderRef, languagePairRef, queueStoredTranscriptSessionSave]);

  const discardActiveTranscriptSession = useCallback(async () => {
    const activeSessionId = activeTranscriptSessionRef.current?.id;
    clearTranscriptAutosaveTimer();
    activeTranscriptSessionRef.current = null;
    focusPartialSegmentIdsRef.current = {};
    setFocusSegments([]);
    if (activeSessionId) await deleteStoredTranscriptSessionSafely(activeSessionId);
  }, [clearTranscriptAutosaveTimer, deleteStoredTranscriptSessionSafely]);

  const finishActiveTranscriptSession = useCallback(async () => {
    const activeSession = activeTranscriptSessionRef.current;
    if (!activeSession) return;

    clearTranscriptAutosaveTimer();
    finalizeCurrentFocusSegments();
    clearTranscriptAutosaveTimer();

    const stoppedAt = Date.now();
    const finalSegments = activeSession.segments
      .map((segment) => ({
        ...segment,
        text: normalizeTranscriptText(segment.text),
        final: true,
        updatedAt: segment.updatedAt || stoppedAt,
      }))
      .filter((segment) => segment.text);

    activeTranscriptSessionRef.current = null;
    focusPartialSegmentIdsRef.current = {};

    const transcriptText = cloneCaptionMap(activeSession.transcriptText, getSessionLanguages(activeSession));

    if (!Object.values(transcriptText).some(Boolean)) {
      await deleteStoredTranscriptSessionSafely(activeSession.id);
      return;
    }

    const session: StoredTranscriptSession = {
      ...activeSession,
      stoppedAt,
      segments: finalSegments,
      transcriptText,
      status: "completed",
      updatedAt: stoppedAt,
    };

    await queueStoredTranscriptSessionSave(session);
    setTranscriptSessions((previous) => sortStoredTranscriptSessions([session, ...previous]));
    setTranscriptReadyVisible(true);
    publishFocusSegments(session.segments);
  }, [
    clearTranscriptAutosaveTimer,
    deleteStoredTranscriptSessionSafely,
    finalizeCurrentFocusSegments,
    publishFocusSegments,
    queueStoredTranscriptSessionSave,
  ]);

  const resetTranscriptCaptureState = useCallback(() => {
    setFocusSegments([]);
    savedCaptionsRef.current = createEmptyCaptionMap(languagePairRef.current);
    focusPartialSegmentIdsRef.current = {};
  }, [languagePairRef]);

  const downloadTranscriptSession = useCallback(
    (session: StoredTranscriptSession) => {
      if (!hasTranscriptText(session)) {
        setError("This transcript is empty.");
        return;
      }

      const content = formatTranscriptSession(session);
      const blob = new Blob([`\uFEFF${content}`], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `translation-${session.provider}-${formatTimestampForFile(new Date(session.startedAt))}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);

      const downloadedSession: StoredTranscriptSession = {
        ...session,
        downloaded: true,
        updatedAt: Date.now(),
      };
      setTranscriptSessions((previous) =>
        sortStoredTranscriptSessions(
          previous.map((candidate) => (candidate.id === session.id ? downloadedSession : candidate))
        )
      );
      void queueStoredTranscriptSessionSave(downloadedSession);
    },
    [queueStoredTranscriptSessionSave, setError]
  );

  const deleteTranscriptSession = useCallback(
    async (sessionId: string) => {
      setTranscriptSessions((previous) => previous.filter((session) => session.id !== sessionId));
      await deleteStoredTranscriptSessionSafely(sessionId);
    },
    [deleteStoredTranscriptSessionSafely]
  );

  const clearTranscriptSessionHistory = useCallback(async () => {
    if (!transcriptSessions.length) return;
    if (!window.confirm("Clear all saved transcript history? This cannot be undone.")) return;

    const activeSessionId = activeTranscriptSessionRef.current?.id;
    for (const sessionId of Array.from(pendingTranscriptSavesRef.current.keys())) {
      if (sessionId !== activeSessionId) pendingTranscriptSavesRef.current.delete(sessionId);
    }

    const activeSaveLoop = transcriptSaveLoopRef.current;
    if (activeSaveLoop) await activeSaveLoop;

    try {
      await clearStoredTranscriptSessions({ preserveSessionId: activeSessionId });
      setTranscriptSessions([]);
    } catch (caughtError) {
      console.warn("Transcript clear failed", caughtError);
      notifyTranscriptStorageError();
    }
  }, [notifyTranscriptStorageError, transcriptSessions.length]);

  return {
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
  };
}
