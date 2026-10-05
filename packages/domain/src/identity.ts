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
