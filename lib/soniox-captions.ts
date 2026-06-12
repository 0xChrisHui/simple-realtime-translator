import type { RealtimeResult as SonioxRealtimeResult, RealtimeToken as SonioxRealtimeToken } from "@soniox/client";
import { appendCaptionDelta, createEmptyCaptionMap, getFocusTargetLanguage } from "./caption-text";
import { DISPLAY_CAPTION_MAX_CHARS, SONIOX_DEBUG_STORAGE_KEY } from "./constants";
import { DEFAULT_LANGUAGE_PAIR, getPairLanguages, type LanguagePair } from "./languages";
import type { CaptionMap, SonioxCaptionBuffer, SonioxTokenKind, TargetLanguage } from "./types";

export function createEmptySonioxCaptionBuffer(pair: LanguagePair = DEFAULT_LANGUAGE_PAIR): SonioxCaptionBuffer {
  return {
    finalDisplay: createEmptyCaptionMap(pair),
    partialDisplay: createEmptyCaptionMap(pair),
    finalOriginal: createEmptyCaptionMap(pair),
    partialOriginal: createEmptyCaptionMap(pair),
    finalTranslation: createEmptyCaptionMap(pair),
    partialTranslation: createEmptyCaptionMap(pair),
  };
}

// Aliases Soniox may emit instead of the registry code for a pair language.
const SONIOX_LANGUAGE_ALIASES: Partial<Record<TargetLanguage, readonly string[]>> = {
  zh: ["cmn", "yue"],
  no: ["nb", "nn"],
};

// Maps a raw Soniox token language onto one side of the active pair, or null
// for tokens outside the pair (dropped, same as the en/zh-only behavior).
export function normalizeSonioxLanguage(
  language: string | undefined,
  pair: LanguagePair = DEFAULT_LANGUAGE_PAIR
): TargetLanguage | null {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return null;

  for (const code of getPairLanguages(pair)) {
    if (normalized === code || normalized.startsWith(`${code}-`)) return code;
    if (SONIOX_LANGUAGE_ALIASES[code]?.some((alias) => normalized === alias || normalized.startsWith(`${alias}-`))) {
      return code;
    }
  }

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

export function getSonioxCaptionMaps(buffer: SonioxCaptionBuffer, pair: LanguagePair = DEFAULT_LANGUAGE_PAIR) {
  const captions: CaptionMap = {};
  const translationCaptions: CaptionMap = {};

  getPairLanguages(pair).forEach((code) => {
    captions[code] = combineSonioxCaptionParts(
      buffer.finalDisplay[code] ?? "",
      buffer.partialOriginal[code] ?? "",
      buffer.partialTranslation[code] ?? ""
    );
    translationCaptions[code] = combineSonioxCaption(buffer.finalTranslation[code] ?? "", buffer.partialTranslation[code] ?? "");
  });

  return { captions, translationCaptions };
}

export function getSonioxTokenKind(token: SonioxRealtimeToken): SonioxTokenKind {
  return token.translation_status === "translation" ? "translation" : "original";
}

export function getSonioxOutputLanguage(
  token: SonioxRealtimeToken,
  kind: SonioxTokenKind,
  pair: LanguagePair = DEFAULT_LANGUAGE_PAIR
): TargetLanguage | null {
  const tokenLanguage = normalizeSonioxLanguage(token.language, pair);
  if (kind !== "translation") return tokenLanguage;

  const sourceLanguage = normalizeSonioxLanguage(token.source_language, pair);
  if (!sourceLanguage) return tokenLanguage;
  if (tokenLanguage && tokenLanguage !== sourceLanguage) return tokenLanguage;

  return getFocusTargetLanguage(sourceLanguage, pair);
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
