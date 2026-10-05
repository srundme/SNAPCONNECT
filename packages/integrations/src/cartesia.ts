import type { FetchLike } from "./channel";

export type SpeechFormat = "mp3" | "wav";
export type Speaker = (input: { text: string; language: string; format: SpeechFormat }) => Promise<{ audio: Uint8Array; mimeType: string }>;

const SCRIPT_LANGUAGES: Array<[RegExp, string]> = [
  [/[\u0B80-\u0BFF]/, "ta"],
  [/[\u0C00-\u0C7F]/, "te"],
  [/[\u0C80-\u0CFF]/, "kn"],
  [/[\u0D00-\u0D7F]/, "ml"],
  [/[\u0980-\u09FF]/, "bn"],
  [/[\u0A80-\u0AFF]/, "gu"],
  [/[\u0A00-\u0A7F]/, "pa"],
  [/[\u0900-\u097F]/, "hi"],
];

/** Language code for the spoken reply, or null when the text is in a script the voice cannot read. */
export function speechLanguage(text: string): string | null {
  for (const [pattern, code] of SCRIPT_LANGUAGES) if (pattern.test(text)) return code;
  return /[^\x00-\x7F‘’“”…–—₹\p{Extended_Pictographic}\s]/u.test(text) ? null : "en";
}

export function cartesiaSpeaker(options: { apiKey: string; voiceId: string; model?: string; fetchImpl?: FetchLike }): Speaker {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async ({ text, language, format }) => {
    const outputFormat = format === "mp3"
      ? { container: "mp3", sample_rate: 24000, bit_rate: 64000 }
      : { container: "wav", encoding: "pcm_s16le", sample_rate: 24000 };
    const response = await fetchImpl("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Cartesia-Version": "2026-08-14",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model_id: options.model ?? "sonic-3.6",
        transcript: text,
        voice: { id: options.voiceId },
        language,
        output_format: outputFormat,
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
