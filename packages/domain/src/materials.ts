/**
 * The firm's material specification and warranty, kept as separate entries so a question about
 * the kitchen gets the kitchen fact only, never the whole sheet.
 */
export type MaterialEntry = {
  id: string;
  area: string;
  material: string;
  brand: string;
  madeIn: string;
  /** Words a customer would use when asking about this area. */
  keywords: string[];
};

export type WarrantyTerms = {
  items: Array<{ item: string; term: string }>;
  covers: string;
  notCovered: string;
};

export function parseMaterials(value: unknown): MaterialEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const text = (key: string, limit: number) => String(item[key] ?? "").trim().slice(0, limit);
    const entry: MaterialEntry = {
      id: text("id", 60),
      area: text("area", 120),
      material: text("material", 600),
      brand: text("brand", 120),
      madeIn: text("madeIn", 80),
      keywords: Array.isArray(item.keywords) ? item.keywords.map((word) => String(word).trim().toLowerCase()).filter(Boolean).slice(0, 30) : [],
    };
    return entry.id && entry.area && entry.material ? [entry] : [];
  }).slice(0, 30);
}

export function parseWarranty(value: unknown): WarrantyTerms | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items.flatMap((raw) => {
        const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const name = String(item.item ?? "").trim().slice(0, 120);
        const term = String(item.term ?? "").trim().slice(0, 160);
        return name && term ? [{ item: name, term }] : [];
      }).slice(0, 15)
    : [];
  if (!items.length) return null;
  return {
    items,
    covers: String(record.covers ?? "").trim().slice(0, 600),
    notCovered: String(record.notCovered ?? "").trim().slice(0, 1000),
  };
}

const MATERIAL_TOPIC = /\b(materials?|ply(?:wood)?|wood|board|hdf|mdf|particle ?board|hinges?|channels?|drawers?|hardware|fittings?|sliding|appliances?|chimney|hood|hob|oven|otg|glass|mirror|finish(?:es)?|laminates?|acrylics?|veneers?|lacquer|pu|brands?|quality|termite|borer|water ?proof|waterproof|moisture|bwp|bwr|blum|hettich|h[aä]fele|century|aristo|siemens|bosch|grass)\b/i;
const WARRANTY_TOPIC = /\b(warranty|warrantee|guarantee|guaranty|after ?sales?|lifetime|life ?time)\b/i;
const NOT_COVERED = /\b(not covered|doesn'?t cover|does not cover|exclusions?|what is covered|what'?s covered|terms|conditions|claim|damage|scratch\w*|chipping|misuse)\b/i;

function matches(entry: MaterialEntry, text: string): boolean {
  const plain = text.toLowerCase();
  return entry.keywords.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(plain));
}

function fact(entry: MaterialEntry): string {
  const origin = entry.madeIn && !/^india$/i.test(entry.madeIn) ? ` (${entry.madeIn})` : "";
  return `${entry.area}: ${entry.material}${entry.brand ? `. Brand: ${entry.brand}${origin}` : ""}.`;
}

/**
 * The material or warranty facts that answer this message, as one line for the model, or null
 * when the message is not about materials. At most two entries, so the reply stays a reply.
 */
export function materialLine(text: string, materials: MaterialEntry[], warranty: WarrantyTerms | null): string | null {
  const plain = text.replace(/^\(Replied to:[\s\S]*?\)\s*/, "");
  const lines: string[] = [];
  if (WARRANTY_TOPIC.test(plain) && warranty) {
    const asked = warranty.items.filter((item) => item.item.toLowerCase().split(/[\s/,]+/).some((word) => word.length > 3 && new RegExp(`\\b${word.slice(0, 5)}`, "i").test(plain)));
    const items = asked.length ? asked : warranty.items;
    lines.push(`Warranty facts: ${items.map((item) => `${item.item}: ${item.term}`).join("; ")}.${warranty.covers ? ` ${warranty.covers}` : ""}`);
    if (NOT_COVERED.test(plain) && warranty.notCovered) lines.push(`Not covered: ${warranty.notCovered}`);
  }
  if (MATERIAL_TOPIC.test(plain) && materials.length) {
    const picked = materials.filter((entry) => matches(entry, plain)).slice(0, 2);
    if (picked.length) {
      lines.push(`Material facts for what they asked: ${picked.map(fact).join(" ")}`);
    } else {
      const overview = ["wet", "hinges", "channels"].map((id) => materials.find((entry) => entry.id === id)).filter((entry): entry is MaterialEntry => Boolean(entry));
      if (overview.length) lines.push(`They asked about materials in general. Give a short overview from these only: ${overview.map(fact).join(" ")} Then ask which area they want to know more about, like the kitchen, wardrobes, hardware or finishes.`);
    }
  }
  if (!lines.length) return null;
  return `${lines.join(" ")} Answer only what they asked, in one or two short sentences in your own words: the brand and one plain benefit. Never paste or list the whole specification, never name a material or brand that is not in these facts, and never give a price. Then carry on with the chat.`;
}
