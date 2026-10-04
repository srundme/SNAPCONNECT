import { z } from "zod";
import { evidenceInMessage, parseBudget, parsePhone } from "./parse";
import { platformReplyBlock } from "./policy";
import { leadFields, type LeadField } from "./types";

export const aiOutputSchema = z.object({
  reply: z.string().max(1000),
  field_updates: z
    .array(
      z.object({
        field: z.string(),
        value: z.string().max(2000),
        source_message_id: z.string().min(1),
        evidence: z.string().min(1).max(2000),
      }),
    )
    .max(20),
  handoff_requested: z.boolean(),
  handoff_reason: z.string().max(500).nullable(),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;

export type AcceptedUpdate = {
  field: LeadField;
  value: string;
  sourceMessageId: string;
  evidence: string;
  normalized?: Record<string, string | number | boolean | null>;
};

export type AiValidation = {
  ok: boolean;
  reply: string | null;
  replyRejectedReason: string | null;
  updates: AcceptedUpdate[];
  customAnswers: Array<{ id: string; value: string; sourceMessageId: string; evidence: string }>;
  rejected: Array<{ field: string; reason: string }>;
  handoffRequested: boolean;
  handoffReason: string | null;
  schemaError: string | null;
};

export function validateAiOutput(raw: unknown, messages: Map<string, string>, phoneRegion = "IN", questionIds: string[] = []): AiValidation {
  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reply: null,
      replyRejectedReason: null,
      updates: [],
      customAnswers: [],
      rejected: [],
      handoffRequested: false,
      handoffReason: null,
      schemaError: "Model output did not match the required schema.",
    };
  }
  const allowedQuestions = new Set(questionIds);
  const updates: AcceptedUpdate[] = [];
  const customAnswers: AiValidation["customAnswers"] = [];
  const rejected: Array<{ field: string; reason: string }> = [];
  for (const update of parsed.data.field_updates) {
    const message = messages.get(update.source_message_id);
    if (!message || !evidenceInMessage(update.evidence, message)) {
      rejected.push({ field: update.field, reason: "Evidence is not in the source message." });
      continue;
    }
    if (update.field.startsWith("q:")) {
      const id = update.field.slice(2);
      if (!allowedQuestions.has(id)) {
        rejected.push({ field: update.field, reason: "Question is not on the lead checklist." });
        continue;
      }
      customAnswers.push({ id, value: update.value.trim().slice(0, 500), sourceMessageId: update.source_message_id, evidence: update.evidence });
      continue;
    }
    if (!leadFields.includes(update.field as LeadField)) {
      rejected.push({ field: update.field, reason: "Field is not allowlisted." });
      continue;
    }
    const field = update.field as LeadField;
    const accepted = acceptField(field, update.value, update.evidence, phoneRegion);
    if (!accepted.ok) {
      rejected.push({ field: update.field, reason: accepted.reason });
      continue;
    }
    updates.push({
      field,
      value: accepted.value,
      sourceMessageId: update.source_message_id,
      evidence: update.evidence,
      normalized: accepted.normalized,
    });
  }
  let reply: string | null = parsed.data.reply.trim();
  let replyRejectedReason: string | null = null;
  const blocked = reply ? platformReplyBlock(reply) : "Reply is empty.";
  if (blocked) {
    replyRejectedReason = blocked;
    reply = null;
  }
  const handoffRequested = parsed.data.handoff_requested;
  return {
    ok: parsed.success && !parsed.data.handoff_requested,
    reply,
    replyRejectedReason,
    updates,
    customAnswers,
    rejected,
    handoffRequested,
    handoffReason: handoffRequested ? parsed.data.handoff_reason : null,
    schemaError: null,
  };
}

function acceptField(
  field: LeadField,
  value: string,
  evidence: string,
  phoneRegion: string,
): { ok: true; value: string; normalized?: Record<string, string | number | boolean | null> } | { ok: false; reason: string } {
  if (field === "budgetRaw") {
    const parsed = parseBudget(evidence);
    if (parsed.kind === "absent" || parsed.kind === "ambiguous") {
      return { ok: false, reason: "Budget evidence is ambiguous." };
    }
    if (parsed.kind === "declined") return { ok: true, value: evidence, normalized: { budgetDeclined: true } };
    if (parsed.kind === "amount") {
      return {
        ok: true,
        value: evidence,
        normalized: { budgetAmountMinor: parsed.amountMinor, budgetCurrency: parsed.currency, budgetDeclined: false },
      };
    }
    return {
      ok: true,
      value: evidence,
      normalized: {
        budgetMinMinor: parsed.minMinor,
        budgetMaxMinor: parsed.maxMinor,
        budgetCurrency: parsed.currency,
        budgetDeclined: false,
      },
    };
  }
  if (field === "phoneRaw" || field === "whatsappRaw") {
    const parsed = parsePhone(evidence, phoneRegion);
    if (parsed.kind === "declined") return { ok: true, value: evidence, normalized: { declined: true } };
    if (parsed.kind !== "valid") return { ok: false, reason: "Number failed format validation." };
    return { ok: true, value: parsed.raw, normalized: { e164: parsed.e164, declined: false } };
  }
  if (field === "sameNumber" || field === "phonePermission" || field === "whatsappPermission") {
    const flag = /^(true|yes)$/i.test(value.trim());
    if (!flag) return { ok: true, value: "false", normalized: { flag: false } };
    return { ok: true, value: "true", normalized: { flag: true } };
  }
  if (!evidence.toLowerCase().includes(value.trim().toLowerCase())) {
    return { ok: false, reason: "Proposed value is not grounded in the evidence." };
  }
  return { ok: true, value: value.trim() };
}

export function safeRepairPrompt(): string {
  return "Return only the JSON object with reply, field_updates, handoff_requested, and handoff_reason. Do not include explanations.";
}
