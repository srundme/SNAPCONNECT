import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { LeadQuestion } from "@snapsocial/domain";
import { StatusLabel } from "@/components/ui";
import { fullIST } from "@/lib/format";
import { RatingChip } from "./chips";
import { crmWording, memoryParagraphs, shortQuestionLabel, type Channel } from "./labels";

export type PanelLead = {
  rating: string | null;
  ratingReason: string | null;
  crmState: string;
  phoneE164: string | null;
  email: string | null;
  answers: Record<string, string>;
};

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{children}</p>;
}

export function LeadPanel({
  lead,
  questions,
  chosenName,
  channel,
  memory,
  memoryUpdatedAt,
}: {
  lead: PanelLead | null;
  questions: LeadQuestion[];
  chosenName: string | null;
  channel: Channel;
  memory: string | null;
  memoryUpdatedAt: Date | null;
}) {
  const paragraphs = memoryParagraphs(memory);
  const rows: Array<{ id: string; label: string; full: string; answer: string | null }> = lead
    ? questions.map((question) => {
      const label = shortQuestionLabel(question);
      const answer = lead.answers[question.id]
        ?? (question.kind === "name" ? chosenName : null)
        ?? (question.kind === "phone" ? lead.phoneE164 : null)
        ?? (label === "Email" ? lead.email : null);
      return { id: question.id, label, full: question.label, answer: answer?.trim() || null };
    })
    : [];
  if (lead && !rows.some((row) => row.label === "Phone")) rows.push({ id: "__phone", label: "Phone", full: "Phone", answer: lead.phoneE164 });
  if (lead && lead.email && !rows.some((row) => row.label === "Email")) rows.push({ id: "__email", label: "Email", full: "Email", answer: lead.email });
  const answered = rows.filter((row) => row.answer).length;
  const crm = lead ? crmWording(lead.crmState) : null;

  return (
    <div className="space-y-6 p-4 text-sm sm:p-5">
      <section>
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Lead</SectionTitle>
          {lead ? <RatingChip rating={lead.rating} /> : null}
        </div>
        {!lead ? (
          <p className="mt-2 text-[13px] leading-5 text-[var(--color-muted)]">No lead yet. Varun creates one as soon as the customer shares something useful.</p>
        ) : (
          <>
            {lead.ratingReason && (lead.rating === "HOT" || lead.rating === "JUNK") ? (
              <p className="mt-2 text-[13px] leading-5 text-[#4a4239]">{lead.ratingReason}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {crm ? <StatusLabel tone={crm.tone}>{crm.text}</StatusLabel> : null}
              <span className="text-[12px] text-[var(--color-muted)]">{answered} of {rows.length} answered</span>
            </div>
          </>
        )}
      </section>

      {lead ? (
        <section>
          <SectionTitle>Details</SectionTitle>
          <dl className="mt-2 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-2" title={row.full}>
                <dt className="text-[12.5px] text-[var(--color-muted)]">{row.label}</dt>
                <dd className={row.answer ? "break-words text-[13.5px] font-medium" : "text-[13.5px] text-[#b3aa9c]"}>
                  {row.answer && row.label === "Phone" ? <a href={`tel:${row.answer.replace(/[^\d+]/g, "")}`} className="hover:text-[var(--color-accent-ink)]">{row.answer}</a>
                    : row.answer && row.label === "Email" ? <a href={`mailto:${row.answer}`} className="hover:text-[var(--color-accent-ink)]">{row.answer}</a>
                      : row.answer ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[12px] leading-4 text-[var(--color-muted)]">
            {channel === "WHATSAPP" ? "They are chatting from this WhatsApp number." : "A valid number is not proof that the person owns it, or that it is on WhatsApp."}
          </p>
        </section>
      ) : null}

      <section>
        <details className="group" open={paragraphs.length > 0 && paragraphs.length <= 3}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <SectionTitle>Summary</SectionTitle>
            <ChevronDown size={14} aria-hidden className="text-[var(--color-muted)] transition-transform group-open:rotate-180" />
          </summary>
          {paragraphs.length > 0 ? (
            <div className="mt-2 space-y-2 text-[13px] leading-5 text-[#3d362e]">
              {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              {memoryUpdatedAt ? <p className="text-[11.5px] text-[var(--color-muted)]">Updated {fullIST(memoryUpdatedAt)}</p> : null}
            </div>
          ) : (
            <p className="mt-2 text-[13px] leading-5 text-[var(--color-muted)]">No summary yet. Varun writes one once the chat grows past its last 20 messages.</p>
          )}
        </details>
      </section>
    </div>
  );
}
