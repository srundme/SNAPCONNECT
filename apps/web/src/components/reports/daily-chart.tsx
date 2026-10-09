import { IST_ZONE, istMidnight } from "./ist";

export type DayRow = { day: string; chats: number; zoho: number };

const CHAT_FILL = "#e8dcc2";

function niceTop(value: number): number {
  if (value <= 4) return Math.max(1, value);
  const step = value <= 10 ? 2 : value <= 50 ? 5 : value <= 100 ? 10 : 50;
  return Math.ceil(value / step) * step;
}

function weekday(day: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST_ZONE, weekday: "short" }).format(istMidnight(day));
}

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST_ZONE, day: "numeric", month: "short" }).format(istMidnight(day));
}

/**
 * Conversations started per India day, with leads sent to Zoho that day drawn
 * in front in the brand gold. Both use the same scale, shown on the left.
 */
export function DailyChart({ rows, today }: { rows: DayRow[]; today: string }) {
  const top = niceTop(Math.max(0, ...rows.flatMap((row) => [row.chats, row.zoho])));
  const totalChats = rows.reduce((sum, row) => sum + row.chats, 0);
  const totalZoho = rows.reduce((sum, row) => sum + row.zoho, 0);
  const dense = rows.length > 10;
  const labelEvery = dense ? 5 : 1;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-[var(--color-muted)]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHAT_FILL }} />Conversations started <b className="font-semibold text-[var(--color-ink)] tabular-nums">{totalChats}</b></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-accent)]" />Sent to Zoho <b className="font-semibold text-[var(--color-ink)] tabular-nums">{totalZoho}</b></span>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="flex h-44 w-6 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-[var(--color-muted)]">
          <span className="-mt-1.5">{top}</span>
          <span>{top >= 2 ? Math.round(top / 2) : ""}</span>
          <span className="-mb-1.5">0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-44 border-b border-[var(--color-line)]"
            role="img"
            aria-label={`${totalChats} conversations and ${totalZoho} Zoho leads over ${rows.length} days`}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-[var(--color-line)]" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-[var(--color-line)]" />
            <div className={dense ? "absolute inset-0 flex items-end gap-[2px] sm:gap-1" : "absolute inset-0 flex items-end gap-2 sm:gap-3"}>
              {rows.map((row) => (
                <div
                  key={row.day}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                  title={`${dayLabel(row.day)}: ${row.chats} conversation${row.chats === 1 ? "" : "s"}, ${row.zoho} sent to Zoho`}
                >
                  <div
                    className="w-full rounded-t-[3px]"
                    style={{ height: `${(row.chats / top) * 100}%`, background: CHAT_FILL, outline: row.day === today ? "1px solid var(--color-accent)" : undefined }}
                  />
                  {row.zoho ? (
                    <div className="absolute bottom-0 w-1/2 rounded-t-[2px] bg-[var(--color-accent)]" style={{ height: `${(row.zoho / top) * 100}%` }} />
                  ) : null}
                  {!dense && row.chats ? (
                    <span className="absolute left-0 right-0 text-center text-[10px] font-semibold tabular-nums text-[var(--color-ink)]" style={{ bottom: `calc(${(row.chats / top) * 100}% + 2px)` }}>{row.chats}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className={dense ? "mt-1.5 flex gap-[2px] sm:gap-1" : "mt-1.5 flex gap-2 sm:gap-3"}>
            {rows.map((row, index) => {
              const show = !dense || row.day === today || (rows.length - 1 - index) % labelEvery === 0;
              return (
                <span key={row.day} className={`min-w-0 flex-1 text-center text-[10px] leading-3 ${row.day === today ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-muted)]"}`}>
                  {show ? (dense ? row.day.slice(8).replace(/^0/, "") : <>{row.day === today ? "Today" : weekday(row.day)}<br />{row.day.slice(8).replace(/^0/, "")}</>) : ""}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
