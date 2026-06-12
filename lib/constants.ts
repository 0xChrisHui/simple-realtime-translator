import { DEFAULT_LANGUAGE_PAIR, getPairTargets, type PairTarget } from "./languages";
import type { ApiProvider, TargetLanguage } from "./types";

export const API_PROVIDERS: Array<{ code: ApiProvider; label: string }> = [
  { code: "openai", label: "OpenAI" },
  { code: "soniox", label: "Soniox" },
];
// Derived for the default pair; P2 replaces direct uses with the live pair.
export const TARGETS: PairTarget[] = getPairTargets(DEFAULT_LANGUAGE_PAIR);
export const INPUT_TRANSCRIPT_TARGET: TargetLanguage = DEFAULT_LANGUAGE_PAIR.b;
export const MIN_CAPTION_FONT_SIZE = 24;
export const SPLIT_CAPTION_TARGET_LINES = 4;
export const SOURCE_LANGUAGE_SWITCH_DELAY_MS = 2500;
export const SOURCE_LANGUAGE_SWITCH_MAX_GAP_MS = 1400;
export const SOURCE_LANGUAGE_SWITCH_MIN_CHUNKS = 2;
export const DISPLAY_CAPTION_MAX_CHARS = 4000;
export const FOCUS_TIMELINE_MAX_SEGMENTS = 32;
export const FOCUS_SEGMENT_MAX_CHARS = 900;
export const FOCUS_SEGMENT_STORAGE_LIMIT = 512;
export const SONIOX_FINAL_TOKEN_KEY_LIMIT = 20000;
export const MISSING_OPENAI_API_KEY_CAPTION = "请输入你的 API key\nPlease enter your API key";
export const MISSING_OPENAI_API_KEY_MESSAGE = "请输入你的 OpenAI API key / Please enter your OpenAI API key.";
export const OPENAI_API_KEY_STORAGE_KEY = "translatorOpenAiApiKey";
export const SONIOX_API_KEY_STORAGE_KEY = "translatorSonioxApiKey";
export const LANGUAGE_PAIR_STORAGE_KEY = "translatorLanguagePair";
export const SONIOX_DEBUG_STORAGE_KEY = "translatorSonioxDebug";
export const TRANSCRIPT_AUTOSAVE_DELAY_MS = 800;
export const TRANSCRIPT_PARTIAL_CHECKPOINT_MS = 5000;
export const SONIOX_SIGNUP_URL = "https://console.soniox.com/";
export const DEPLOY_YOUR_OWN_URL = "https://github.com/0xChrisHui/simple-realtime-translator#deploy-your-own";
export const TRIAL_LOW_REMAINING_SECONDS = 30;
export const FLOATING_WINDOW_WIDTH = 720;
export const FLOATING_WINDOW_HEIGHT = 360;
export const FLOATING_CAPTION_MAX_CHARS = 420;

function formatWatermarkImage(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "none";

  return `url("${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

export const WATERMARK_IMAGE = formatWatermarkImage(process.env.NEXT_PUBLIC_WATERMARK_IMAGE ?? "");
