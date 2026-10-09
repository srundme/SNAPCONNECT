const PUBLIC_FIGURES: Array<[string, string]> = [
  ["kumar vembu", "the Zoho co-founder"],
  ["sridhar vembu", "the Zoho founder"],
  ["ratan tata", "the Tata Group chairman emeritus"],
  ["mukesh ambani", "the Reliance chairman"],
  ["gautam adani", "the Adani Group chairman"],
  ["anand mahindra", "the Mahindra Group chairman"],
  ["narayana murthy", "the Infosys founder"],
  ["nandan nilekani", "the Infosys co-founder"],
  ["azim premji", "the Wipro founder"],
  ["kunal shah", "the CRED founder"],
  ["sundar pichai", "the Google CEO"],
  ["satya nadella", "the Microsoft CEO"],
  ["elon musk", "the Tesla CEO"],
  ["bill gates", "the Microsoft founder"],
  ["mark zuckerberg", "the Meta CEO"],
  ["jeff bezos", "the Amazon founder"],
  ["narendra modi", "the Prime Minister"],
  ["rahul gandhi", "a national politician"],
  ["amit shah", "a national politician"],
  ["shah rukh khan", "a film star"],
  ["salman khan", "a film star"],
  ["amitabh bachchan", "a film star"],
  ["rajinikanth", "a film star"],
  ["kamal haasan", "a film star"],
  ["sachin tendulkar", "a cricketer"],
  ["virat kohli", "a cricketer"],
  ["ms dhoni", "a cricketer"],
  ["mahendra singh dhoni", "a cricketer"],
];

function tokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((token) => token.length >= 3);
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokensMatch(given: string, profile: string): boolean {
  if (given === profile) return true;
  if (given.length >= 3 && profile.includes(given)) return true;
  if (profile.length >= 4 && given.startsWith(profile)) return true;
  return given.length >= 4 && profile.length >= 4 && oneEditApart(given, profile);
}

/**
 * Whether a name the customer gave fits their profile names. Nicknames,
 * partial names and one-letter transcription slips count as a fit. Null when
 * there is nothing to compare.
 */
export function nameFitsProfile(name: string, profileNames: Array<string | null | undefined>): boolean | null {
  const given = tokens(name);
  const profile = profileNames.filter((value): value is string => Boolean(value?.trim())).flatMap(tokens);
  if (given.length === 0 || profile.length === 0) return null;
  return given.some((token) => profile.some((candidate) => tokensMatch(token, candidate)));
}

/** The well-known person a name belongs to, when someone may be joking or testing. */
export function publicFigure(name: string): string | null {
  const plain = tokens(name).join(" ");
  if (!plain) return null;
  const found = PUBLIC_FIGURES.find(([full]) => plain === full || plain.startsWith(`${full} `) || plain.endsWith(` ${full}`));
  return found ? found[1] : null;
}

export type NameConcern =
  | { kind: "public_figure"; name: string; who: string }
  | { kind: "profile_mismatch"; name: string; profile: string };

/**
 * A reason to gently double check a self-reported name. A mismatch is never
 * proof of lying: people use nicknames, shared and business accounts.
 */
export function nameConcern(name: string | null | undefined, profileNames: Array<string | null | undefined>): NameConcern | null {
  if (!name?.trim()) return null;
  const who = publicFigure(name);
  if (who) return { kind: "public_figure", name, who };
  const profile = profileNames.filter((value): value is string => Boolean(value?.trim()));
  if (nameFitsProfile(name, profile) === false) return { kind: "profile_mismatch", name, profile: profile.join(" / ") };
  return null;
}

const NOT_A_PERSON = /\b(official|interiors?|designs?|designer|studio|homes?|realty|realtors?|estates?|store|shop|media|tv|world|india|bangalore|bengaluru|blr|pvt|ltd|llp|group|team|fans?|page|club|official|the|creations?|decor|furniture|kitchens?|builders?|properties|photography|events?|foods?|travels?|fashion|boutique|salon|academy|official)\b/i;

/**
 * A person's name read from their profile name or handle, like "Riteesh Shetty" from
 * "riteesh.shetty_93", or null when it is a brand, a page or not a name at all.
 */
export function profilePersonName(displayName: string | null | undefined, username: string | null | undefined): string | null {
  const read = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const words = raw
      .normalize("NFKC")
      .replace(/\(old test[^)]*\)/gi, "")
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ")
      .replace(/[._\-]+/g, " ")
      .replace(/\d+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    // A brand or page ("Tech World Official") is never a person; a personal handle word is dropped: @gopi.talks is Gopi.
    if (NOT_A_PERSON.test(words.join(" ")) || /\btech\b/i.test(words.join(" "))) return null;
    const HANDLE_WORDS = /^(talks|talk|vlogs?|vlogger|diaries|diary|life|lifestyle|daily|clicks|shots|photos?|fitness|traveller|eats|art|arts|real|its|im|mr|ms|dr|xo|blog|blogs|creates)$/i;
    while (words.length > 1 && HANDLE_WORDS.test(words[words.length - 1]!)) words.pop();
    while (words.length > 1 && HANDLE_WORDS.test(words[0]!)) words.shift();
    if (!words.length || words.length > 3) return null;
    if (!words.every((word) => /^\p{L}{2,}$/u.test(word))) return null;
    if (!words.some((word) => word.length >= 3)) return null;
    const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
    return NOT_A_PERSON.test(name) ? null : name;
  };
  return read(displayName) ?? read(username);
}

/** Just the first name from a profile, when it looks like a real given name: "Gopi" from "Gopi N", null for "Kn". */
export function profileFirstName(displayName: string | null | undefined, username: string | null | undefined): string | null {
  const full = profilePersonName(displayName, username);
  const first = full?.split(/\s+/)[0] ?? "";
  return first.length >= 3 && /[aeiouy]/i.test(first) && !/^(mr|mrs|ms|dr|sri|shri)$/i.test(first) ? first : null;
}
