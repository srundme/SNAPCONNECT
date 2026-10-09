import { ThumbsDown } from "lucide-react";
import { submitReplyFeedback } from "@/lib/actions";

/** Same list the server action accepts. */
export const FEEDBACK_REASONS = [
  "Wrong or made-up fact",
  "Didn't answer the question",
  "Repeated itself",
  "Off-topic or irrelevant",
  "Wrong tone or language",
  "Asked something already answered",
  "Other",
] as const;

/** A quiet thumbs-down under a Varun reply: tells the team what went wrong with it. */
export function ReplyFeedback({ messageId, current }: { messageId: string; current: { reason: string; note: string | null } | null }) {
  return (
    // Keyed by the saved reason so the form closes once the feedback is stored.
    <details key={current?.reason ?? "none"} className="group/fb w-full max-w-[85%] sm:max-w-[75%]">
      <summary
        className="ml-auto flex w-fit list-none items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] text-[var(--color-muted)] hover:bg-[#f4ead2]/60 hover:text-[var(--color-ink)] [&::-webkit-details-marker]:hidden"
        aria-label={current ? "Change feedback on this reply" : "Flag a problem with this reply"}
        title={current ? "Change feedback" : "Flag a problem with this reply"}
      >
        <ThumbsDown size={12} aria-hidden />
        <span className="hidden group-open/fb:inline">Cancel</span>
      </summary>
      <form action={submitReplyFeedback} className="mt-1 rounded-xl border border-[var(--color-line)] bg-white p-3 text-left shadow-[0_6px_18px_-12px_rgba(26,22,18,0.25)]">
        <input type="hidden" name="messageId" value={messageId} />
        <fieldset>
          <legend className="text-[12px] font-semibold text-[var(--color-ink)]">What was wrong with this reply?</legend>
          <div className="mt-1.5 grid gap-1">
            {FEEDBACK_REASONS.map((reason) => (
              <label key={reason} className="flex items-center gap-2 text-[12.5px] font-normal leading-5 text-[#3d362e]">
                <input type="radio" name="reason" value={reason} required defaultChecked={current?.reason === reason} />
                {reason}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-2 text-[12px] font-medium text-[var(--color-muted)]">
          Note (optional)
          <textarea name="note" rows={2} maxLength={300} defaultValue={current?.note ?? ""} placeholder="What should Varun have said?" className="text-[13px]" />
        </label>
        <div className="mt-2 flex justify-end">
          <button type="submit" className="px-2.5 py-1.5 text-[12.5px] text-white">Submit</button>
        </div>
      </form>
    </details>
  );
}
