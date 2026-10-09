"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

/** A table row that opens the lead; inner links (Zoho) keep their own behaviour. */
export function ClickableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className="cursor-pointer"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        if (event.metaKey || event.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
