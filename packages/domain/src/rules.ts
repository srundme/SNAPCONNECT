export type RuleCoverage = "ALL_POSTS" | "SELECTED_POSTS";
export type CommentFilter = "KEYWORDS" | "ALL_ELIGIBLE_COMMENTS";

export type RuleSnapshot = {
  id: string;
  priority: number;
  coverage: RuleCoverage;
  commentFilter: CommentFilter;
  keywords: string[];
  exclusions: string[];
  selectedMediaIds: string[];
  excludedMediaIds: string[];
  active: boolean;
  activatedAt: Date | null;
};

export type RuleDecision = {
  winner: RuleSnapshot | null;
  reason: string;
  skipped: Array<{ ruleId: string; reason: string }>;
};

const PRAISE_WORDS = new Set([
  "nice", "wow", "woww", "super", "superb", "awesome", "great", "good", "lovely", "love", "loved", "it", "this", "that", "so", "very", "beautiful",
  "amazing", "gorgeous", "cool", "cute", "stunning", "excellent", "fantastic", "perfect", "elegant", "classy", "wonderful", "fab", "omg",
  "ok", "okay", "hmm", "lol", "haha", "hahaha", "first", "yes", "yeah", "thanks", "thank", "you", "u", "bro", "sis", "dear", "sir", "mam",
  "work", "job", "design", "designs", "interior", "interiors", "home", "pic", "pics", "view", "look", "looks", "is", "a", "the", "and", "of", "what",
  "semma", "mass", "arumai", "azhagu", "sooper", "bahut", "badhiya", "accha", "mast", "kya", "baat", "hai", "sundar", "khoob",
]);

const LEAD_SIGNAL = /\b(price|pricing|prices|cost|costs|rate|rates|budget|quote|quotation|estimate|how much|charges?|fees?|details|detail|info|information|interested|dm|inbox|contact|call me|number|whatsapp|whats app|location|address|where|visit|consultation|bhk|sq ?ft|sqft|villa|apartment|flat|my (home|house|flat|place|kitchen|bedroom|villa)|need|want|looking for|planning|possession|wardrobe|modular|renovat\w*|evlo|evvalavu|kitna|kitne|kharcha|kimat|keemat|rate enna|venum|chahiye)\b/i;

const NOT_A_CUSTOMER = /\b(jobs?|hiring|vacancy|vacancies|internship|intern|resume|cv|fresher|check (out )?my|visit my|my (page|profile|account|channel|store|shop)|follow (me|back|for follow)|f4f|collab\w*|promot\w*|sponsor\w*|link in (my )?bio|we (also )?(do|provide|offer|make|sell|supply)|our (company|services|products|page|showroom)|dealers?|distributors?|suppliers?|vendors?|earn money|crypto|giveaway)\b|https?:\/\/|www\./i;

export type CommentLeadSignal = { verdict: "lead" | "not_lead" | "unsure"; reason: string };

/** What the code alone can tell about a comment before the model is asked: obvious junk, a clear enquiry, or unsure. */
export function commentLeadSignal(text: string): CommentLeadSignal {
  const withoutTags = text.replace(/@[\w.]+/g, " ");
  const words = withoutTags.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
  if (!words.length) {
    return { verdict: "not_lead", reason: /@[\w.]+/.test(text) ? "Only tags other people." : "Only emojis or symbols, no words." };
  }
  if (NOT_A_CUSTOMER.test(withoutTags)) return { verdict: "not_lead", reason: "Spam, self-promotion, a vendor or a job request." };
  if (LEAD_SIGNAL.test(withoutTags)) return { verdict: "lead", reason: "Asks about the work, price or their own home." };
  if (words.length <= 6 && words.every((word) => PRAISE_WORDS.has(word.replace(/(.)\1{2,}/g, "$1$1")))) {
    return { verdict: "not_lead", reason: "Only praise or a reaction, no interest shown." };
  }
  return { verdict: "unsure", reason: "Needs a closer read." };
}

export function selectRule(input: {
  rules: RuleSnapshot[];
  text: string;
  mediaId: string | null;
  commentAt: Date;
}): RuleDecision {
  const skipped: Array<{ ruleId: string; reason: string }> = [];
  const candidates: RuleSnapshot[] = [];
  const haystack = input.text.toLowerCase();

  for (const rule of input.rules) {
    if (!rule.active || !rule.activatedAt) {
      skipped.push({ ruleId: rule.id, reason: "Rule is inactive." });
      continue;
    }
    if (input.commentAt.getTime() < rule.activatedAt.getTime()) {
      skipped.push({ ruleId: rule.id, reason: "Comment predates rule activation." });
      continue;
    }
    if (input.mediaId && rule.excludedMediaIds.includes(input.mediaId)) {
      skipped.push({ ruleId: rule.id, reason: "Media is excluded." });
      continue;
    }
    if (rule.coverage === "SELECTED_POSTS") {
      if (!input.mediaId || !rule.selectedMediaIds.includes(input.mediaId)) {
        skipped.push({ ruleId: rule.id, reason: "Media is not in the selected list." });
        continue;
      }
    }
    if (rule.exclusions.some((word) => word && haystack.includes(word.toLowerCase()))) {
      skipped.push({ ruleId: rule.id, reason: "An exclusion keyword matched." });
      continue;
    }
    if (rule.commentFilter === "KEYWORDS") {
      const matched = rule.keywords.some((word) => word && haystack.includes(word.toLowerCase()));
      if (!matched) {
        skipped.push({ ruleId: rule.id, reason: "No keyword matched." });
        continue;
      }
    }
    candidates.push(rule);
  }

  candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const winner = candidates[0] ?? null;
  if (!winner) return { winner: null, reason: "No rule matched.", skipped };
  const reason =
    candidates.length === 1
      ? `Matched rule ${winner.id}.`
      : `Matched ${candidates.length} rules; selected ${winner.id} by priority.`;
  for (const extra of candidates.slice(1)) {
    skipped.push({ ruleId: extra.id, reason: `Lost priority to ${winner.id}.` });
  }
  return { winner, reason, skipped };
}
