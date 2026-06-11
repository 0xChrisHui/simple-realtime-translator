import type { RealtimeResult as SonioxRealtimeResult, RealtimeToken as SonioxRealtimeToken } from "@soniox/client";
import { appendCaptionDelta, createEmptyCaptionMap, getFocusTargetLanguage } from "./caption-text";
import { DISPLAY_CAPTION_MAX_CHARS, SONIOX_DEBUG_STORAGE_KEY } from "./constants";
import type { CaptionMap, SonioxCaptionBuffer, SonioxTokenKind, TargetLanguage } from "./types";

export function createEmptySonioxCaptionBuffer(): SonioxCaptionBuffer {
  return {
    finalDisplay: createEmptyCaptionMap(),
    partialDisplay: createEmptyCaptionMap(),
    finalOriginal: createEmptyCaptionMap(),
    partialOriginal: createEmptyCaptionMap(),
    finalTranslation: createEmptyCaptionMap(),
    partialTranslation: createEmptyCaptionMap(),
  };
}

export function normalizeSonioxLanguage(language: string | undefined): TargetLanguage | null {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "zh" || normalized.startsWith("zh-") || normalized === "cmn" || normalized === "yue") return "zh";
  return null;
}

export function appendSonioxCaptionText(previous: string, text: string) {
  return appendCaptionDelta(previous, text, DISPLAY_CAPTION_MAX_CHARS);
}

export function combineSonioxCaption(finalText: string, partialText: string) {
  return appendCaptionDelta(finalText, partialText, DISPLAY_CAPTION_MAX_CHARS);
}

export function combineSonioxCaptionParts(...parts: string[]) {
  return parts.reduce((combined, part) => combineSonioxCaption(combined, part), "");
}

export function getSonioxCaptionMaps(buffer: SonioxCaptionBuffer) {
  const captions: CaptionMap = {
    en: combineSonioxCaptionParts(buffer.finalDisplay.en, buffer.partialOriginal.en, buffer.partialTranslation.en),
    zh: combineSonioxCaptionParts(buffer.finalDisplay.zh, buffer.partialOriginal.zh, buffer.partialTranslation.zh),
  };
  const translationCaptions: CaptionMap = {
    en: combineSonioxCaption(buffer.finalTranslation.en, buffer.partialTranslation.en),
    zh: combineSonioxCaption(buffer.finalTranslation.zh, buffer.partialTranslation.zh),
  };

  return { captions, translationCaptions };
}

export function getSonioxTokenKind(token: SonioxRealtimeToken): SonioxTokenKind {
  return token.translation_status === "translation" ? "translation" : "original";
}

export function getSonioxOutputLanguage(token: SonioxRealtimeToken, kind: SonioxTokenKind): TargetLanguage | null {
  const tokenLanguage = normalizeSonioxLanguage(token.language);
  if (kind !== "translation") return tokenLanguage;

  const sourceLanguage = normalizeSonioxLanguage(token.source_language);
  if (!sourceLanguage) return tokenLanguage;
  if (tokenLanguage && tokenLanguage !== sourceLanguage) return tokenLanguage;

  return getFocusTargetLanguage(sourceLanguage);
}

export function isSonioxDebugEnabled() {
  if (typeof window === "undefined") return false;

  try {
    const value = window.localStorage.getItem(SONIOX_DEBUG_STORAGE_KEY);
    return value === "1" || value === "true";
  } catch {
    return false;
  }
}

export function logSonioxTokenDebug(
  enabled: boolean,
  result: SonioxRealtimeResult,
  token: SonioxRealtimeToken,
  tokenIndex: number,
  translationStatus: SonioxTokenKind,
  language: TargetLanguage,
  sourceLanguage: TargetLanguage | null,
  skipped: boolean
) {
  if (!enabled) return;

  console.debug("[soniox-token]", {
    finalAudioProcessedMs: result.final_audio_proc_ms,
    index: tokenIndex,
    isFinal: token.is_final === true,
    language,
    rawLanguage: token.language,
    rawSourceLanguage: token.source_language,
    skipped,
    sourceLanguage,
    text: token.text,
    translationStatus,
  });
}

export function getSonioxFinalTokenKey(
  token: SonioxRealtimeToken,
  status: SonioxTokenKind,
  language: TargetLanguage,
  result: SonioxRealtimeResult,
  tokenIndex: number
) {
  return [
    status,
    language,
    token.source_language ?? "",
    token.start_ms ?? `final:${result.final_audio_proc_ms}`,
    token.end_ms ?? `index:${tokenIndex}`,
    token.text,
  ].join(":");
}
