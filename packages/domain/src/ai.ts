import { z } from "zod";

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

export function safeRepairPrompt(): string {
  return "Return only the JSON object with reply, field_updates, handoff_requested, and handoff_reason. Do not include explanations.";
}
