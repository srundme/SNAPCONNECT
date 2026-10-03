import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

try {
  const text = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index);
    let value = trimmed.slice(index + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // The process environment is already populated in production.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@snapsocial/domain", "@snapsocial/db", "@snapsocial/config", "@snapsocial/integrations"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg"],
  agentRules: false,
};

export default nextConfig;
