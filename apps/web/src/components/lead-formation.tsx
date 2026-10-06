"use client";

import { useState } from "react";
import { Panel } from "@/components/ui";

const STANDARD: Array<[string, string]> = [
  ["", "Description"],
  ["Last_Name", "Last name"],
  ["First_Name", "First name"],
  ["Company", "Company"],
  ["Phone", "Phone"],
  ["Mobile", "Mobile"],
  ["Email", "Email"],
  ["Designation", "Title"],
  ["City", "City"],
  ["State", "State"],
  ["Country", "Country"],
  ["Website", "Website"],
  ["Industry", "Industry"],
  ["No_of_Employees", "No. of employees"],
  ["Annual_Revenue", "Annual revenue"],
];

const KNOWN = new Set(STANDARD.map(([value]) => value));
const FIELD_LABEL = new Map(STANDARD);

type Row = { label: string; zoho: string; custom: string; required: boolean };

function toRow(question: { label: string; zohoField: string | null; required: boolean }): Row {
  const field = question.zohoField ?? "";
  if (KNOWN.has(field)) return { label: question.label, zoho: field, custom: "", required: question.required };
  return { label: question.label, zoho: "__custom__", custom: field, required: question.required };
}

export type AgentFormSettings = {
  goal: string;
  pricingAnswer: string;
  workingHours: string;
  serviceArea: string;
  holidays: string;
  complaintContact: string;
  rules: string;
  realityChecks: string;
  designKnowledge: string;
  zohoCompanyFallback: string;
  hotBudgetLakhs: number;
  zohoRatingField: string;
  followUpHours: number[];
  toggles: Record<string, boolean>;
};

const BEHAVIOUR: Array<[string, string, string]> = [
  ["voiceReplies", "Voice replies", "Answers a voice note with a voice note."],
  ["photoReading", "Read photos and documents", "Understands photos, floor plans and PDFs customers send, and what each post shows."],
  ["laughter", "Laughter", "May write haha, and laughs in voice notes. Off means never."],
  ["emojis", "Emojis", "May use an emoji now and then. Off removes every emoji."],
  ["casualTexting", "Casual texting", "Types like a person: no commas, u and ok, dots between thoughts. Off writes clean, polite sentences."],
  ["splitMessages", "Split into messages", "Sends two short messages instead of one block."],
  ["typingDelay", "Human timing", "Waits to read and type like a person before replying."],
  ["addressSirMam", "Sir or mam", "Calls the customer sir or mam once in a while. Off uses their name."],
  ["expertAdvice", "Expert advice", "Advises like an experienced designer from the AI's own knowledge plus the design notes. Company facts, prices and promises still come only from the knowledge base."],
];

function Section({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <Panel>
      <div className="border-b border-[var(--color-line)] px-5 py-4">
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{detail}</p>
      </div>
      {children}
    </Panel>
  );
}

function Switch({ name, label, detail, defaultOn }: { name: string; label: string; detail: string; defaultOn: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-line)] px-3 py-2.5 font-normal">
      <input type="checkbox" name={name} defaultChecked={defaultOn} className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-[12px] leading-4 text-[var(--color-muted)]">{detail}</span>
      </span>
    </label>
  );
}

function fieldName(row: Row): string {
  if (!row.label.trim()) return "";
  if (row.zoho === "__custom__") return row.custom.trim() || "Custom field";
  return FIELD_LABEL.get(row.zoho) ?? "Description";
}

export function AgentForm({
  action,
  brandName,
  agentName,
  services,
  tone,
  persona,
  systemPrompt,
  agentPrompt,
  defaultPrompt,
  promptFacts,
  questions,
  externalKey,
  knowledgeBase,
  settings,
  maxQuestions,
}: {
  action: (formData: FormData) => void | Promise<void>;
  brandName: string;
  agentName: string;
  services: string;
  tone: string;
  persona: string;
  systemPrompt: string;
  agentPrompt: string;
  defaultPrompt: string;
  promptFacts: Array<[string, string]>;
  questions: Array<{ label: string; zohoField: string | null; required: boolean }>;
  externalKey: string;
  knowledgeBase: string;
  settings: AgentFormSettings;
  maxQuestions: number;
}) {
  const [rows, setRows] = useState<Row[]>(questions.length ? questions.map(toRow) : [{ label: "", zoho: "", custom: "", required: true }]);
  const [leadKey, setLeadKey] = useState(externalKey);
  const [knowledge, setKnowledge] = useState(knowledgeBase);
  const [promptOn, setPromptOn] = useState(Boolean(agentPrompt.trim()));
  const [prompt, setPrompt] = useState(agentPrompt.trim() || defaultPrompt);
  const filled = rows.filter((row) => row.label.trim());

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, item) => (item === index ? { ...row, ...patch } : row)));
  }

  return (
    <form className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]" action={action}>
      <div className="grid gap-4">
        <Section title="System prompt" detail="When this is on, the agent follows only this prompt. Code reads photos, voice and documents, fills the lead form, sends the lead to Zoho and sends the messages, and nothing else.">
          <div className="grid gap-3 p-5">
            <label className="flex cursor-pointer items-center gap-3 font-normal">
              <input type="checkbox" name="agentPromptOn" checked={promptOn} onChange={(event) => setPromptOn(event.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              <span className="text-sm font-semibold">Use this system prompt</span>
            </label>
            <label>
              Prompt
              <textarea name="agentPrompt" rows={28} maxLength={60000} value={prompt} onChange={(event) => setPrompt(event.target.value)} spellCheck={false} className="font-mono text-[13px]" />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--color-muted)]">
              <span>{prompt.length.toLocaleString("en-IN")} of 60,000 characters</span>
              <button type="button" className="border-[var(--color-line)] text-[12px]" onClick={() => setPrompt(defaultPrompt)}>Reset to the starting prompt</button>
            </div>
            <div className="text-[12px] leading-5 text-[var(--color-muted)]">
              <p className="font-semibold">Filled in for every reply. Write these where you want them; any you leave out are added at the end.</p>
              <ul className="mt-1 grid gap-x-4 sm:grid-cols-2">
                {promptFacts.map(([key, label]) => <li key={key}><code>{`{{${key}}}`}</code> {label}</li>)}
              </ul>
              {promptOn ? <p className="mt-2">Still used from below: the knowledge base, design knowledge, lead questions, Zoho settings, and the voice replies, photo reading, split messages, human timing and follow-up switches. The other fields only shape the starting prompt.</p> : null}
            </div>
          </div>
        </Section>
        <Panel>
          <div className="border-b border-[var(--color-line)] px-5 py-4">
            <h2 className="text-[17px] font-semibold tracking-tight">1. Who replies</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">The first message uses this name and says the assistant is automated.</p>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label>Brand<input name="brandName" defaultValue={brandName} /></label>
            <label>Agent name<input name="agentName" defaultValue={agentName} maxLength={40} placeholder="Varun" /></label>
            <label>Services<input name="services" defaultValue={services} maxLength={1000} /></label>
            <label>Tone<input name="tone" defaultValue={tone} /></label>
            <label className="sm:col-span-2">
              Persona
              <textarea name="agentPersona" rows={3} maxLength={2000} defaultValue={persona} placeholder="Varun from the sales team. A premium, calm, sharp sales consultant who knows homes and design." />
            </label>
          </div>
        </Panel>
        <Section title="2. Knowledge base" detail="The only facts the agent may use: services, process, prices it may share, contact details, links. Anything not here, it says the team will confirm.">
          <div className="grid gap-3 p-5">
            <label>
              Knowledge base
              <textarea name="knowledgeBase" rows={16} maxLength={60000} value={knowledge} onChange={(event) => setKnowledge(event.target.value)} placeholder="Paste the knowledge base here, or upload a .txt or .md file below." />
            </label>
            <p className="text-[12px] text-[var(--color-muted)]">{knowledge.length.toLocaleString("en-IN")} of 60,000 characters</p>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
              <label>
                Upload a file
                <input type="file" name="knowledgeFile" accept=".txt,.md,.markdown,.csv,text/plain,text/markdown" />
              </label>
              <label>
                The file
                <select name="knowledgeMode" defaultValue="replace">
                  <option value="replace">Replaces the text</option>
                  <option value="append">Adds to the end</option>
                </select>
              </label>
            </div>
            <label>
              Interior design knowledge
              <textarea name="designKnowledge" rows={10} maxLength={20000} defaultValue={settings.designKnowledge} placeholder="General design know-how the agent can advise with: materials, kitchen layouts, wardrobes, ceilings, lighting, styles, vastu basics. No prices or company promises here." />
            </label>
            <p className="text-[12px] text-[var(--color-muted)]">Used for design suggestions only. Company facts, prices and promises come from the knowledge base above.</p>
          </div>
        </Section>
        <Section title="3. How it sells" detail="Goal, price answer, hours and the rules it must always follow. One rule per line.">
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className="sm:col-span-2">
              Goal of the chat
              <textarea name="goal" rows={2} maxLength={600} defaultValue={settings.goal} placeholder="Understand their interior requirement and help them request a design consultation or callback." />
            </label>
            <label className="sm:col-span-2">
              When they ask the price
              <textarea name="pricingAnswer" rows={2} maxLength={600} defaultValue={settings.pricingAnswer} />
            </label>
            <label>Working hours<input name="workingHours" maxLength={200} defaultValue={settings.workingHours} placeholder="Tuesday to Sunday, 10 AM to 7 PM" /></label>
            <label>Complaints go to<input name="complaintContact" maxLength={300} defaultValue={settings.complaintContact} placeholder="+91 70227 25656 or support@company.com" /></label>
            <label className="sm:col-span-2">Service area<input name="serviceArea" maxLength={300} defaultValue={settings.serviceArea} placeholder="Bengaluru, Bangalore" /><span className="text-[12px] text-[var(--color-muted)]">City names, comma separated. A home in another city is flagged for the team instead of promised.</span></label>
            <label className="sm:col-span-2">
              Holidays
              <textarea name="holidays" rows={3} maxLength={2000} defaultValue={settings.holidays} placeholder={"2026-11-08 Deepavali\n11-01 Kannada Rajyotsava"} />
              <span className="text-[12px] text-[var(--color-muted)]">One per line: date (YYYY-MM-DD, or MM-DD for every year) and name. On these days the agent wishes them and says the team calls the next working day.</span>
            </label>
            <label className="sm:col-span-2">
              Rules
              <textarea name="rules" rows={8} maxLength={6000} defaultValue={settings.rules} placeholder={"Never promise a discount or EMI.\nNever confirm a visit slot."} />
            </label>
            <label className="sm:col-span-2">
              Common sense checks
              <textarea name="realityChecks" rows={4} maxLength={3000} defaultValue={settings.realityChecks} placeholder={"A full 3 BHK for under 5 lakh is not realistic, so check lightly and offer a team review."} />
            </label>
          </div>
        </Section>
        <Section title="4. Behaviour" detail="Switch off anything the agent should never do. It is enforced in the reply itself, not just asked for.">
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            {BEHAVIOUR.map(([key, label, detail]) => (
              <Switch key={key} name={`toggle:${key}`} label={label} detail={detail} defaultOn={settings.toggles[key] ?? true} />
            ))}
          </div>
        </Section>
        <Section title="5. Follow-ups" detail="If the customer goes quiet, the agent checks in. Meta allows this only within 24 hours of their last message, never at night, and it stops once staff take over or the lead reaches Zoho.">
          <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
            <Switch name="toggle:followUps" label="Send follow-ups" detail="Up to three short check-ins." defaultOn={settings.toggles.followUps ?? false} />
            <label>
              Hours after their last message
              <input name="followUpHours" defaultValue={settings.followUpHours.join(", ")} placeholder="3, 20" />
            </label>
          </div>
        </Section>
        <Section title="6. Extra notes" detail="Anything else for every chat. A post can add its own notes under Replies.">
          <div className="p-5">
            <label>
              Extra notes
              <textarea name="systemPrompt" rows={4} defaultValue={systemPrompt} placeholder="Current offers, seasonal notes, anything temporary." />
            </label>
          </div>
        </Section>
        <Panel>
          <div className="flex items-end justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">7. What it asks</h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Must-have details send the lead to Zoho once they are all in. Nice-to-have ones are asked only if the chat flows, and added to Zoho later.</p>
            </div>
            <button className="shrink-0 border-[var(--color-line)] text-sm" type="button" disabled={rows.length >= maxQuestions} onClick={() => setRows((current) => [...current, { label: "", zoho: "", custom: "", required: true }])}>
              Add question
            </button>
          </div>
          <div className="hidden grid-cols-[32px_minmax(0,1.4fr)_minmax(160px,0.8fr)_120px_72px] gap-3 px-5 py-2 text-[12px] font-semibold text-[var(--color-muted)] sm:grid">
            <span />
            <span>Question</span>
            <span>Zoho field</span>
            <span>Needed</span>
            <span />
          </div>
          <ol className="grid">
            {rows.map((row, index) => {
              const yesNo = /\bdemo\b|interested/i.test(row.label);
              return (
                <li key={index} className="grid gap-2 border-t border-[var(--color-line)] px-5 py-3 sm:grid-cols-[32px_minmax(0,1.4fr)_minmax(160px,0.8fr)_120px_72px] sm:items-center">
                  <span className="text-sm font-semibold text-[var(--color-muted)]">{index + 1}</span>
                  <input className="w-full min-w-0" name="questionLabel" aria-label={`Question ${index + 1}`} value={row.label} maxLength={180} placeholder="Person name" onChange={(event) => update(index, { label: event.target.value })} />
                  <div className="grid gap-2">
                    <select className="w-full min-w-0" name="questionZoho" aria-label={`Zoho field for question ${index + 1}`} value={row.zoho} onChange={(event) => update(index, { zoho: event.target.value })}>
                      {STANDARD.map(([value, label]) => <option key={value || "description"} value={value}>{label}</option>)}
                      <option value="__custom__">Custom API name</option>
                    </select>
                    {row.zoho === "__custom__" ? (
                      <input name="questionZohoCustom" aria-label={`API name for question ${index + 1}`} value={row.custom} spellCheck={false} placeholder="Team_Size" onChange={(event) => update(index, { custom: event.target.value })} />
                    ) : <input type="hidden" name="questionZohoCustom" value="" />}
                  </div>
                  <select className="w-full min-w-0" name="questionRequired" aria-label={`Is question ${index + 1} needed`} value={row.required ? "yes" : "no"} onChange={(event) => update(index, { required: event.target.value === "yes" })}>
                    <option value="yes">Must-have</option>
                    <option value="no">Nice to have</option>
                  </select>
                  <button className="h-10 border-transparent px-0 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]" type="button" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, item) => item !== index))}>
                    Remove
                  </button>
                  {yesNo ? <p className="text-[12px] text-[var(--color-muted)] sm:col-span-5">Yes sends the lead. No keeps it in the inbox.</p> : null}
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>
      <aside className="grid gap-4 xl:sticky xl:top-6">
        <Panel>
          <div className="grid gap-4 p-5">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">Zoho lead</h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Sent once every must-have answer is in. Later answers update the same lead.</p>
            </div>
            <ol className="grid gap-2 text-sm">
              <li className="flex gap-2"><span className="font-semibold text-[var(--color-accent-ink)]">1</span> Each answer fills the field beside it.</li>
              <li className="flex gap-2"><span className="font-semibold text-[var(--color-accent-ink)]">2</span> Description holds anything left unmapped.</li>
              <li className="flex gap-2"><span className="font-semibold text-[var(--color-accent-ink)]">3</span> A clear no stays out of Leads.</li>
            </ol>
            <dl className="grid gap-2 border-t border-[var(--color-line)] pt-4 text-sm">
              {filled.map((row) => (
                <div key={`${row.label}-${fieldName(row)}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <dt className="truncate text-[var(--color-muted)]">{row.label}</dt>
                  <dd className="font-medium">{fieldName(row)}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <dt className="text-[var(--color-muted)]">Channel</dt>
                <dd className="font-medium">Lead source</dd>
              </div>
            </dl>
            <label>
              Unique Zoho field
              <input name="externalKeyField" value={leadKey} spellCheck={false} placeholder="External_Lead_Key" onChange={(event) => setLeadKey(event.target.value)} />
            </label>
            <p className="text-[12px] leading-5 text-[var(--color-muted)]">API name for the SnapServe id. Yours is External_Lead_Key. Two underscores in a row are rejected.</p>
            <label>
              Company when none is asked
              <input name="zohoCompanyFallback" maxLength={80} defaultValue={settings.zohoCompanyFallback} placeholder="Residential" />
            </label>
            <p className="text-[12px] leading-5 text-[var(--color-muted)]">Zoho needs a Company on every lead. This fills it when no question maps to Company.</p>
            <label>
              Hot lead budget (lakhs)
              <input name="hotBudgetLakhs" type="number" min={0} step="0.5" defaultValue={settings.hotBudgetLakhs || ""} placeholder="30" />
            </label>
            <p className="text-[12px] leading-5 text-[var(--color-muted)]">At or above this budget a lead is HOT, below it JUNK. Without a budget the project size decides. Empty turns rating off.</p>
            <label>
              Zoho field for the rating
              <input name="zohoRatingField" maxLength={80} defaultValue={settings.zohoRatingField} spellCheck={false} placeholder="Lead_Rating" />
            </label>
            <p className="text-[12px] leading-5 text-[var(--color-muted)]">Optional API name of a text or picklist field with HOT and JUNK. The rating always goes in the Description too.</p>
          </div>
        </Panel>
        <button className="border-transparent bg-[var(--color-accent)] text-white hover:bg-[#0a655f]" type="submit">Save agent</button>
      </aside>
    </form>
  );
}
