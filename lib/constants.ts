import type { ApiProvider, CaptionFontSizeMap, TargetLanguage } from "./types";

export const API_PROVIDERS: Array<{ code: ApiProvider; label: string }> = [
  { code: "openai", label: "OpenAI" },
  { code: "soniox", label: "Soniox" },
];
export const TARGETS: Array<{ code: TargetLanguage; label: string; placeholder: string }> = [
  { code: "en", label: "English", placeholder: "Waiting for English captions" },
  { code: "zh", label: "中文", placeholder: "等待中文字幕" },
];
export const INPUT_TRANSCRIPT_TARGET: TargetLanguage = "zh";
export const DEFAULT_CAPTION_FONT_SIZES: CaptionFontSizeMap = { en: 60, zh: 70 };
export const MIN_CAPTION_FONT_SIZE = 24;
export const SPLIT_CAPTION_TARGET_LINES: Record<TargetLanguage, number> = { en: 4, zh: 4 };
export const SPLIT_CAPTION_LINE_HEIGHT_RATIO: Record<TargetLanguage, number> = { en: 1.08, zh: 1.2 };
export const SOURCE_LANGUAGE_SWITCH_DELAY_MS = 2500;
export const SOURCE_LANGUAGE_SWITCH_MAX_GAP_MS = 1400;
export const SOURCE_LANGUAGE_SWITCH_MIN_CHUNKS = 2;
export const SOURCE_LANGUAGE_SWITCH_MIN_EVIDENCE: Record<TargetLanguage, number> = { en: 12, zh: 3 };
export const DISPLAY_CAPTION_MAX_CHARS = 4000;
export const FOCUS_TIMELINE_MAX_SEGMENTS = 32;
export const FOCUS_SEGMENT_MAX_CHARS = 900;
export const MISSING_OPENAI_API_KEY_CAPTION = "请输入你的 API key\nPlease enter your API key";
export const MISSING_OPENAI_API_KEY_MESSAGE = "请输入你的 OpenAI API key / Please enter your OpenAI API key.";
export const OPENAI_API_KEY_STORAGE_KEY = "translatorOpenAiApiKey";
export const SONIOX_API_KEY_STORAGE_KEY = "translatorSonioxApiKey";
export const SONIOX_DEBUG_STORAGE_KEY = "translatorSonioxDebug";
export const TRANSCRIPT_AUTOSAVE_DELAY_MS = 800;
export const TRANSCRIPT_PARTIAL_CHECKPOINT_MS = 5000;
export const FLOATING_WINDOW_WIDTH = 720;
export const FLOATING_WINDOW_HEIGHT = 360;
export const FLOATING_CAPTION_MAX_CHARS = 420;

function formatWatermarkImage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "none";

  return `url("${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

export const WATERMARK_IMAGE = formatWatermarkImage(process.env.NEXT_PUBLIC_WATERMARK_IMAGE ?? "");
