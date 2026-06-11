export type Status = "idle" | "connecting" | "live" | "stopping" | "error";
export type ApiProvider = "openai" | "soniox";
export type TargetLanguage = "en" | "zh";
export type CaptionMap = Record<TargetLanguage, string>;
export type DisplayMode = "dual" | "single";
export type AudioInputDevice = {
  deviceId: string;
  label: string;
};
export type CaptionFontSizeMap = Record<TargetLanguage, number>;
export type CaptionFontSizeInputMap = Record<TargetLanguage, string>;

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
  return value === "en" || value === "zh";
}

export function isApiProvider(value: unknown): value is ApiProvider {
  return value === "openai" || value === "soniox";
}

export function isTranscriptSessionStatus(value: unknown): value is TranscriptSessionStatus {
  return value === "draft" || value === "completed" || value === "recovered";
}
