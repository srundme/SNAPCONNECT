const SAMPLE_NUMBERS = new Set(["9876543210", "1234567890", "0123456789", "9123456789", "9898989898"]);

/** Says what is actually wrong with a number, so the reply is specific instead of a generic "looks incorrect". */
export function phoneProblem(digits: string): string {
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (SAMPLE_NUMBERS.has(local) || /^(\d)\1{9}$/.test(local)) return "that looks like a sample number, not a real one";
  if (local.length !== 10) return `that has ${local.length} digits, and a mobile number has 10`;
  if (!/^[6-9]/.test(local)) return "Indian mobile numbers start with 6, 7, 8 or 9";
  return "that does not look like a working mobile number";
}

function sentenceKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/\b(sir|mam|madam|bro|ji|please)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?।])\s+/).map((part) => part.trim()).filter(Boolean);
}

/**
 * Drops sentences Varun already sent earlier in this chat, word for word.
 * A person never pastes the same line twice; if every sentence is a repeat the reply is kept as is.
 */
export function dropRepeatedSentences(reply: string, earlier: string[]): string {
  const said = new Set(earlier.flatMap(sentencesOf).map(sentenceKey).filter((key) => key.length >= 12));
  const parts = sentencesOf(reply);
  const kept = parts.filter((part) => !said.has(sentenceKey(part)));
  return kept.length && kept.length < parts.length ? kept.join(" ") : reply;
}
