import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { productName } from "@/lib/auth";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: productName, description: "Shared inbox that turns Instagram and Facebook comments into leads." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
