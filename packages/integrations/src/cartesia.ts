import type { FetchLike } from "./channel";

export type SpeechFormat = "mp3" | "wav";
export type SpeechRequest = {
  transcript: string;
  locale: string;
  normalization?: string;
  emotion?: VoiceEmotion;
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

export const VOICE_OPENERS = ["", "Oh,", "Hmm,", "Ah,", "Aww,", "Wow,", "Haha,"] as const;

export type VoiceDirection = {
  laugh: boolean;
  emotion: VoiceEmotion;
  speed: number;
  opener: (typeof VOICE_OPENERS)[number];
};

export const neutralDirection: VoiceDirection = { laugh: false, emotion: "content", speed: 1, opener: "" };

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

const JOKE = /\b((?:ha){2,}h?|(?:he){2,}h?|(?:hi){2,}|lo+l+|lmao|rofl|jk|just kidding|kidding|joking|mazaak|mazak|summa sonnen|chumma)\b|😂|🤣|😆|😜|😝|😛|😹/i;

/** Text cues that the customer was joking, for when no model can judge it. */
export function soundsLikeJoke(text: string): boolean {
  return JOKE.test(text);
}

function spokenPhone(digits: string): string {
  const national = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return national.length === 10 ? `<spell>${national.slice(0, 5)} ${national.slice(5)}</spell>` : `<spell>${national}</spell>`;
}

/**
 * Turns a chat reply into what Sonic should say: no emoji, links or markdown,
 * phone numbers read digit by digit, plus the laugh or opener the director chose.
 */
export function speechScript(text: string, direction: VoiceDirection = neutralDirection): string {
  let script = text
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_#`~>]+/g, "")
    .replace(/\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic}|\uFE0F)*/gu, "")
    .replace(/\[(?!laughter\])[^\]]*\]/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/(?<![\d<])\+?(?:91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, (match) => spokenPhone(match.replace(/\D/g, "")))
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!script) return script;
  if (!/[.!?।]$/.test(script)) script = `${script}.`;
  if (direction.laugh) return `[laughter] ${script}`;
  if (!direction.opener || INTERJECTION.test(script)) return script;
  const rest = /^[A-Z][a-z]/.test(script) && !/^I\b/.test(script) ? `${script[0]!.toLowerCase()}${script.slice(1)}` : script;
  return `${direction.opener} ${rest}`;
}

const INTERJECTION = /^(ha+|haha\w*|he+y|hi+|hello|oh+|ah+|aww+|wow|hmm+|ok(ay)?|super|great|nice|sure|sorry|thanks?|thank you|yes|no|wah|arey?|aiyo|ayyo|seri|sari|achha?|vanakkam|namaste)\b/i;

export function cartesiaSpeaker(options: { apiKey: string; voiceId: string; model?: string; fetchImpl?: FetchLike }): Speaker {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async ({ transcript, locale, normalization, emotion, speed, format }) => {
    const outputFormat = format === "mp3"
      ? { container: "mp3", sample_rate: 44100, bit_rate: 96000 }
      : { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 };
    const generationConfig: Record<string, unknown> = {};
    if (speed && speed !== 1) generationConfig.speed = Math.min(1.5, Math.max(0.6, speed));
    if (emotion && locale.startsWith("en")) generationConfig.emotion = emotion;
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
