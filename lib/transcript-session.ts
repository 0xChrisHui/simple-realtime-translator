import {
  appendSavedCaptionDelta,
  formatTimestampForText,
  normalizeTranscriptText,
} from "./caption-text";
import { DEFAULT_LANGUAGE_PAIR } from "./languages";
import {
  isApiProvider,
  isRecord,
  isTargetLanguage,
  isTranscriptSessionStatus,
  readTimestamp,
  type CaptionMap,
  type FocusTranscriptSegment,
  type StoredTranscriptSession,
  type TargetLanguage,
  type TranscriptSession,
  type TranscriptSessionStatus,
} from "./types";

const DEFAULT_SESSION_LANGUAGES: [TargetLanguage, TargetLanguage] = [DEFAULT_LANGUAGE_PAIR.a, DEFAULT_LANGUAGE_PAIR.b];

// Sessions stored before language selection existed have no languages field.
export function getSessionLanguages(session: TranscriptSession): [TargetLanguage, TargetLanguage] {
  return session.languages ?? DEFAULT_SESSION_LANGUAGES;
}

export function readSessionLanguages(value: unknown): [TargetLanguage, TargetLanguage] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;

  const [a, b] = value;
  if (!isTargetLanguage(a) || !isTargetLanguage(b) || a === b) return undefined;
  return [a, b];
}

export function getSessionTextSegments(session: TranscriptSession) {
  return session.segments.filter((segment) => normalizeTranscriptText(segment.text));
}

export function cloneCaptionMap(value: CaptionMap, languages: readonly TargetLanguage[]): CaptionMap {
  const cloned: CaptionMap = {};
  languages.forEach((code) => {
    cloned[code] = normalizeTranscriptText(value[code] ?? "");
  });
  return cloned;
}

export function readTranscriptTextMap(value: unknown, languages: readonly TargetLanguage[]): CaptionMap {
  const map: CaptionMap = {};
  languages.forEach((code) => {
    const text = isRecord(value) ? value[code] : "";
    map[code] = typeof text === "string" ? normalizeTranscriptText(text) : "";
  });
  return map;
}

export function createTranscriptTextFromSegments(segments: FocusTranscriptSegment[]) {
  return segments.reduce<CaptionMap>((transcriptText, segment) => {
    const text = normalizeTranscriptText(segment.text);
    if (!text) return transcriptText;

    return {
      ...transcriptText,
      [segment.targetLanguage]: appendSavedCaptionDelta(transcriptText[segment.targetLanguage] ?? "", text),
    };
  }, {});
}

function hasAnyText(map: CaptionMap) {
  return Object.values(map).some(Boolean);
}

export function getSessionTranscriptText(session: TranscriptSession): CaptionMap {
  const transcriptText = cloneCaptionMap(session.transcriptText, getSessionLanguages(session));
  if (hasAnyText(transcriptText)) return transcriptText;

  return createTranscriptTextFromSegments(getSessionTextSegments(session));
}

export function hasTranscriptText(session: TranscriptSession) {
  return hasAnyText(getSessionTranscriptText(session));
}

export function getTranscriptSessionEndTime(session: TranscriptSession) {
  if (session.stoppedAt > 0) return session.stoppedAt;

  return session.segments.reduce((latest, segment) => Math.max(latest, segment.updatedAt || segment.startedAt), session.startedAt);
}

export function formatSessionTimeRange(session: TranscriptSession) {
  const start = new Date(session.startedAt);
  const stop = new Date(getTranscriptSessionEndTime(session));
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return `${day} ${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(stop.getHours())}:${pad(stop.getMinutes())}`;
}

export function formatTranscriptSession(session: TranscriptSession) {
  const transcriptText = getSessionTranscriptText(session);

  return [
    "Simple Realtime Translator",
    `Session: ${formatTimestampForText(new Date(session.startedAt))} - ${formatTimestampForText(
      new Date(getTranscriptSessionEndTime(session))
    )}`,
    "",
    "如果需要中文，请翻到页面下方",
    "If you need Chinese, please refer to the second half of the document.",
    "",
    "English",
    transcriptText.en ?? "",
    "",
    "Chinese",
    transcriptText.zh ?? "",
    "",
  ].join("\n");
}

export function normalizeStoredTranscriptSegment(value: unknown): FocusTranscriptSegment | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "string" ? value.id : "";
  const sourceLanguage = isTargetLanguage(value.sourceLanguage) ? value.sourceLanguage : null;
  const targetLanguage = isTargetLanguage(value.targetLanguage) ? value.targetLanguage : null;
  const text = typeof value.text === "string" ? normalizeTranscriptText(value.text) : "";
  const startedAt = readTimestamp(value.startedAt);
  const updatedAt = readTimestamp(value.updatedAt) || startedAt;

  if (!id || !sourceLanguage || !targetLanguage || !text || !startedAt) return null;

  return {
    id,
    sourceLanguage,
    targetLanguage,
    text,
    final: value.final === true,
    startedAt,
    updatedAt,
  };
}

export function cloneTranscriptSegments(segments: unknown[]) {
  return segments
    .map(normalizeStoredTranscriptSegment)
    .filter((segment): segment is FocusTranscriptSegment => Boolean(segment));
}

export function normalizeStoredTranscriptSession(value: unknown): StoredTranscriptSession | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === "string" ? value.id : "";
  const startedAt = readTimestamp(value.startedAt);
  const stoppedAt = readTimestamp(value.stoppedAt);
  const provider = isApiProvider(value.provider) ? value.provider : null;
  const status = isTranscriptSessionStatus(value.status) ? value.status : stoppedAt ? "completed" : "draft";
  const updatedAt = readTimestamp(value.updatedAt) || stoppedAt || startedAt;
  const languages = readSessionLanguages(value.languages);
  const segments = Array.isArray(value.segments) ? cloneTranscriptSegments(value.segments) : [];
  const storedTranscriptText = readTranscriptTextMap(value.transcriptText, languages ?? DEFAULT_SESSION_LANGUAGES);
  const transcriptText = Object.values(storedTranscriptText).some(Boolean)
    ? storedTranscriptText
    : createTranscriptTextFromSegments(segments);

  if (!id || !startedAt || !provider) return null;

  return {
    id,
    startedAt,
    stoppedAt,
    provider,
    ...(languages ? { languages } : {}),
    segments,
    transcriptText,
    downloaded: value.downloaded === true,
    status,
    updatedAt,
  };
}

export function createStoredTranscriptSnapshot(
  session: StoredTranscriptSession,
  status: TranscriptSessionStatus = session.status,
  updatedAt = Date.now()
): StoredTranscriptSession {
  const stoppedAt = status === "draft" ? session.stoppedAt : session.stoppedAt || updatedAt;

  return {
    ...session,
    stoppedAt,
    status,
    updatedAt,
    segments: cloneTranscriptSegments(session.segments),
    transcriptText: getSessionTranscriptText(session),
  };
}

export function sortStoredTranscriptSessions(sessions: StoredTranscriptSession[]) {
  return [...sessions].sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === "recovered") return -1;
      if (b.status === "recovered") return 1;
    }

    return (b.updatedAt || b.startedAt) - (a.updatedAt || a.startedAt);
  });
}
