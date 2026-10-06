import type { FetchLike } from "./channel";

export type SpeechFormat = "mp3" | "wav";
export type SpeechRequest = {
  transcript: string;
  locale: string;
  normalization?: string;
  speed?: number;
  format: SpeechFormat;
};
export type Speaker = (input: SpeechRequest) => Promise<{ audio: Uint8Array; mimeType: string }>;

export const VOICE_EMOTIONS = [
  "neutral",
  "happy",
  "excited",
  "enthusiastic",
  "content",
  "calm",
  "grateful",
  "sympathetic",
  "apologetic",
  "curious",
  "surprised",
  "confident",
  "affectionate",
] as const;
export type VoiceEmotion = (typeof VOICE_EMOTIONS)[number];

export const VOICE_OPENERS = ["", "Oh,", "Hmm,", "Ah,", "Aww,", "Wow,"] as const;

export type VoiceDirection = {
  /** One emotion per sentence of the reply, in order. */
  emotions: VoiceEmotion[];
  speed: number;
  opener: (typeof VOICE_OPENERS)[number];
};

export const neutralDirection: VoiceDirection = { emotions: [], speed: 1, opener: "" };

const SCRIPT_LANGUAGES: Array<[RegExp, string]> = [
  [/[\u0B80-\u0BFF]/, "ta"],
  [/[\u0C00-\u0C7F]/, "te"],
  [/[\u0C80-\u0CFF]/, "kn"],
  [/[\u0D00-\u0D7F]/, "ml"],
  [/[\u0980-\u09FF]/, "bn"],
  [/[\u0A80-\u0AFF]/, "gu"],
  [/[\u0A00-\u0A7F]/, "pa"],
  [/[\u0B00-\u0B7F]/, "or"],
  [/[\u0900-\u097F]/, "hi"],
];

const ROMANIZED: Array<[RegExp, string]> = [
  [/tamil|tanglish/i, "ta"],
  [/hindi|hinglish/i, "hi"],
  [/telugu/i, "te"],
  [/kannada/i, "kn"],
  [/malayalam/i, "ml"],
  [/marathi/i, "mr"],
  [/bengali|bangla/i, "bn"],
  [/gujarati/i, "gu"],
  [/punjabi/i, "pa"],
];

/**
 * Locale and number reading for the spoken reply. Indian languages typed in
 * English letters keep their own accent but read digits the Indian-English way.
 * Null means the reply is in a script the voice cannot read.
 */
export function speechLocale(text: string, chatLanguage?: string | null): { locale: string; normalization?: string } | null {
  for (const [pattern, code] of SCRIPT_LANGUAGES) if (pattern.test(text)) return { locale: `${code}-IN` };
  if (/[^\x00-\x7F‘’“”…–—₹\p{Extended_Pictographic}\s]/u.test(text)) return null;
  for (const [pattern, code] of ROMANIZED) {
    if (chatLanguage && pattern.test(chatLanguage)) return { locale: `${code}-IN`, normalization: "en-IN" };
  }
  return { locale: "en-IN" };
}

function spokenPhone(digits: string): string {
  const national = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return national.length === 10 ? `<spell>${national.slice(0, 5)} ${national.slice(5)}</spell>` : `<spell>${national}</spell>`;
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };

function underHundred(value: number): string {
  if (value < 20) return ONES[value]!;
  return `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${ONES[value % 10]}` : ""}`;
}

/** A whole number in words, the Indian way: lakh and crore, not million. */
export function numberWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value);
  if (value < 100) return underHundred(value);
  const parts: string[] = [];
  const steps: Array<[number, string]> = [[10_000_000, "crore"], [100_000, "lakh"], [1_000, "thousand"], [100, "hundred"]];
  let rest = Math.floor(value);
  for (const [size, name] of steps) {
    if (rest >= size) {
      parts.push(`${numberWords(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest) parts.push(underHundred(rest));
  return parts.join(" ");
}

function decimalWords(raw: string): string {
  const [whole, fraction] = raw.replace(/,/g, "").split(".");
  const words = numberWords(Number(whole));
  return fraction ? `${words} point ${[...fraction].map((digit) => ONES[Number(digit)]).join(" ")}` : words;
}

function ordinalWords(value: number): string {
  const words = numberWords(value).split(" ");
  const last = words.pop()!;
  const ordinal = ORDINALS[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ordinal].join(" ");
}

const ACRONYMS = new Set([
  "BHK", "RK", "HSR", "BTM", "JP", "MG", "ITPL", "KR", "HBR", "ECC", "PDF", "AI", "ID", "TV", "AC", "EV", "OTP", "EMI", "GST", "MDF", "HDF",
  "PVC", "UPVC", "LED", "UV", "CEO", "RERA", "USA", "UAE", "UK", "IST", "AM", "PM", "3D", "2D", "CAD", "SMS", "UPI", "NRI", "WFH",
]);

/** Shouted words would be spelled letter by letter; real acronyms stay spelled. */
function calmCapitals(text: string): string {
  return text.replace(/\b[A-Z][A-Z']{1,}\b/g, (word) => {
    if (ACRONYMS.has(word)) return word;
    if (word === "OK") return "okay";
    return /[AEIOUY]/.test(word) ? word.toLowerCase() : word;
  });
}

const LAKH_UNIT = "(?:l|lakhs?|lacs?|lhks?|lkhs?|lakh)";
const CRORE_UNIT = "(?:cr|crores?)";

/** Numbers, money and units written out, so the voice says "thirty lakhs" and not "thirty L". */
export function spokenNumbers(text: string): string {
  const amount = (raw: string, unit: "lakh" | "crore", plus = false) => {
    const value = Number(raw.replace(/,/g, ""));
    return `${decimalWords(raw)} ${unit}${value === 1 ? "" : "s"}${plus ? " plus" : ""}`;
  };
  return calmCapitals(text)
    .replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:${LAKH_UNIT})?\\s*(?:-|to|–)\\s*(\\d+(?:\\.\\d+)?)\\s*${LAKH_UNIT}\\b(\\+)?`, "gi"),
      (_, low: string, high: string, plus?: string) => `${decimalWords(low)} to ${amount(high, "lakh", Boolean(plus))}`)
    .replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:-|to|–)\\s*(\\d+(?:\\.\\d+)?)\\s*${CRORE_UNIT}\\b(\\+)?`, "gi"),
      (_, low: string, high: string, plus?: string) => `${decimalWords(low)} to ${amount(high, "crore", Boolean(plus))}`)
    .replace(new RegExp(`(?:₹\\s?)?\\b(\\d+(?:\\.\\d+)?)\\s*${LAKH_UNIT}\\b(\\+)?`, "gi"), (_, raw: string, plus?: string) => amount(raw, "lakh", Boolean(plus)))
    .replace(new RegExp(`(?:₹\\s?)?\\b(\\d+(?:\\.\\d+)?)\\s*${CRORE_UNIT}\\b(\\+)?`, "gi"), (_, raw: string, plus?: string) => amount(raw, "crore", Boolean(plus)))
    .replace(/₹\s?(\d[\d,]*(?:\.\d+)?)/g, (_, raw: string) => `${decimalWords(raw)} rupees`)
    .replace(/\b(\d+(?:\.\d+)?)\s*k\b/gi, (_, raw: string) => `${decimalWords(raw)} thousand`)
    .replace(/\b(\d+)\s*-?\s*(BHK|RK)\b/gi, (_, raw: string, unit: string) => `${numberWords(Number(raw))} ${unit.toUpperCase()}`)
    .replace(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/gi, (_, raw: string) => `${decimalWords(raw)} square feet`)
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)\s*(ft|feet)?\b/gi, (_, a: string, b: string, unit?: string) => `${decimalWords(a)} by ${decimalWords(b)}${unit ? " feet" : ""}`)
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, hours: string, minutes: string) => `${numberWords(Number(hours))}${minutes === "00" ? "" : ` ${Number(minutes) < 10 ? `oh ${ONES[Number(minutes)]}` : numberWords(Number(minutes))}`}`)
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, (_, raw: string) => ordinalWords(Number(raw)))
    .replace(/\b(19|20)(\d{2})\b(?!\s*(?:rupees|square|sq))/g, (_, century: string, rest: string) => `${numberWords(Number(century))} ${rest === "00" ? "hundred" : Number(rest) < 10 ? `oh ${ONES[Number(rest)]}` : numberWords(Number(rest))}`)
    .replace(/(\d+(?:\.\d+)?)\s*%/g, (_, raw: string) => `${decimalWords(raw)} percent`)
    .replace(/\b\d[\d,]*(?:\.\d+)?\b/g, (raw) => decimalWords(raw))
    .replace(/(\w)\+(?=\s|$|[.,!?])/g, "$1 plus")
    .replace(/\b(ft|sq\.? ?ft)\b\.?/gi, (unit) => (/sq/i.test(unit) ? "square feet" : "feet"));
}

const LAUGH = /\b(?:(?:ha|ah)(?:\s*(?:ha|ah))+h?|he(?:\s*he)+|hihi+|lol+|lmao+|rofl)\b[!.]*/gi;

function cleanSpeech(text: string): string {
  const script = text
    .replace(LAUGH, "\u0002")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/<[^>]*>/g, "")
    .replace(/[*_#`~<>]+/g, "")
    .replace(/\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic}|\uFE0F)*/gu, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/(?<![\d<])\+?(?:91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, (match) => spokenPhone(match.replace(/\D/g, "")))
    .split(/(<spell>[^<]*<\/spell>)/)
    .map((part) => (part.startsWith("<spell>") ? part : spokenNumbers(part)))
    .join("")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\u0002(?:[\s,]*\u0002)*/g, "[laughter]")
    .replace(/\[laughter\]\s*,\s*/g, "[laughter] ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return !script || /[.!?।\]]$/.test(script) ? script : `${script}.`;
}

/** The sentences Sonic will speak; the director gives each one an emotion. */
export function speechSentences(text: string): string[] {
  return cleanSpeech(text).split(/(?<=[.!?।])\s+/).filter(Boolean);
}

/**
 * Turns a chat reply into what Sonic should say: no emoji, links or markdown,
 * phone numbers read digit by digit, the opener the director chose, and an
 * inline emotion tag wherever the emotion changes. Cartesia reads emotion tags
 * only in English, so other languages get none.
 */
export function speechScript(text: string, direction: VoiceDirection = neutralDirection, options: { emotionTags?: boolean } = {}): string {
  const sentences = speechSentences(text);
  if (sentences.length === 0) return "";
  if (direction.opener && !INTERJECTION.test(sentences[0]!)) {
    const first = sentences[0]!;
    const rest = /^[A-Z][a-z]/.test(first) && !/^I\b/.test(first) ? `${first[0]!.toLowerCase()}${first.slice(1)}` : first;
    sentences[0] = `${direction.opener} ${rest}`;
  }
  if (!options.emotionTags || direction.emotions.length === 0) return sentences.join(" ");
  let current: VoiceEmotion | null = null;
  return sentences
    .map((sentence, index) => {
      const emotion = direction.emotions[Math.min(index, direction.emotions.length - 1)]!;
      if (emotion === current) return sentence;
      current = emotion;
      return `<emotion value="${emotion}"/> ${sentence}`;
    })
    .join(" ");
}

const INTERJECTION = /^(?:\[laughter\]|(ha+|he+y|hi+|hello|oh+|ah+|aww+|wow|hmm+|ok(ay)?|super|great|nice|sure|sorry|thanks?|thank you|yes|no|wah|arey?|aiyo|ayyo|seri|sari|achha?|vanakkam|namaste)\b)/i;

export function cartesiaSpeaker(options: { apiKey: string; voiceId: string; model?: string; fetchImpl?: FetchLike }): Speaker {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async ({ transcript, locale, normalization, speed, format }) => {
    const outputFormat = format === "mp3"
      ? { container: "mp3", sample_rate: 44100, bit_rate: 96000 }
      : { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 };
    const generationConfig: Record<string, unknown> = {};
    if (speed && speed !== 1) generationConfig.speed = Math.min(1.5, Math.max(0.6, speed));
    const response = await fetchImpl("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Cartesia-Version": "2026-08-14",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model_id: options.model ?? "sonic-3.6",
        transcript,
        voice: { id: options.voiceId },
        locale,
        ...(normalization ? { normalization } : {}),
        output_format: outputFormat,
        ...(Object.keys(generationConfig).length ? { generation_config: generationConfig } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`Cartesia returned HTTP ${response.status} ${detail}`.trim());
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength < 100) throw new Error("Cartesia returned no audio.");
    return { audio, mimeType: format === "mp3" ? "audio/mpeg" : "audio/wav" };
  };
}
