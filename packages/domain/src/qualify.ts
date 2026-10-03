import type { CrmState, PreferredChannel, ProjectType, Qualification, WorkType } from "./types";

export type LeadSnapshot = {
  chosenName: string | null;
  city: string | null;
  projectType: ProjectType | null;
  propertyType: string | null;
  workType: WorkType | null;
  requirement: string | null;
  budgetRaw: string | null;
  budgetAmountMinor: number | null;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  budgetCurrency: string | null;
  budgetDeclined: boolean;
  timeframeRaw: string | null;
  timeframeDeclined: boolean;
  phoneE164: string | null;
  phoneDeclined: boolean;
  whatsappE164: string | null;
  whatsappDeclined: boolean;
  sameNumberConfirmed: boolean;
  preferredChannel: PreferredChannel | null;
  phonePermission: boolean;
  whatsappPermission: boolean;
  email: string | null;
};

export type QualificationSettings = {
  requiredProjectFields: Array<"city" | "projectType" | "requirement" | "budget" | "timeframe">;
  serviceAreas: string[];
  minimumBudgetMinor: number | null;
  disqualifyOutsideArea: boolean;
  disqualifyBelowBudget: boolean;
};

export const demoQualificationSettings: QualificationSettings = {
  requiredProjectFields: ["city", "projectType", "requirement", "budget", "timeframe"],
  serviceAreas: [],
  minimumBudgetMinor: null,
  disqualifyOutsideArea: false,
  disqualifyBelowBudget: false,
};

export type QualificationDecision = {
  qualification: Qualification;
  reasons: string[];
  missing: string[];
  contactable: boolean;
};

export function evaluateQualification(
  lead: LeadSnapshot,
  settings: QualificationSettings,
): QualificationDecision {
  const reasons: string[] = [];
  const missing: string[] = [];
  const phoneReady = Boolean(lead.phoneE164 && lead.phonePermission);
  const whatsappReady = Boolean(lead.whatsappE164 && lead.whatsappPermission);
  const contactable = phoneReady || whatsappReady;
  if (!contactable) {
    if (!lead.phoneE164 && !lead.whatsappE164) missing.push("contact number");
    else missing.push("follow-up permission");
  } else {
    reasons.push("A validated number and recorded permission are present.");
  }

  const projectChecks: Record<(typeof settings.requiredProjectFields)[number], boolean> = {
    city: Boolean(lead.city),
    projectType: Boolean(lead.projectType),
    requirement: Boolean(lead.requirement),
    budget: Boolean(lead.budgetAmountMinor || lead.budgetMinMinor || lead.budgetDeclined),
    timeframe: Boolean(lead.timeframeRaw || lead.timeframeDeclined),
  };
  for (const field of settings.requiredProjectFields) {
    if (!projectChecks[field]) missing.push(field);
    else if (field === "budget" && lead.budgetDeclined) reasons.push("Budget was declined and stays a reviewable gap.");
    else if (field === "timeframe" && lead.timeframeDeclined) reasons.push("Timeline was declined and stays a reviewable gap.");
  }

  const comparableBudget = lead.budgetAmountMinor ?? lead.budgetMaxMinor ?? lead.budgetMinMinor;
  const outsideArea =
    settings.serviceAreas.length > 0 &&
    Boolean(lead.city) &&
    !settings.serviceAreas.some((area) => area.toLowerCase() === lead.city!.toLowerCase());
  const belowBudget =
    settings.minimumBudgetMinor !== null &&
    comparableBudget !== null &&
    comparableBudget < settings.minimumBudgetMinor;

  if (outsideArea && settings.disqualifyOutsideArea) {
    return {
      qualification: "DISQUALIFIED",
      reasons: [`City ${lead.city} is outside the configured service area.`],
      missing,
      contactable,
    };
  }
  if (belowBudget && settings.disqualifyBelowBudget) {
    return {
      qualification: "DISQUALIFIED",
      reasons: ["Budget is below the configured minimum."],
      missing,
      contactable,
    };
  }
  if (outsideArea) reasons.push("City is outside the configured service area and is flagged for review.");
  if (belowBudget) reasons.push("Budget is below the configured minimum and is flagged for review.");

  const projectComplete = settings.requiredProjectFields.every((field) => {
    if (field === "budget") return Boolean(lead.budgetAmountMinor || lead.budgetMinMinor) && !lead.budgetDeclined;
    if (field === "timeframe") return Boolean(lead.timeframeRaw) && !lead.timeframeDeclined;
    return projectChecks[field];
  });

  if (contactable && projectComplete && !outsideArea && !belowBudget) {
    reasons.push("Configured project fields are complete.");
    return { qualification: "QUALIFIED", reasons, missing: [], contactable };
  }
  if (contactable) {
    reasons.push("Contactable. Project qualification is still incomplete.");
    return { qualification: "CONTACTABLE", reasons, missing, contactable };
  }
  const started = Boolean(
    lead.city || lead.projectType || lead.requirement || lead.budgetRaw || lead.phoneE164 || lead.chosenName,
  );
  return {
    qualification: started ? "IN_PROGRESS" : "NEW",
    reasons,
    missing,
    contactable,
  };
}

export const replyPromptFields = [
  "projectType",
  "city",
  "requirement",
  "budget",
  "timeframe",
  "phone",
  "whatsapp",
  "permission",
  "closing",
] as const;

export type ReplyPromptField = (typeof replyPromptFields)[number];

export const defaultReplyPrompts: Record<ReplyPromptField, string> = {
  projectType: "Are you planning interiors for a home or a commercial space?",
  city: "Which city is your project in?",
  requirement: "What kind of interiors work do you need?",
  budget: "What budget range should we plan around?",
  timeframe: "When are you hoping to start?",
  phone: "What phone number should the team use?",
  whatsapp: "Is WhatsApp on that same number, or a different one?",
  permission: "May the team call or WhatsApp you about this project?",
  closing: "Thanks. I have the project details and the team can follow up on your preferred channel.",
};

export function resolveReplyPrompts(value: unknown): Record<ReplyPromptField, string> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const resolved = { ...defaultReplyPrompts };
  for (const key of replyPromptFields) {
    const text = record[key];
    if (typeof text === "string" && text.trim()) resolved[key] = text.trim().slice(0, 500);
  }
  return resolved;
}

export function nextReplyPrompt(
  lead: LeadSnapshot,
  settings: QualificationSettings,
  prompts: Record<ReplyPromptField, string> = defaultReplyPrompts,
): { field: ReplyPromptField; prompt: string } {
  if (!lead.projectType) return { field: "projectType", prompt: prompts.projectType };
  if (!lead.city) return { field: "city", prompt: prompts.city };
  if (!lead.requirement) return { field: "requirement", prompt: prompts.requirement };
  if (!lead.budgetRaw && !lead.budgetDeclined && settings.requiredProjectFields.includes("budget")) {
    return { field: "budget", prompt: prompts.budget };
  }
  if (!lead.timeframeRaw && !lead.timeframeDeclined && settings.requiredProjectFields.includes("timeframe")) {
    return { field: "timeframe", prompt: prompts.timeframe };
  }
  if (!lead.phoneE164 && !lead.phoneDeclined) return { field: "phone", prompt: prompts.phone };
  if (!lead.whatsappE164 && !lead.whatsappDeclined && !lead.sameNumberConfirmed) {
    return { field: "whatsapp", prompt: prompts.whatsapp };
  }
  if (lead.phoneE164 && !lead.phonePermission && !(lead.whatsappE164 && lead.whatsappPermission)) {
    return { field: "permission", prompt: prompts.permission };
  }
  return { field: "closing", prompt: prompts.closing };
}

export function nextQuestion(lead: LeadSnapshot, settings: QualificationSettings): string | null {
  return nextReplyPrompt(lead, settings).prompt;
}

export function crmStateFor(input: {
  contactable: boolean;
  permissionRecorded: boolean;
  previous: CrmState;
  syncFailed: boolean;
}): CrmState {
  if (!input.contactable || !input.permissionRecorded) return input.previous === "SYNCED" ? "SYNCED" : "NOT_READY";
  if (input.previous === "SYNCED") return "SYNCED";
  if (input.syncFailed) return "NEEDS_ATTENTION";
  return "PENDING";
}

export function manualQualification(input: {
  next: Qualification;
  reason: string;
}): { ok: true } | { ok: false; error: string } {
  if (!input.reason.trim()) return { ok: false, error: "A manual qualification change requires a reason." };
  return { ok: true };
}
