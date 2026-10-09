import Link from "next/link";
import { Check, ChevronDown, Link2, X } from "lucide-react";
import type { ReactNode } from "react";
import type { LeadQuestion } from "@snapsocial/domain";
import { ChannelMark, StatusLabel } from "@/components/ui";
import { linkPeopleFromMatch, rejectPeopleMatch, separatePerson } from "@/lib/actions";
import { fullIST, whenIST } from "@/lib/format";
import { RatingChip } from "./chips";
import { channelName, crmWording, memoryParagraphs, shortQuestionLabel, type Channel } from "./labels";

export type PanelLead = {
  rating: string | null;
  ratingReason: string | null;
  crmState: string;
  phoneE164: string | null;
  email: string | null;
  answers: Record<string, string>;
};

/** One channel contact of a person: where they chatted and when. */
export type PersonChannel = {
  contactId: string;
  channel: Channel;
  name: string;
  conversationId: string | null;
  lastAt: Date | null;
};

/** An open "possibly the same person" suggestion for the open chat. */
export type PossibleMatch = {
  matchId: string;
  other: PersonChannel;
  reasons: string;
  askedAt: Date | null;
};

function OtherChat({ person }: { person: PersonChannel }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ChannelMark channel={person.channel} />
        {person.conversationId ? (
          <Link href={`/inbox?id=${person.conversationId}`} className="min-w-0 truncate text-[13.5px] font-semibold hover:text-[var(--color-accent-ink)] hover:underline underline-offset-2">
            {person.name}
          </Link>
        ) : (
          <span className="min-w-0 truncate text-[13.5px] font-semibold">{person.name}</span>
        )}
      </div>
      <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
        {person.lastAt ? <>Last chatted <time dateTime={person.lastAt.toISOString()} className="tabular-nums">{whenIST(person.lastAt)}</time></> : "No chat yet"}
        {person.conversationId ? <> · <Link href={`/inbox?id=${person.conversationId}`} className="font-medium text-[var(--color-accent-ink)] hover:underline underline-offset-2">Open chat</Link></> : null}
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">{children}</p>;
}

export type ProjectCard = {
  name: string;
  locality: string | null;
  kind?: "apartment" | "villa" | null;
  builder?: string | null;
  bhkOptions?: number[];
  sizes?: Record<string, string>;
  readyToMove?: boolean;
  possessionYear?: number | null;
  underConstruction?: boolean;
  url?: string | null;
};

export function LeadPanel({
  lead,
  questions,
  chosenName,
  channel,
  memory,
  memoryUpdatedAt,
  samePerson = [],
  possibleMatches = [],
  canDecide = false,
  project = null,
}: {
  project?: ProjectCard | null;
  lead: PanelLead | null;
  questions: LeadQuestion[];
  chosenName: string | null;
  channel: Channel;
  memory: string | null;
  memoryUpdatedAt: Date | null;
  samePerson?: PersonChannel[];
  possibleMatches?: PossibleMatch[];
  canDecide?: boolean;
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

      {project ? (
        <section>
          <SectionTitle>Project</SectionTitle>
          <div className="mt-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-paper)]/60 p-3 text-[13px]">
            <p className="font-medium text-[var(--color-ink)]">{project.name}</p>
            <p className="text-[12.5px] text-[var(--color-muted)]">
              {[project.kind ? (project.kind === "villa" ? "Villa project" : "Apartment project") : null, project.locality, project.builder ? `by ${project.builder}` : null].filter(Boolean).join(" · ")}
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              {project.bhkOptions?.length ? (<><dt className="text-[var(--color-muted)]">Homes</dt><dd>{project.bhkOptions.join(", ")} BHK</dd></>) : null}
              {project.sizes && Object.keys(project.sizes).length ? (<><dt className="text-[var(--color-muted)]">Sizes</dt><dd>{Object.entries(project.sizes).map(([bhk, size]) => `${bhk} BHK ${size}`).join(" · ")}</dd></>) : null}
              {project.readyToMove || project.possessionYear || project.underConstruction ? (<><dt className="text-[var(--color-muted)]">Stage</dt><dd>{project.readyToMove ? "Ready to move" : project.possessionYear ? `Possession around ${project.possessionYear}` : "Under construction"}</dd></>) : null}
            </dl>
            <p className="mt-2 text-[11.5px] text-[var(--color-muted)]">From public listings, not the customer. {project.url ? <a href={project.url} target="_blank" rel="noreferrer" className="text-[var(--color-accent-ink)] underline underline-offset-2">Source</a> : null}</p>
          </div>
        </section>
      ) : null}

      {samePerson.length > 0 ? (
        <section>
          <div className="flex items-center gap-1.5">
            <Link2 size={13} aria-hidden className="text-[var(--color-accent)]" />
            <SectionTitle>Same person on</SectionTitle>
          </div>
          <ul className="mt-2 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
            {samePerson.map((person) => (
              <li key={person.contactId} className="group/row py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <OtherChat person={person} />
                  {canDecide ? (
                    <details className="group/sep shrink-0">
                      <summary className="list-none rounded-md border border-[var(--color-line)] bg-white px-2 py-0.5 text-[12px] font-medium text-[var(--color-muted)] hover:border-[#d9cfbf] hover:text-[var(--color-ink)] [&::-webkit-details-marker]:hidden">
                        <span className="group-open/sep:hidden">Separate</span>
                        <span className="hidden group-open/sep:inline">Cancel</span>
                      </summary>
                    </details>
                  ) : null}
                </div>
                {canDecide ? (
                  <form action={separatePerson} className="mt-2 hidden flex-wrap items-center justify-between gap-2 rounded-lg bg-[#fdf4f5] px-2.5 py-2 group-has-[details[open]]/row:flex">
                    <input type="hidden" name="contactId" value={person.contactId} />
                    <p className="min-w-0 flex-1 text-[12px] leading-4 text-[#7a2e3b]">Not the same person? The {channelName(person.channel)} chat is kept apart from now on. Answers already shared stay.</p>
                    <button type="submit" className="shrink-0 border-rose-200 px-2.5 py-1 text-[12px] text-rose-800 hover:!bg-rose-50">Separate</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-4 text-[var(--color-muted)]">Answers are shared across these chats. Zoho has one lead for this person.</p>
        </section>
      ) : null}

      {possibleMatches.length > 0 ? (
        <section>
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            <SectionTitle>Possibly the same person</SectionTitle>
          </div>
          <ul className="mt-2 space-y-2">
            {possibleMatches.map((match) => (
              <li key={match.matchId} className="rounded-xl border border-[#eadfca] bg-[#fbf7ef] p-3">
                <OtherChat person={match.other} />
                <p className="mt-2 text-[12.5px] leading-[1.35] text-[#4a4239]">
                  <span className="text-[var(--color-muted)]">Why: </span>{match.reasons}
                </p>
                {match.askedAt ? (
                  <p className="mt-1 text-[12px] text-[var(--color-accent-ink)]">Varun asked them · {whenIST(match.askedAt)}</p>
                ) : null}
                {canDecide ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <form action={linkPeopleFromMatch}>
                      <input type="hidden" name="matchId" value={match.matchId} />
                      <button type="submit" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12.5px] text-white" title="Join the two chats: answers are shared and Zoho keeps one lead.">
                        <Check size={13} aria-hidden /> Same person
                      </button>
                    </form>
                    <form action={rejectPeopleMatch}>
                      <input type="hidden" name="matchId" value={match.matchId} />
                      <button type="submit" className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12.5px]" title="They will not be suggested again.">
                        <X size={13} aria-hidden /> Not the same
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
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
