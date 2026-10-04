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

type Row = { label: string; zoho: string; custom: string };

function toRow(question: { label: string; zohoField: string | null }): Row {
  const field = question.zohoField ?? "";
  if (KNOWN.has(field)) return { label: question.label, zoho: field, custom: "" };
  return { label: question.label, zoho: "__custom__", custom: field };
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
  questions,
  externalKey,
}: {
  action: (formData: FormData) => void | Promise<void>;
  brandName: string;
  agentName: string;
  services: string;
  tone: string;
  persona: string;
  systemPrompt: string;
  questions: Array<{ label: string; zohoField: string | null }>;
  externalKey: string;
}) {
  const [rows, setRows] = useState<Row[]>(questions.length ? questions.map(toRow) : [{ label: "", zoho: "", custom: "" }]);
  const [leadKey, setLeadKey] = useState(externalKey);
  const filled = rows.filter((row) => row.label.trim());

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, item) => (item === index ? { ...row, ...patch } : row)));
  }

  return (
    <form className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]" action={action}>
      <div className="grid gap-4">
        <Panel>
          <div className="border-b border-[var(--color-line)] px-5 py-4">
            <h2 className="text-[17px] font-semibold tracking-tight">1. Who replies</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">The first message uses this name and says the assistant is automated.</p>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label>Brand<input name="brandName" defaultValue={brandName} /></label>
            <label>Agent name<input name="agentName" defaultValue={agentName} maxLength={40} placeholder="Maya" /></label>
            <label>Services<input name="services" defaultValue={services} /></label>
            <label>Tone<input name="tone" defaultValue={tone} /></label>
            <label className="sm:col-span-2">
              Persona
              <textarea name="agentPersona" rows={2} defaultValue={persona} placeholder="Warm and brief. Speaks as an automated assistant, never as a staff member." />
            </label>
          </div>
        </Panel>
        <Panel>
          <div className="border-b border-[var(--color-line)] px-5 py-4">
            <h2 className="text-[17px] font-semibold tracking-tight">2. What it knows</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">One prompt for every chat. A post can add its own notes under Replies.</p>
          </div>
          <div className="p-5">
            <label>
              System prompt
              <textarea name="systemPrompt" rows={6} defaultValue={systemPrompt} placeholder="Services, who you help, and how to answer when someone asks about any post." />
            </label>
          </div>
        </Panel>
        <Panel>
          <div className="flex items-end justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">3. What it asks</h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Asked one at a time, in this order. Map each answer to a Zoho Lead field.</p>
            </div>
            <button className="shrink-0 border-[var(--color-line)] text-sm" type="button" disabled={rows.length >= 8} onClick={() => setRows((current) => [...current, { label: "", zoho: "", custom: "" }])}>
              Add question
            </button>
          </div>
          <div className="hidden grid-cols-[32px_minmax(0,1.4fr)_minmax(160px,0.8fr)_72px] gap-3 px-5 py-2 text-[12px] font-semibold text-[var(--color-muted)] sm:grid">
            <span />
            <span>Question</span>
            <span>Zoho field</span>
            <span />
          </div>
          <ol className="grid">
            {rows.map((row, index) => {
              const yesNo = /\bdemo\b|interested/i.test(row.label);
              return (
                <li key={index} className="grid gap-2 border-t border-[var(--color-line)] px-5 py-3 sm:grid-cols-[32px_minmax(0,1.4fr)_minmax(160px,0.8fr)_72px] sm:items-center">
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
                  <button className="h-10 border-transparent px-0 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]" type="button" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, item) => item !== index))}>
                    Remove
                  </button>
                  {yesNo ? <p className="text-[12px] text-[var(--color-muted)] sm:col-span-4">Yes sends the lead. No keeps it in the inbox.</p> : null}
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
              <p className="mt-1 text-sm text-[var(--color-muted)]">Sent only after every answer is in, and the demo answer is yes.</p>
            </div>
            <ol className="grid gap-2 text-sm">
              <li className="flex gap-2"><span className="font-semibold text-[var(--color-accent-ink)]">1</span> Each answer fills the field beside it.</li>
              <li className="flex gap-2"><span className="font-semibold text-[var(--color-accent-ink)]">2</span> Description holds anything left unmapped.</li>
              <li className="flex gap-2"><span className="font-semibold text-[var(--color-accent-ink)]">3</span> A no on the demo stays out of Leads.</li>
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
          </div>
        </Panel>
        <button className="border-transparent bg-[var(--color-accent)] text-white hover:bg-[#0a655f]" type="submit">Save agent</button>
      </aside>
    </form>
  );
}
