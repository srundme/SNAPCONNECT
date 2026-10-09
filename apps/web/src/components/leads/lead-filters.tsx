"use client";

import { Search } from "lucide-react";

type Values = { rating?: string; channel?: string; status?: string; q?: string; test?: boolean };

/** GET form: every change updates the URL, so filters are shareable and survive refresh. */
export function LeadFilters({ values }: { values: Values }) {
  const submit = (event: { currentTarget: HTMLInputElement | HTMLSelectElement }) => event.currentTarget.form?.requestSubmit();
  return (
    <form method="get" action="/leads" className="mb-4 flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-[0_1px_0_rgba(20,23,28,0.06)] md:flex-row md:flex-wrap md:items-center">
      <label className="relative !flex min-w-0 flex-1 items-center md:min-w-[260px]">
        <span className="sr-only">Search leads</span>
        <Search size={15} className="pointer-events-none absolute left-3 text-[var(--color-muted)]" aria-hidden />
        <input type="search" name="q" defaultValue={values.q ?? ""} placeholder="Search name, phone or project" className="w-full !pl-9" />
      </label>
      <div className="grid grid-cols-3 gap-2 md:flex">
        <label>
          <span className="sr-only">Rating</span>
          <select name="rating" defaultValue={values.rating ?? ""} onChange={submit} className="w-full">
            <option value="">Any rating</option>
            <option value="HOT">Hot</option>
            <option value="UNRATED">Unrated</option>
            <option value="JUNK">Junk</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Channel</span>
          <select name="channel" defaultValue={values.channel ?? ""} onChange={submit} className="w-full">
            <option value="">All channels</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK">Facebook</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select name="status" defaultValue={values.status ?? ""} onChange={submit} className="w-full">
            <option value="">Any status</option>
            <option value="COLLECTING">Collecting details</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="IN_ZOHO">In Zoho</option>
            <option value="NOT_INTERESTED">Not interested</option>
          </select>
        </label>
      </div>
      <div className="flex items-center justify-between gap-3 md:ml-auto">
        <label className="!flex cursor-pointer items-center gap-2 !text-[13px] !font-medium text-[var(--color-muted)]">
          <input type="checkbox" name="test" value="1" defaultChecked={values.test} onChange={submit} className="accent-[var(--color-accent)]" />
          Show test leads
        </label>
        <button type="submit">Search</button>
      </div>
    </form>
  );
}
