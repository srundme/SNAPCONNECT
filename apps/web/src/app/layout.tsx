import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Bundled with the app (SIL Open Font License, see ./fonts), so a build never depends on reaching Google Fonts.
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const display = localFont({
  src: [
    { path: "./fonts/cormorant-garamond-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/cormorant-garamond-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-cormorant",
  display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "The KariGhars", description: "Home interiors enquiries, from the first message to the team." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
