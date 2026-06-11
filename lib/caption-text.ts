import { FLOATING_CAPTION_MAX_CHARS, MIN_CAPTION_FONT_SIZE } from "./constants";
import type { CaptionMap, TargetLanguage } from "./types";

export function getFloatingCaptionText(value: string, fallback: string) {
  const caption = value.trim() || fallback;
  if (caption.length <= FLOATING_CAPTION_MAX_CHARS) return caption;

  return caption.slice(-FLOATING_CAPTION_MAX_CHARS).trimStart();
}

export function appendCaptionDelta(previous: string, delta: string, maxChars: number) {
  const next = `${previous}${delta}`.replace(/[ \t\r\n]+/g, " ");
  if (next.length <= maxChars) return next;

  const clipped = next.slice(-maxChars);
  const sentenceStart = clipped.search(/[。！？.!?]\s?/);
  if (sentenceStart > 0 && sentenceStart < Math.floor(maxChars / 3)) {
    return clipped.slice(sentenceStart + 1).trimStart();
  }

  return clipped.trimStart();
}

export function appendSavedCaptionDelta(previous: string, delta: string) {
  return `${previous}${delta}`.replace(/[ \t\r\n]+/g, " ").trimStart();
}

export function createEmptyCaptionMap(): CaptionMap {
  return { en: "", zh: "" };
}

export function detectInputLanguage(delta: string, fallback: TargetLanguage): TargetLanguage {
  if (/[\u3400-\u9fff]/.test(delta)) return "zh";
  if (/[A-Za-z]/.test(delta)) return "en";
  return fallback;
}

export function getInputLanguageEvidence(delta: string, language: TargetLanguage) {
  if (language === "zh") {
    return delta.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  }

  return delta.match(/[A-Za-z]/g)?.length ?? 0;
}

export function isOutputTranscriptDoneEvent(type: string | undefined) {
  return (
    type === "session.output_transcript.done" ||
    type === "session.output_transcript.completed" ||
    type === "session.output_transcript.final"
  );
}

export function getFocusTargetLanguage(sourceLanguage: TargetLanguage): TargetLanguage {
  return sourceLanguage === "zh" ? "en" : "zh";
}

export function createTranscriptId(prefix: string) {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${random}`;
}

export function normalizeTranscriptText(value: string) {
  return value.replace(/[ \t\r\n]+/g, " ").trim();
}

export function formatTimestampForFile(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}`;
}

export function formatTimestampForText(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

export function formatDuration(startedAt: number, stoppedAt: number) {
  const seconds = Math.max(0, Math.round((stoppedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function clampCaptionFontSize(value: number) {
  return Math.max(MIN_CAPTION_FONT_SIZE, value);
}

export function roundCaptionFontSize(value: number) {
  return Math.round(value * 10) / 10;
}

export function formatCaptionFontSizeInput(value: number) {
  const rounded = roundCaptionFontSize(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function getErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;

  const error = (data as Record<string, unknown>).error;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }

  return fallback;
}

export function getClientSecret(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  if (typeof record.value === "string") return record.value;

  const clientSecret = record.client_secret;
  if (clientSecret && typeof clientSecret === "object") {
    const value = (clientSecret as Record<string, unknown>).value;
    if (typeof value === "string") return value;
  }

  const secret = record.secret;
  if (secret && typeof secret === "object") {
    const value = (secret as Record<string, unknown>).value;
    if (typeof value === "string") return value;
  }

  return null;
}
