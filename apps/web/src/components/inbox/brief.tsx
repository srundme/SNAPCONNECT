import type { ReactNode } from "react";
import { clsx } from "clsx";
import { ChevronDown, ScrollText } from "lucide-react";
import { askingPrice, chatLanguageSample, languageName, requestedTime, type LeadQuestion } from "@snapsocial/domain";
import { agoIST, whenIST } from "@/lib/format";
import { shortQuestionLabel } from "./labels";

/** A plain-English takeover brief, worked out in code from the chat and the lead. No AI call. */
export type TakeoverBrief = {
  profile: string[];
  rating: { label: string; reason: string | null } | null;
  intent: string[];
  language: string | null;
  last: { text: string; at: Date } | null;
  handoff: string | null;
};

type BriefMessage = { author: "PROSPECT" | "AI" | "STAFF" | "SYSTEM"; body: string; createdAt: Date };

const OFFER_WISH: Record<string, string> = {
  consultation: "Wants a consultation",
  experience: "Wants an experience centre visit",
  not_now: "Not ready to meet yet",
};

function clip(text: string, max: number): string {
  const plain = text.replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

function times(count: number): string {
  return count === 1 ? "once" : count === 2 ? "twice" : `${count} times`;
}

export function buildBrief(input: {
  messages: BriefMessage[];
  lead: { rating: string | null; ratingReason: string | null; handoffReason: string | null; answers: Record<string, string> } | null;
  questions: LeadQuestion[];
  workingHours: string;
  handedAutomatically: boolean;
}): TakeoverBrief {
  const { messages, lead, questions, workingHours } = input;
  const prospect = messages.filter((message) => message.author === "PROSPECT" && message.body.trim());

  const profile: string[] = [];
  if (lead) {
    for (const question of questions) {
      if (question.kind === "name" || question.kind === "phone") continue;
      const label = shortQuestionLabel(question);
      if (label === "Email") continue;
      const answer = lead.answers[question.id]?.trim();
      if (!answer || /^(?:yes|no)$/i.test(answer)) continue;
      profile.push(clip(answer, 40));
      if (profile.length >= 4) break;
    }
  }

  const rating = lead?.rating ? { label: lead.rating.toUpperCase(), reason: lead.ratingReason?.trim() || null } : null;

  const intent: string[] = [];
  const priceAsks = prospect.filter((message) => askingPrice(message.body)).length;
  if (priceAsks > 0) intent.push(`Asked the price ${times(priceAsks)}`);

  const system = messages.filter((message) => message.author === "SYSTEM");
  const offer = [...system].reverse().find((message) => message.body.startsWith("Offer answer:"));
  const offerKind = offer?.body.slice("Offer answer:".length).split("|")[0]?.trim().toLowerCase();
  if (offerKind && OFFER_WISH[offerKind]) intent.push(OFFER_WISH[offerKind]);

  for (const message of [...prospect].reverse()) {
    const time = requestedTime(message.body, message.createdAt, workingHours);
    if (!time) continue;
    const day = time.day === "today" || time.day === "tomorrow" ? time.day : time.day.charAt(0).toUpperCase() + time.day.slice(1);
    const relative = time.day === "today" || time.day === "tomorrow";
    const said = relative && Date.now() - message.createdAt.getTime() > 12 * 3_600_000 ? ` (said ${whenIST(message.createdAt)})` : "";
    intent.push(`Asked for ${day} ${time.clock}${said}${time.inside ? "" : ", outside working hours"}`);
    break;
  }

  const builderOnly = [...system].reverse().find((message) => message.body.startsWith("Builder only:"));
  if (builderOnly && !profile.length) {
    const builder = builderOnly.body.slice("Builder only:".length).split("|")[0]?.trim();
    if (builder) intent.push(`Named only the builder: ${clip(builder, 40)}`);
  }
  if (system.some((message) => message.body.startsWith("Email unverified:"))) intent.push("Email not verified");

  const sample = chatLanguageSample(prospect.map((message) => message.body));
  const language = !prospect.length ? null : sample ? languageName(sample).split(",")[0]!.trim() : "English";

  const lastMessage = prospect[prospect.length - 1];
  const last = lastMessage ? { text: clip(lastMessage.body.replace(/^\(Replied to:[\s\S]*?\)\s*/, ""), 90), at: lastMessage.createdAt } : null;

  const handoff = input.handedAutomatically && lead?.handoffReason?.trim() ? lead.handoffReason.trim() : null;

  return { profile, rating, intent, language, last, handoff };
}

function Line({ children }: { children: ReactNode }) {
  return <p className="min-w-0 break-words">{children}</p>;
}

function Dot() {
  return <span aria-hidden className="px-1 text-[#c4b89f]">·</span>;
}

function joined(items: string[]) {
  return items.map((item, index) => (
    <span key={index}>
      {index > 0 ? <Dot /> : null}
      {item}
    </span>
  ));
}

/** "Brief": what someone taking over needs to know, in two to four lines. */
export function Brief({ brief, compact = false, open = true }: { brief: TakeoverBrief; compact?: boolean; open?: boolean }) {
  const hasFirst = brief.profile.length > 0 || brief.rating;
  return (
    <details
      open={open}
      className={clsx(
        "group/brief rounded-xl border border-[#eadfca] bg-[#fbf7ef]",
        compact ? "px-3 py-2" : "p-3",
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent-ink)]">
          <ScrollText size={13} aria-hidden className="text-[var(--color-accent)]" />
          Brief
        </span>
        <ChevronDown size={14} aria-hidden className="text-[var(--color-muted)] transition-transform group-open/brief:rotate-180" />
      </summary>
      <div className={clsx("mt-1.5 space-y-1 leading-[1.4] text-[#3d362e]", compact ? "text-[12.5px]" : "text-[13px]")}>
        {hasFirst ? (
          <Line>
            {joined(brief.profile)}
            {brief.rating ? (
              <>
                {brief.profile.length ? <Dot /> : null}
                <span className={clsx("font-semibold", brief.rating.label === "HOT" ? "text-[var(--color-accent-ink)]" : "text-[var(--color-ink)]")}>{brief.rating.label}</span>
                {brief.rating.reason ? <span className="text-[var(--color-muted)]"> ({clip(brief.rating.reason, compact ? 70 : 110)})</span> : null}
              </>
            ) : null}
          </Line>
        ) : null}
        {brief.intent.length ? <Line>{joined(brief.intent)}</Line> : null}
        {brief.language || brief.last ? (
          <Line>
            {brief.language ? <>Speaks {brief.language}</> : null}
            {brief.last ? (
              <>
                {brief.language ? <Dot /> : null}
                Last message <time dateTime={brief.last.at.toISOString()} className="tabular-nums">{agoIST(brief.last.at)}</time>: <q className="italic text-[#4a4239]">{brief.last.text}</q>
              </>
            ) : null}
          </Line>
        ) : null}
        {brief.handoff ? (
          <Line>
            <span className="text-[#8a4b0f]">Handed to the team because: </span>
            {brief.handoff}
          </Line>
        ) : null}
      </div>
    </details>
  );
}
