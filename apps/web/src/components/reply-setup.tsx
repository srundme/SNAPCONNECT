"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { savePostSelection } from "@/lib/actions";

export type ReplyPost = {
  externalId: string;
  caption: string;
  kind: string;
  previewUrl: string | null;
  when: string | null;
  permalink: string | null;
  supported: boolean;
  enabled: boolean;
};

export function ReplySetup({
  connectionId,
  accountName,
  repliesOn,
  posts,
}: {
  connectionId: string;
  accountName: string;
  repliesOn: boolean;
  posts: ReplyPost[];
}) {
  const [selected, setSelected] = useState<string | null>(posts[0]?.externalId ?? null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(posts.map((post) => [post.externalId, post.enabled])));
  const current = posts.find((post) => post.externalId === selected) ?? null;
  const onCount = posts.filter((post) => post.supported && enabled[post.externalId]).length;

  return (
    <form action={savePostSelection} className="grid min-h-0 flex-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      <div className="hidden">
        <input type="hidden" name="connectionId" value={connectionId} />
        {posts.map((post) => (
          <span key={post.externalId}>
            {enabled[post.externalId] ? <input type="hidden" name="mediaId" value={post.externalId} /> : null}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 lg:col-span-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">Set up replies</h1>
          <p className="truncate text-sm text-[var(--color-muted)]">{accountName} · {onCount} of {posts.length} posts on</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={clsx("rounded-full px-2.5 py-1 text-[12px] font-semibold", repliesOn ? "bg-[#f4ead2] text-[#6e5420]" : "bg-[#fff6e8] text-[#92400e]")}>
            {repliesOn ? "On" : "Off"}
          </span>
          <button className="border-transparent bg-[var(--color-accent)] px-4 py-2 text-white hover:bg-[#745722]" type="submit" name="activate" value={repliesOn ? "0" : "1"}>
            {repliesOn ? "Save" : "Turn on"}
          </button>
        </div>
      </div>

      <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2.5">
          <p className="text-[13px] font-semibold">Posts</p>
          <button className="inline-flex items-center gap-1 px-2 py-1 text-[12px]" type="submit" form="reload-posts">
            <RefreshCw size={13} aria-hidden />
            Refresh
          </button>
        </div>
        {posts.length === 0 ? (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <p className="text-sm font-semibold">No posts yet</p>
              <p className="mt-1 text-[13px] text-[var(--color-muted)]">Load recent posts from this account.</p>
              <button className="mt-4 border-transparent bg-[var(--color-ink)] text-white" type="submit" form="reload-posts">Load posts</button>
            </div>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {posts.map((post) => {
              const active = post.externalId === selected;
              return (
                <li key={post.externalId} className={clsx("border-b border-[var(--color-line)] last:border-b-0", active && "bg-[#f3faf8]")}>
                  <div className="flex items-center gap-2.5 px-2.5 py-2">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left hover:bg-transparent" onClick={() => setSelected(post.externalId)}>
                      {post.previewUrl ? (
                        <img src={post.previewUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[var(--color-paper)] text-[10px] font-semibold text-[var(--color-muted)]">{post.kind}</span>
                      )}
                      <span className="min-w-0">
                        <span className="block text-[11px] font-semibold text-[var(--color-muted)]">{post.kind}{post.when ? ` · ${post.when}` : ""}</span>
                        <span className="mt-0.5 line-clamp-2 text-[13px] leading-4">{post.caption || "No caption"}</span>
                      </span>
                    </button>
                    {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="text-[var(--color-muted)]" aria-label="Open post"><ExternalLink size={14} /></a> : null}
                    <button
                      type="button"
                      aria-pressed={Boolean(enabled[post.externalId])}
                      disabled={!post.supported}
                      onClick={() => setEnabled((current) => ({ ...current, [post.externalId]: !current[post.externalId] }))}
                      className={clsx("h-6 w-11 shrink-0 rounded-full border-0 p-0.5", enabled[post.externalId] ? "bg-[var(--color-accent)] hover:bg-[var(--color-accent)]" : "bg-[#d5d9e0] hover:bg-[#d5d9e0]")}
                    >
                      <span className={clsx("block h-5 w-5 rounded-full bg-white transition-transform", enabled[post.externalId] && "translate-x-5")} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="min-h-0 overflow-y-auto rounded-2xl bg-white p-4">
        {current ? (
          <div className="grid gap-4">
            <p className="text-sm font-semibold leading-5">{current.caption || current.kind}</p>
            {current.previewUrl ? <img src={current.previewUrl} alt="" className="max-h-80 w-auto rounded-xl object-contain" /> : null}
            <p className="text-sm text-[var(--color-muted)]">
              When someone comments here, the assistant writes the first message itself from the comment, this post and the <Link href="/ai" className="font-semibold text-[var(--color-ink)] underline">Agent page</Link>, then carries on the chat with the same settings. Turn the post on or off in the list.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Select a post.</p>
        )}
      </div>
    </form>
  );
}
