import { isLanguageCode, type LanguageCode, type LanguagePair } from "./languages";

export type Status = "idle" | "connecting" | "live" | "stopping" | "error";
export type ApiProvider = "openai" | "soniox";
export type TargetLanguage = LanguageCode;
export type { LanguagePair };
export type CaptionMap = Partial<Record<TargetLanguage, string>>;
export type DisplayMode = "dual" | "single";
export type AudioInputDevice = {
  deviceId: string;
  label: string;
};
export type CaptionFontSizeMap = Partial<Record<TargetLanguage, number>>;
export type CaptionFontSizeInputMap = Partial<Record<TargetLanguage, string>>;

export type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  [key: string]: unknown;
};
export type SourceLanguageSwitchCandidate = {
  language: TargetLanguage;
  firstSeenAt: number;
  lastSeenAt: number;
  chunks: number;
  evidence: number;
};
export type FocusTranscriptSegment = {
  id: string;
  sourceLanguage: TargetLanguage;
  targetLanguage: TargetLanguage;
  text: string;
  final: boolean;
  startedAt: number;
  updatedAt: number;
};
export type TranscriptSession = {
  id: string;
  startedAt: number;
  stoppedAt: number;
  provider: ApiProvider;
  // The language pair the session was recorded with, in pair order. Sessions
  // stored before language selection existed lack it and default to en/zh.
  languages?: [TargetLanguage, TargetLanguage];
  segments: FocusTranscriptSegment[];
  transcriptText: CaptionMap;
  downloaded?: boolean;
};
export type TranscriptSessionStatus = "draft" | "completed" | "recovered";
export type StoredTranscriptSession = TranscriptSession & {
  status: TranscriptSessionStatus;
  updatedAt: number;
};
export type SonioxCaptionBuffer = {
  finalDisplay: CaptionMap;
  partialDisplay: CaptionMap;
  finalOriginal: CaptionMap;
  partialOriginal: CaptionMap;
  finalTranslation: CaptionMap;
  partialTranslation: CaptionMap;
};
export type SonioxTokenKind = "original" | "translation";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function readTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return isLanguageCode(value);
}

export function isApiProvider(value: unknown): value is ApiProvider {
  return value === "openai" || value === "soniox";
}

export function isTranscriptSessionStatus(value: unknown): value is TranscriptSessionStatus {
  return value === "draft" || value === "completed" || value === "recovered";
}
