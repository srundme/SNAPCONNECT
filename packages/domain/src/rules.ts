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
