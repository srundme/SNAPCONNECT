
/** A bedroom count no real home has. 1 to 9 is left alone, including a 9 BHK villa. */
export function impossibleBhk(text: string): number | null {
  const match = text.match(/\b(\d+)\s*-?\s*(?:bhk|bkh|bsk|rk)\b/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) && count > 9 ? count : null;
}

/** The knowledge base without its price lines: prices are never told to customers, so the model never sees them. */
export function withoutPrices(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/₹|\b(?:rs\.?|inr)\s*\d|\b\d[\d,.]*\s*(?:lakh|lac|crore)s?\b|\bstarting (?:price|from)\b|\bprices?\b.{0,20}\b(?:published|starting)\b/i.test(line))
    .join("\n");
}

/**
 * Rewrites one message the way people text on their phone: no commas or full stops, "..." between
 * short thoughts, u / ur / ok / pls, and lower case starts. Question marks stay so a question still reads as one.
 */
/** The client wants no short forms (u, ur, pls, im, dont), and every message starting with a capital letter. */
export function fullWords(text: string): string {
  return text
    .replace(/\bu\b/gi, "you")
    .replace(/\bur\b/gi, "your")
    .replace(/\b(?:pls|plz|plss)\b/gi, "please")
    .replace(/\bi'?m\b/gi, "I'm")
    .replace(/\bi'll\b/gi, "I'll")
    .replace(/\bi(?='(?:ve|d)\b)/gi, "I")
    .replace(/\bi\b/g, "I")
    .replace(/\b(do|does|did|is|are|was|were|has|have|had|ca|wo|could|would|should)nt\b/gi, (_match, stem: string) => `${stem}n't`)
    .replace(/\b(that|what|there|here|let)s\b/gi, "$1's")
    .replace(/^(\s*)(\p{Ll})/u, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}

export function casualText(text: string, keepCase: string[] = []): string {
  const keep = new Set(keepCase.map((word) => word.toLowerCase()).filter(Boolean));
  const links: string[] = [];
  let out = text
    // "Mr. Shetty" is one name, not two sentences.
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Rd|No)\.(?=\s)/g, "$1")
    .replace(/https?:\/\/\S+?(?=[.,!?]*(?:\s|$))/g, (link) => `\u0000${links.push(link) - 1}\u0000`)
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/\b(?:you're|youre)\b/gi, "you are")
    .replace(/\bokay\b/gi, "ok")
    .replace(/[‘’`]/g, "'")
    .replace(/(\d):(\d)/g, "$1\u0001$2")
    .replace(/[,;:"“”()]/g, " ")
    .replace(/\u0001/g, ":")
    .replace(/!+/g, ".");
  const sentences = out.split(/(?<=[.?।])\s+/).map((part) => part.trim()).filter(Boolean);
  out = sentences.reduce((joined, sentence, index) => {
    const bare = sentence.replace(/\.+$/, "").trim();
    const first = bare.split(/\s+/)[0] ?? "";
    const lowered = keep.has(first.toLowerCase()) || /^[A-Z0-9]{2,}$/.test(first) || /^I(?:'\w+)?$/.test(first) ? bare : bare.charAt(0).toLowerCase() + bare.slice(1);
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

const SUFFIX = "a|ah|aa|um|ku|kku|la|le|nu|nnu|oda|ode|kitta|dhan|dhaan|than|thaan|ae|o|ji|wala|wale|se|ko|ka|ki|ke|mein|pe|tho";

export function humanizeReply(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/;/g, ",")
    .replace(/\.\.\.|…/g, ".")
    .replace(new RegExp(`([A-Za-z0-9+])-(${SUFFIX})\\b`, "gi"), "$1 $2")
    .replace(/\bma'am\b/gi, "mam")
    .replace(/\s*\bADDRESS\b/g, "")
    .replace(/\bfollow-up(s?)\b/gi, "follow up$1")
    .replace(/ {2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();
}

