import { percentOf } from "./ist";

export type FunnelStep = { label: string; value: number; note?: string };

/**
 * Every step is a count of the same conversations, so each share is "of the first step"
 * and can never pass 100%. Bars are drawn to the same scale as the first step.
 */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const base = steps[0]?.value ?? 0;
  return (
    <ol className="mt-5 space-y-4">
      {steps.map((step, index) => {
        const share = base ? Math.min(1, step.value / base) : 0;
        return (
          <li key={step.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="mr-2 inline-block w-4 text-[12px] tabular-nums text-[var(--color-muted)]">{index + 1}</span>
                <span className="font-medium">{step.label}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="text-[17px] font-semibold">{step.value.toLocaleString("en-IN")}</span>
                <span className="ml-2 inline-block w-10 text-right text-[12px] text-[var(--color-muted)]">{index === 0 ? (base ? "100%" : "–") : percentOf(step.value, base)}</span>
              </span>
            </div>
            <div className="mt-1.5 ml-6 h-2 rounded-full bg-[var(--color-paper)]">
              <div
                className="h-2 rounded-full bg-[var(--color-accent)]"
                style={{ width: `${share * 100}%`, minWidth: step.value ? 4 : 0, opacity: 1 - index * 0.12 }}
              />
            </div>
            {step.note ? <p className="mt-1 ml-6 text-[12px] text-[var(--color-muted)]">{step.note}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
