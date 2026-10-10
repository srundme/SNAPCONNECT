
type Question = { id: string; label: string };

const PLACE = /where is the home|location|which city|which area|locality/i;

/** Their answer to where the home is, which may name the apartment project. */
export function placeAnswer(questions: Question[], answers: Record<string, string>): string {
  return answerFor(questions, answers, PLACE);
}

function questionFor(questions: Question[], pattern: RegExp): Question | undefined {
  return questions.find((item) => pattern.test(item.label));
}

function answerFor(questions: Question[], answers: Record<string, string>, pattern: RegExp): string {
  const question = questionFor(questions, pattern);
  return question ? String(answers[question.id] ?? "").trim() : "";
}

/** A name, phone or email correction, which must not be saved as where the home is. */
// Bengaluru developers and their brands. A builder alone is not a property: "Puravankara" has dozens.
const BUILDER_NAMES: Array<[RegExp, string]> = [
  [/\bpuravankara\b/i, "Puravankara"], [/\bpurva\b/i, "Purva"], [/\bprovident\b/i, "Provident"],
  [/\bprestige\b/i, "Prestige"], [/\bsobha\b/i, "Sobha"], [/\bbrigade\b/i, "Brigade"], [/\bgodrej\b/i, "Godrej"],
  [/\bembassy\b/i, "Embassy"], [/\bsalarpuria\b/i, "Salarpuria"], [/\bsattva\b/i, "Sattva"], [/\bmantri\b/i, "Mantri"],
  [/\bshriram\b/i, "Shriram"], [/\bassetz\b/i, "Assetz"], [/\badarsh\b/i, "Adarsh"], [/\bconcorde?\b/i, "Concorde"], [/\bpuravank\w*/i, "Puravankara"],
  [/\btotal environment\b/i, "Total Environment"], [/\bsumadhura\b/i, "Sumadhura"], [/\bvaswani\b/i, "Vaswani"],
  [/\bnitesh\b/i, "Nitesh"], [/\bmahindra\b/i, "Mahindra"], [/\btata housing\b/i, "Tata Housing"], [/\bdlf\b/i, "DLF"],
  [/\bsnn\b/i, "SNN"], [/\bcasagrand\b/i, "Casagrand"], [/\bbhartiya\b/i, "Bhartiya"], [/\bmana\b/i, "Mana"],
  [/\bsterling\b/i, "Sterling"], [/\bkolte\s*patil\b/i, "Kolte Patil"], [/\blodha\b/i, "Lodha"], [/\bbirla\b/i, "Birla"],
];

/**
 * The developer's name with nothing that picks one of their properties: "Puravankara",
 * "Prestige at Bangalore", "it's a Sobha flat". Returns the builder, or null when a property is named.
 */
export function builderOnly(text: string): string | null {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "").trim();
  const builder = BUILDER_NAMES.find(([pattern]) => pattern.test(plain));
  if (!builder) return null;
  const rest = plain
    .replace(builder[0], " ")
    .replace(/\b(bengaluru|bangalore|banglore|blr|in|at|it'?s|its|a|an|the|my|our|flat|flats|home|house|apartment|apartments|villa|villas|project|property|builder|group|developers?|projects|residential|from|by|is|sir|mam|ji|only|one|ok|yes)\b/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
  return rest ? null : builder[1];
}

const BENGALURU_AREAS = /\b(whitefield|sarjapur|bellandur|hebbal|yelahanka|indiranagar|koramangala|jayanagar|jp nagar|j\.?p\.? nagar|hsr|btm|marathahalli|electronic city|e[- ]?city|kanakapura|bannerghatta|hennur|thanisandra|devanahalli|kr puram|k\.?r\.? puram|varthur|panathur|kadugodi|hoodi|mahadevapura|rajajinagar|malleshwaram|basavanagudi|banashankari|rr nagar|kengeri|yeshwanthpur|ulsoor|frazer town|richmond town|sadashivanagar|old airport road|outer ring road|hosur road|bellary road|tumkur road|mysore road|magadi road|horamavu|kalyan nagar|hbr layout|banaswadi|cv raman nagar|domlur|ejipura|wilson garden|vijayanagar|nagarbhavi|uttarahalli|begur|bommanahalli|chandapura|attibele|budigere|jakkur|sahakar nagar|rt nagar|harlur|haralur|kasavanahalli|doddanekundi|brookefield|itpl|kundalahalli|aecs layout|nallurhalli|channasandra|bagalur|yelahanka new town)\b/i;
const AREA_WORDS = /\b(layout|nagar|road|halli|palya|pura|puram|sector|phase|stage|block|colony|extension|town|village|city)\b/i;

/**
 * Only an area, like "Electronic City" or "HSR Layout, Bangalore": no property to look up.
 * A builder's name ("Sobha City", "Prestige Falcon City") makes it a property, not an area.
 */
export function areaOnly(text: string): string | null {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "").replace(/\b(my|our|it'?s|its|is|in|at|the|apartment|flat|home|house|villa|bengaluru|bangalore|banglore|blr|karnataka)\b/gi, " ").replace(/[^a-z0-9.\s-]/gi, " ").replace(/\s+/g, " ").trim();
  if (!plain || plain.split(" ").length > 4 || BUILDER_NAMES.some(([pattern]) => pattern.test(plain))) return null;
  return BENGALURU_AREAS.test(plain) || AREA_WORDS.test(plain) ? plain.replace(/\b\w/g, (letter) => letter.toUpperCase()) : null;
}

