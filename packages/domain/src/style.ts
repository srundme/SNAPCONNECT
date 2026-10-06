const SAMPLE_NUMBERS = new Set(["9876543210", "1234567890", "0123456789", "9123456789", "9898989898"]);

/** Says what is actually wrong with a number, so the reply is specific instead of a generic "looks incorrect". */
export function phoneProblem(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (number.startsWith("+") && !digits.startsWith("91")) {
    return /(\d)\1{6,}/.test(digits) ? "that looks like a made-up number, not a real one" : "that does not look like a complete number for that country code, so the digits after the code may be off";
  }
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  if (SAMPLE_NUMBERS.has(local) || /^(\d)\1{9}$/.test(local)) return "that looks like a sample number, not a real one";
  if (local.length > 10) return `that has ${local.length} digits, and an Indian mobile number has 10. If it is a number from another country, send it with the + and country code`;
  if (local.length !== 10) return `that has ${local.length} digits, and a mobile number has 10`;
  if (!/^[6-9]/.test(local)) return "Indian mobile numbers start with 6, 7, 8 or 9";
  return "that does not look like a working mobile number";
}

const AMOUNT_UNITS: Array<[RegExp, number]> = [
  [/\b(?:crores?|cr)\b/i, 10_000_000],
  [/\b(?:lakhs?|lacs?|l)\b/i, 100_000],
  [/\bk\b|thousand/i, 1_000],
];

/** Reads "35 lakh", "1.2 cr", "₹40,00,000" or "50k" as rupees. */
export function rupeesIn(text: string): number | null {
  const match = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*([a-z]+)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = AMOUNT_UNITS.find(([pattern]) => pattern.test(match[2] ?? ""))
    ?? AMOUNT_UNITS.find(([pattern]) => pattern.test(text.slice((match.index ?? 0) + match[0].length)));
  return Number.isFinite(amount) ? amount * (unit ? unit[1] : 1) : null;
}

/** A budget written as a bare small number, like "3" or "15", which in Indian home interiors means lakhs. */
export function bareBudget(text: string): number | null {
  if (/[a-z₹]/i.test(text.replace(/\b(around|about|approx\w*|max\w*|only|budget|is|my|ok)\b/gi, ""))) return null;
  const value = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(value) && value >= 1 && value < 100 ? value : null;
}

const SIZE_UNITS: Array<{ pattern: RegExp; unit: string; factor: number; plot?: boolean }> = [
  { pattern: /\b(?:sq\.?\s*m(?:eters?|etres?|trs?|t)?|sqm|square\s*met(?:er|re)s?|m2)\b|m²/i, unit: "sq m", factor: 10.764 },
  { pattern: /\b(?:sq\.?\s*y(?:ar)?ds?|square\s*yards?|gaj|gajam)\b/i, unit: "sq yards", factor: 9 },
  { pattern: /\bcents?\b/i, unit: "cents", factor: 435.6, plot: true },
  { pattern: /\bg(?:u|h)nth?as?\b/i, unit: "guntas", factor: 1089, plot: true },
  { pattern: /\bacres?\b/i, unit: "acres", factor: 43_560, plot: true },
];

/** Reads a home size in any unit people use in India, as square feet. A plot or land size is marked as such. */
export function sizeIn(text: string): { value: number; unit: string | null; feet: number; plot: boolean } | null {
  const value = Number(text.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);
  if (!Number.isFinite(value)) return null;
  const known = SIZE_UNITS.find((item) => item.pattern.test(text));
  const plot = Boolean(known?.plot) || /\b(plot|site|land)\b/i.test(text);
  if (known) return { value, unit: known.unit, feet: value * known.factor, plot };
  return { value, unit: plot ? "sq ft of plot" : null, feet: value, plot };
}

/**
 * Answers no real customer would give: a telecalling team of lakhs, crores of calls a month, a home
 * budget of a few hundred rupees or hundreds of crores, a flat of a lakh square feet. These are jokes
 * or slips, so they are checked before recording. Anything merely high or low is left to the agent's judgement.
 */
export function unrealisticAnswers(
  questions: Array<{ id: string; label: string }>,
  answers: Record<string, string>,
): Array<{ id: string; label: string; value: number }> {
  return questions.flatMap((question) => {
    const raw = String(answers[question.id] ?? "");
    if (/budget|price|spend|cost/i.test(question.label)) {
      if (bareBudget(raw) !== null) return [];
      const rupees = rupeesIn(raw);
      return rupees && (rupees < 10_000 || rupees > 5_000_000_000) ? [{ id: question.id, label: question.label, value: rupees }] : [];
    }
    if (/sq\.?\s*ft|square|carpet/i.test(question.label)) {
      const feet = sizeIn(raw)?.feet ?? NaN;
      return Number.isFinite(feet) && feet > 0 && (feet < 100 || feet > 100_000) ? [{ id: question.id, label: question.label, value: feet }] : [];
    }
    const value = Number(raw.replace(/[,\s]/g, ""));
    if (!Number.isFinite(value) || value <= 0) return [];
    const limit = /volume|month/i.test(question.label) ? 10_000_000 : /team|telecaller|agent|staff|people/i.test(question.label) ? 5_000 : null;
    return limit && value > limit ? [{ id: question.id, label: question.label, value }] : [];
  });
}

const CANNED = /\b(?:is there )?anything else (?:i can help(?: you)?(?: with)?|on your mind)|\bhave a (?:great|nice|good|wonderful) day\b|\brest assured\b|\bfeel free to (?:ask|reach|contact)\b|\bhope this helps\b|\bplease be informed\b|\bkindly note\b/i;

/** Removes call centre sign-offs; keeps the reply as is if that would leave nothing. */
export function dropCannedLines(text: string): string {
  const lines = text.split(/\n+/).map((line) => sentencesOf(line).filter((sentence) => !CANNED.test(sentence)).join(" ")).filter(Boolean);
  return lines.length ? lines.join("\n") : text;
}

const INDIC_WORDS = /\b(unga|ungal|enga|enaku|iruku|irukum|irukanga|panum|panalam|panren|panunga|pani|panuvanga|parunga|venum|venam|solunga|romba|konjam|ila|ilai|seri|nenga|epdi|evlo|enoda|kita|vanga|mudiyum|agum|pochu|elam|kandipa|endha|entha|intha|ithu|athu|nu|ku|la|oda|dhan|hai|hain|kya|kaise|mein|mera|apka|apko|nahi|karo|karna|chahiye|kitna|bhai|han|thik|acha|batao|bolo|mujhe|aur|bhi|abhi|beku|heli|hege|tumba|yenu|madi|nimma|alli)\b/g;

function indicSentence(sentence: string): boolean {
  return (sentence.toLowerCase().replace(/([a-z])\1+/g, "$1").match(INDIC_WORDS)?.length ?? 0) >= 2;
}

export function hasIndicSentence(text: string): boolean {
  return text.split(/\n+/).some((line) => sentencesOf(line).some(indicSentence));
}

/** In an English chat, drops sentences written in Tanglish, Hinglish or Kanglish; empty if nothing English is left. */
export function dropIndicSentences(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => sentencesOf(line).filter((sentence) => !indicSentence(sentence)).join(" "))
    .filter(Boolean)
    .join("\n");
}

/** People say sir once in a message, not in every sentence. */
export function oneAddress(text: string): string {
  let seen = false;
  return text
    .replace(/(\s*,?\s*)\b(sir|mam|madam|bro)\b/gi, (match) => {
      if (!seen) {
        seen = true;
        return match;
      }
      return "";
    })
    .replace(/\s+([.?!,])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

const AI_PRAISE = "great|perfect|excellent|wonderful|fantastic|amazing|awesome|brilliant|superb|lovely";

/** Swaps the polished words a chatbot reaches for with the plain ones people actually type. */
export function plainWords(text: string): string {
  return text
    .replace(new RegExp(`\\b(?:that'?s|that is|sounds|it'?s|it is)\\s+(?:really\\s+|so\\s+)?(?:${AI_PRAISE})\\b`, "gi"), "ok")
    .replace(new RegExp(`(^|[.!?\\n]\\s*)(?:${AI_PRAISE})(?:\\s+(?:question|choice|news))?\\b`, "gi"), "$1ok")
    .replace(/(^|[.!?\n]\s*)(?:absolutely|certainly|of course|definitely)\b/gi, "$1sure");
}

/** Splits a reply into the separate messages a person would send, at most three. */
export function replyBubbles(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  let parts = lines;
  if (lines.length === 1) {
    const sentences = sentencesOf(lines[0]!);
    const words = (value: string) => value.split(/\s+/).length;
    if (sentences.length >= 2 && words(sentences[0]!) <= 6 && lines[0]!.length > 50) {
      parts = [sentences[0]!, sentences.slice(1).join(" ")];
    } else if (sentences.length >= 3 && lines[0]!.length > 140) {
      const middle = Math.ceil(sentences.length / 2);
      parts = [sentences.slice(0, middle).join(" "), sentences.slice(middle).join(" ")];
    }
  }
  return parts.length > 3 ? [...parts.slice(0, 2), parts.slice(2).join(" ")] : parts;
}

/**
 * Rewrites one message the way people text on their phone: no commas or full stops, "..." between
 * short thoughts, u / ur / ok / pls, and lower case starts. Question marks stay so a question still reads as one.
 */
export function casualText(text: string, keepCase: string[] = []): string {
  const keep = new Set(keepCase.map((word) => word.toLowerCase()).filter(Boolean));
  const links: string[] = [];
  let out = plainWords(text)
    .replace(/https?:\/\/\S+?(?=[.,!?]*(?:\s|$))/g, (link) => `\u0000${links.push(link) - 1}\u0000`)
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/\b(?:you're|youre|you are)\b/gi, "ur")
    .replace(/\byour\b/gi, "ur")
    .replace(/\byou\b/gi, "u")
    .replace(/\bokay\b/gi, "ok")
    .replace(/\bplease\b/gi, "pls")
    .replace(/\bI(?:'m| am)\b/gi, "im")
    .replace(/\bI'll\b/gi, "i will")
    .replace(/\bI've\b/gi, "i have")
    .replace(/\b(do|does|did|is|are|was|ca|wo|have|has)n't\b/gi, (_match, stem: string) => `${stem.toLowerCase() === "ca" ? "can" : stem.toLowerCase() === "wo" ? "won" : stem}nt`)
    .replace(/\b(it|that|what|there|here|let|he|she)'s\b/gi, "$1s")
    .replace(/\bI\b/g, "i")
    .replace(/['‘’`]/g, "")
    .replace(/(\d):(\d)/g, "$1\u0001$2")
    .replace(/[,;:"“”()]/g, " ")
    .replace(/\u0001/g, ":")
    .replace(/!+/g, ".");
  const sentences = out.split(/(?<=[.?।])\s+/).map((part) => part.trim()).filter(Boolean);
  out = sentences.reduce((joined, sentence, index) => {
    const bare = sentence.replace(/\.+$/, "").trim();
    const first = bare.split(/\s+/)[0] ?? "";
    const lowered = keep.has(first.toLowerCase()) || /^[A-Z0-9]{2,}$/.test(first) ? bare : bare.charAt(0).toLowerCase() + bare.slice(1);
    if (index === 0) return lowered;
    const previous = sentences[index - 1]!;
    const glue = previous.endsWith("?") ? " " : "...";
    return `${joined}${glue}${lowered}`;
  }, "");
  return out
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => links[Number(index)] ?? "")
    .replace(/ {2,}/g, " ")
    .replace(/\s+\?/g, "?")
    .trim();
}

/** Typing time for one message, the way a person thumbs it out. */
export function typingMs(text: string): number {
  return Math.min(5000, Math.max(1200, 900 + text.length * 45));
}

/** Time to read what the customer sent before starting to answer. */
export function readingMs(text: string): number {
  return Math.min(7000, text.trim().length * 35);
}

function sentenceKey(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/\b(sir|mam|madam|bro|ji|please)\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?।])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

const FILLER = new Set(["sir", "mam", "madam", "bro", "ji", "please", "ok", "okay", "so", "the", "a", "an", "is", "it", "u", "you", "ur", "your", "just", "located"]);

function wordSet(sentence: string): Set<string> {
  return new Set(casualText(sentence).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word && !FILLER.has(word)));
}

/** A sentence that shares almost all its words with one Varun just sent reads as a copy, even with a word changed. */
function nearlySame(words: Set<string>, recent: Set<string>[]): boolean {
  if (words.size < 4) return false;
  return recent.some((other) => {
    const shared = [...words].filter((word) => other.has(word)).length;
    return shared / Math.max(words.size, other.size) >= 0.75;
  });
}

function casualKey(sentence: string): string {
  return sentenceKey(casualText(sentence));
}

function repeatTest(earlier: string[], keep?: RegExp): (sentence: string) => boolean {
  const earlierSentences = earlier.flatMap((body) => body.split(/\.{2,}|(?<=[.!?।])\s+|\n+/));
  const said = new Set(earlierSentences.map(casualKey).filter((key) => key.length >= 12));
  const recentWords = earlier.slice(-3).flatMap((body) => body.split(/\.{2,}|(?<=[.!?।])\s+|\n+/)).map(wordSet).filter((words) => words.size >= 5);
  return (part) => !keep?.test(part) && (said.has(casualKey(part)) || nearlySame(wordSet(part), recentWords));
}

/** Every sentence of the draft was already sent in this chat, so sending it would read like a broken record. */
export function repeatsEarlier(text: string, earlier: string[]): boolean {
  const sentences = replyBubbles(text).flatMap(sentencesOf);
  const repeat = repeatTest(earlier);
  return sentences.length > 0 && sentences.every(repeat);
}

/**
 * Turns a written reply into the casual messages to send: split like a person would, sentences
 * Varun already sent dropped, then typed the casual way. If every sentence is a repeat, nothing is dropped.
 */
export function humanBubbles(
  text: string,
  earlier: string[],
  keepCase: string[] = [],
  options: { casual?: boolean; split?: boolean; keep?: RegExp } = {},
): string[] {
  const casual = options.casual ?? true;
  const repeat = repeatTest(earlier, options.keep);
  const split = replyBubbles(text).map(sentencesOf);
  const fresh = split.map((parts) => parts.filter((part) => !repeat(part)));
  const chosen = fresh.some((parts) => parts.length) ? fresh : split;
  if (options.split === false || !casual) {
    const lines = chosen.filter((parts) => parts.length).map((parts) => parts.join(" "));
    if (options.split === false) {
      const whole = casual ? casualText(lines.join(" "), keepCase) : lines.join(" ");
      return whole ? [whole] : [];
    }
    return lines.length > 3 ? [...lines.slice(0, 2), lines.slice(2).join(" ")] : lines;
  }
  const groups: string[][] = [];
  for (const parts of chosen.filter((item) => item.length)) {
    let group: string[] = [];
    for (const part of parts) {
      const previous = group[group.length - 1];
      if (previous && previous.split(/\s+/).length > 4 && !previous.endsWith("?")) {
        groups.push(group);
        group = [];
      }
      group.push(part);
    }
    if (group.length) groups.push(group);
  }
  const bubbles = groups.map((parts) => casualText(parts.join(" "), keepCase)).filter(Boolean);
  const most = text.includes("\n") ? 3 : 2;
  return bubbles.length > most ? [...bubbles.slice(0, most - 1), bubbles.slice(most - 1).join("...")] : bubbles;
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
