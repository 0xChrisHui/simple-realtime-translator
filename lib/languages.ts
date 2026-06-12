// Single source of truth for every language the app can caption or translate.
// All per-language behavior (detection evidence, font defaults, labels,
// provider availability) derives from this registry; nothing else in the
// codebase may hard-code a language.

export type LanguageScript =
  | "latin"
  | "cjk"
  | "kana"
  | "hangul"
  | "cyrillic"
  | "greek"
  | "arabic"
  | "hebrew"
  | "devanagari"
  | "bengali"
  | "gurmukhi"
  | "gujarati"
  | "tamil"
  | "telugu"
  | "kannada"
  | "malayalam"
  | "thai";

type ScriptPreset = {
  // Counts characters belonging to the script; quantifies how much real text
  // a delta carries when the language label is already known.
  pattern: RegExp;
  // Counts characters that are unique to the script within mixed text; used
  // to pick between two languages whose scripts differ. For kana this is the
  // kana ranges only — kanji is shared with Chinese and proves nothing.
  distinctivePattern: RegExp;
  // Evidence needed before the source-language tracker commits a switch.
  // Dense scripts carry more information per character.
  minSwitchEvidence: number;
  // CJK-style glyphs get a bigger default font and taller line box.
  denseGlyphs: boolean;
};

const LATIN_PATTERN = /[A-Za-zÀ-ɏḀ-ỿ]/g;
const CJK_PATTERN = /[㐀-鿿]/g;
const KANA_PATTERN = /[぀-ヿ]/g;

const SCRIPT_PRESETS: Record<LanguageScript, ScriptPreset> = {
  latin: { pattern: LATIN_PATTERN, distinctivePattern: LATIN_PATTERN, minSwitchEvidence: 12, denseGlyphs: false },
  cjk: { pattern: CJK_PATTERN, distinctivePattern: CJK_PATTERN, minSwitchEvidence: 3, denseGlyphs: true },
  kana: {
    pattern: /[぀-ヿ㐀-鿿]/g,
    distinctivePattern: KANA_PATTERN,
    minSwitchEvidence: 3,
    denseGlyphs: true,
  },
  hangul: {
    pattern: /[가-힣ᄀ-ᇿ]/g,
    distinctivePattern: /[가-힣ᄀ-ᇿ]/g,
    minSwitchEvidence: 3,
    denseGlyphs: true,
  },
  cyrillic: {
    pattern: /[Ѐ-ӿ]/g,
    distinctivePattern: /[Ѐ-ӿ]/g,
    minSwitchEvidence: 12,
    denseGlyphs: false,
  },
  greek: {
    pattern: /[Ͱ-Ͽ]/g,
    distinctivePattern: /[Ͱ-Ͽ]/g,
    minSwitchEvidence: 12,
    denseGlyphs: false,
  },
  arabic: {
    pattern: /[؀-ۿݐ-ݿ]/g,
    distinctivePattern: /[؀-ۿݐ-ݿ]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  hebrew: {
    pattern: /[֐-׿]/g,
    distinctivePattern: /[֐-׿]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  devanagari: {
    pattern: /[ऀ-ॿ]/g,
    distinctivePattern: /[ऀ-ॿ]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  bengali: {
    pattern: /[ঀ-৿]/g,
    distinctivePattern: /[ঀ-৿]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  gurmukhi: {
    pattern: /[਀-੿]/g,
    distinctivePattern: /[਀-੿]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  gujarati: {
    pattern: /[઀-૿]/g,
    distinctivePattern: /[઀-૿]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  tamil: {
    pattern: /[஀-௿]/g,
    distinctivePattern: /[஀-௿]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  telugu: {
    pattern: /[ఀ-౿]/g,
    distinctivePattern: /[ఀ-౿]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  kannada: {
    pattern: /[ಀ-೿]/g,
    distinctivePattern: /[ಀ-೿]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  malayalam: {
    pattern: /[ഀ-ൿ]/g,
    distinctivePattern: /[ഀ-ൿ]/g,
    minSwitchEvidence: 8,
    denseGlyphs: false,
  },
  thai: {
    pattern: /[฀-๿]/g,
    distinctivePattern: /[฀-๿]/g,
    minSwitchEvidence: 5,
    denseGlyphs: false,
  },
};

type LanguageDefinition = {
  nativeLabel: string;
  englishLabel: string;
  script: LanguageScript;
  // Listed as an OpenAI Realtime Translation output language (13 total).
  openai?: true;
  // High-frequency function words used to tell same-script (Latin) languages
  // apart in the OpenAI path, where the API exposes no language metadata.
  // Soniox labels every token itself and never needs these.
  stopwords?: readonly string[];
  // Caption placeholder shown before the first token arrives. Languages
  // without one get a generated English fallback.
  placeholder?: string;
};

// Insertion order is the dropdown order: the default pair first, then the
// OpenAI-capable set, then the Soniox-only languages A→Z by English name.
const LANGUAGE_DEFINITIONS = {
  en: {
    nativeLabel: "English",
    englishLabel: "English",
    script: "latin",
    openai: true,
    placeholder: "Waiting for English captions",
    stopwords: ["the", "and", "is", "are", "was", "were", "of", "to", "in", "that", "it", "with", "for", "on", "this", "have", "not", "you", "be", "at"],
  },
  zh: { nativeLabel: "中文", englishLabel: "Chinese", script: "cjk", openai: true, placeholder: "等待中文字幕" },
  ja: { nativeLabel: "日本語", englishLabel: "Japanese", script: "kana", openai: true },
  ko: { nativeLabel: "한국어", englishLabel: "Korean", script: "hangul", openai: true },
  es: {
    nativeLabel: "Español",
    englishLabel: "Spanish",
    script: "latin",
    openai: true,
    stopwords: ["el", "la", "los", "las", "que", "de", "es", "un", "una", "por", "con", "para", "pero", "como", "más", "su", "lo", "le", "ya", "está"],
  },
  fr: {
    nativeLabel: "Français",
    englishLabel: "French",
    script: "latin",
    openai: true,
    stopwords: ["le", "la", "les", "des", "une", "est", "et", "dans", "que", "pour", "pas", "vous", "avec", "sur", "ce", "qui", "ne", "au", "du", "je"],
  },
  de: {
    nativeLabel: "Deutsch",
    englishLabel: "German",
    script: "latin",
    openai: true,
    stopwords: ["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "ich", "sie", "mit", "für", "auf", "den", "dem", "zu", "von", "wir", "auch", "haben"],
  },
  it: {
    nativeLabel: "Italiano",
    englishLabel: "Italian",
    script: "latin",
    openai: true,
    stopwords: ["il", "lo", "la", "gli", "che", "di", "un", "una", "è", "non", "con", "per", "come", "più", "sono", "questo", "si", "anche", "del", "nel"],
  },
  pt: {
    nativeLabel: "Português",
    englishLabel: "Portuguese",
    script: "latin",
    openai: true,
    stopwords: ["o", "os", "as", "um", "uma", "que", "em", "é", "não", "com", "para", "por", "mais", "como", "seu", "há", "são", "está", "você", "isso"],
  },
  ru: { nativeLabel: "Русский", englishLabel: "Russian", script: "cyrillic", openai: true },
  hi: { nativeLabel: "हिन्दी", englishLabel: "Hindi", script: "devanagari", openai: true },
  id: {
    nativeLabel: "Bahasa Indonesia",
    englishLabel: "Indonesian",
    script: "latin",
    openai: true,
    stopwords: ["yang", "dan", "di", "ini", "itu", "dengan", "untuk", "tidak", "dari", "ke", "pada", "adalah", "saya", "kami", "akan", "juga", "bisa", "ada", "sudah", "atau"],
  },
  vi: {
    nativeLabel: "Tiếng Việt",
    englishLabel: "Vietnamese",
    script: "latin",
    openai: true,
    stopwords: ["của", "và", "là", "không", "có", "được", "trong", "một", "người", "này", "cho", "tôi", "bạn", "đã", "sẽ", "với", "các", "những", "để", "khi"],
  },
  af: { nativeLabel: "Afrikaans", englishLabel: "Afrikaans", script: "latin" },
  sq: { nativeLabel: "Shqip", englishLabel: "Albanian", script: "latin" },
  ar: { nativeLabel: "العربية", englishLabel: "Arabic", script: "arabic" },
  az: { nativeLabel: "Azərbaycanca", englishLabel: "Azerbaijani", script: "latin" },
  eu: { nativeLabel: "Euskara", englishLabel: "Basque", script: "latin" },
  be: { nativeLabel: "Беларуская", englishLabel: "Belarusian", script: "cyrillic" },
  bn: { nativeLabel: "বাংলা", englishLabel: "Bengali", script: "bengali" },
  bs: { nativeLabel: "Bosanski", englishLabel: "Bosnian", script: "latin" },
  bg: { nativeLabel: "Български", englishLabel: "Bulgarian", script: "cyrillic" },
  ca: { nativeLabel: "Català", englishLabel: "Catalan", script: "latin" },
  hr: { nativeLabel: "Hrvatski", englishLabel: "Croatian", script: "latin" },
  cs: { nativeLabel: "Čeština", englishLabel: "Czech", script: "latin" },
  da: { nativeLabel: "Dansk", englishLabel: "Danish", script: "latin" },
  nl: { nativeLabel: "Nederlands", englishLabel: "Dutch", script: "latin" },
  et: { nativeLabel: "Eesti", englishLabel: "Estonian", script: "latin" },
  fi: { nativeLabel: "Suomi", englishLabel: "Finnish", script: "latin" },
  gl: { nativeLabel: "Galego", englishLabel: "Galician", script: "latin" },
  el: { nativeLabel: "Ελληνικά", englishLabel: "Greek", script: "greek" },
  gu: { nativeLabel: "ગુજરાતી", englishLabel: "Gujarati", script: "gujarati" },
  he: { nativeLabel: "עברית", englishLabel: "Hebrew", script: "hebrew" },
  hu: { nativeLabel: "Magyar", englishLabel: "Hungarian", script: "latin" },
  kn: { nativeLabel: "ಕನ್ನಡ", englishLabel: "Kannada", script: "kannada" },
  kk: { nativeLabel: "Қазақша", englishLabel: "Kazakh", script: "cyrillic" },
  lv: { nativeLabel: "Latviešu", englishLabel: "Latvian", script: "latin" },
  lt: { nativeLabel: "Lietuvių", englishLabel: "Lithuanian", script: "latin" },
  mk: { nativeLabel: "Македонски", englishLabel: "Macedonian", script: "cyrillic" },
  ms: { nativeLabel: "Bahasa Melayu", englishLabel: "Malay", script: "latin" },
  ml: { nativeLabel: "മലയാളം", englishLabel: "Malayalam", script: "malayalam" },
  mr: { nativeLabel: "मराठी", englishLabel: "Marathi", script: "devanagari" },
  no: { nativeLabel: "Norsk", englishLabel: "Norwegian", script: "latin" },
  fa: { nativeLabel: "فارسی", englishLabel: "Persian", script: "arabic" },
  pl: { nativeLabel: "Polski", englishLabel: "Polish", script: "latin" },
  pa: { nativeLabel: "ਪੰਜਾਬੀ", englishLabel: "Punjabi", script: "gurmukhi" },
  ro: { nativeLabel: "Română", englishLabel: "Romanian", script: "latin" },
  sr: { nativeLabel: "Српски", englishLabel: "Serbian", script: "cyrillic" },
  sk: { nativeLabel: "Slovenčina", englishLabel: "Slovak", script: "latin" },
  sl: { nativeLabel: "Slovenščina", englishLabel: "Slovenian", script: "latin" },
  sw: { nativeLabel: "Kiswahili", englishLabel: "Swahili", script: "latin" },
  sv: { nativeLabel: "Svenska", englishLabel: "Swedish", script: "latin" },
  tl: { nativeLabel: "Tagalog", englishLabel: "Tagalog", script: "latin" },
  ta: { nativeLabel: "தமிழ்", englishLabel: "Tamil", script: "tamil" },
  te: { nativeLabel: "తెలుగు", englishLabel: "Telugu", script: "telugu" },
  th: { nativeLabel: "ไทย", englishLabel: "Thai", script: "thai" },
  tr: { nativeLabel: "Türkçe", englishLabel: "Turkish", script: "latin" },
  uk: { nativeLabel: "Українська", englishLabel: "Ukrainian", script: "cyrillic" },
  ur: { nativeLabel: "اردو", englishLabel: "Urdu", script: "arabic" },
  cy: { nativeLabel: "Cymraeg", englishLabel: "Welsh", script: "latin" },
} as const satisfies Record<string, LanguageDefinition>;

export type LanguageCode = keyof typeof LANGUAGE_DEFINITIONS;

export type LanguagePair = { a: LanguageCode; b: LanguageCode };

export const DEFAULT_LANGUAGE_PAIR: LanguagePair = { a: "en", b: "zh" };

export const LANGUAGE_CODES = Object.keys(LANGUAGE_DEFINITIONS) as LanguageCode[];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && value in LANGUAGE_DEFINITIONS;
}

export function getLanguage(code: LanguageCode): LanguageDefinition {
  return LANGUAGE_DEFINITIONS[code];
}

function getScriptPreset(code: LanguageCode) {
  return SCRIPT_PRESETS[LANGUAGE_DEFINITIONS[code].script];
}

export function getPairLanguages(pair: LanguagePair): [LanguageCode, LanguageCode] {
  return [pair.a, pair.b];
}

export function getOtherPairLanguage(pair: LanguagePair, code: LanguageCode): LanguageCode {
  return code === pair.a ? pair.b : pair.a;
}

export function getLanguageLabel(code: LanguageCode) {
  return LANGUAGE_DEFINITIONS[code].nativeLabel;
}

export function getLanguagePlaceholder(code: LanguageCode) {
  const definition = getLanguage(code);
  return definition.placeholder ?? `Waiting for ${definition.englishLabel} captions`;
}

export type PairTarget = { code: LanguageCode; label: string; placeholder: string };

export function getPairTargets(pair: LanguagePair): PairTarget[] {
  return getPairLanguages(pair).map((code) => ({
    code,
    label: getLanguageLabel(code),
    placeholder: getLanguagePlaceholder(code),
  }));
}

export function getDefaultCaptionFontSize(code: LanguageCode) {
  return getScriptPreset(code).denseGlyphs ? 70 : 60;
}

export function getDefaultCaptionFontSizes(pair: LanguagePair): Partial<Record<LanguageCode, number>> {
  const sizes: Partial<Record<LanguageCode, number>> = {};
  getPairLanguages(pair).forEach((code) => {
    sizes[code] = getDefaultCaptionFontSize(code);
  });
  return sizes;
}

export function getCaptionLineHeightRatio(code: LanguageCode) {
  return getScriptPreset(code).denseGlyphs ? 1.2 : 1.08;
}

export function getMinSwitchEvidence(code: LanguageCode) {
  return getScriptPreset(code).minSwitchEvidence;
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

// How much text of this language a delta carries. The language label itself
// is trusted (it comes from Soniox metadata or from detection).
export function countLanguageEvidence(delta: string, code: LanguageCode) {
  return countMatches(delta, getScriptPreset(code).pattern);
}

// Picks which side of the pair a delta belongs to, or null when the text is
// not informative enough to say. Different scripts are compared by their
// distinctive character counts, weighted so that dense scripts (where a few
// characters carry a sentence) compete fairly with alphabetic ones.
// Same-script pairs fall back to stopword hits, which only the OpenAI path
// needs — Soniox labels its tokens and never calls this.
export function detectPairLanguage(delta: string, pair: LanguagePair): LanguageCode | null {
  const a = getLanguage(pair.a);
  const b = getLanguage(pair.b);

  if (a.script !== b.script) {
    const scoreOf = (code: LanguageCode) => {
      const preset = getScriptPreset(code);
      return countMatches(delta, preset.distinctivePattern) * (12 / preset.minSwitchEvidence);
    };
    const aScore = scoreOf(pair.a);
    const bScore = scoreOf(pair.b);
    if (aScore === bScore) return null;
    return aScore > bScore ? pair.a : pair.b;
  }

  const words = delta.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  if (!words.length) return null;

  const hitsIn = (stopwords: readonly string[] | undefined) =>
    stopwords ? words.filter((word) => stopwords.includes(word)).length : 0;
  const aScore = hitsIn(a.stopwords);
  const bScore = hitsIn(b.stopwords);
  if (aScore === bScore) return null;
  return aScore > bScore ? pair.a : pair.b;
}
