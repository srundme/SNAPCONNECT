import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export function loadDotEnv(start: string): void {
  const candidates = [resolve(start, ".env"), resolve(start, "../../.env"), resolve(start, "../../../.env")];
  for (const path of candidates) {
    let text = "";
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index);
      let value = trimmed.slice(index + 1);
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
    return;
  }
}

const optional = z.string().trim().optional().transform((value) => value || undefined);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  PRODUCT_NAME: z.string().min(1).default("SnapServe Social"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
  CREDENTIAL_ENCRYPTION_KEY_ID: z.string().min(1).default("local-1"),
  META_API_VERSION: z.string().default("v23.0"),
  META_INSTAGRAM_GRAPH_BASE_URL: z.url().default("https://graph.instagram.com"),
  META_FACEBOOK_GRAPH_BASE_URL: z.url().default("https://graph.facebook.com"),
  META_INSTAGRAM_OAUTH_BASE_URL: z.url().default("https://www.instagram.com"),
  META_FACEBOOK_OAUTH_BASE_URL: z.url().default("https://www.facebook.com"),
  META_INSTAGRAM_APP_ID: optional,
  META_INSTAGRAM_APP_SECRET: optional,
  META_INSTAGRAM_VERIFY_TOKEN: optional,
  META_FACEBOOK_APP_ID: optional,
  META_FACEBOOK_APP_SECRET: optional,
  META_FACEBOOK_VERIFY_TOKEN: optional,
  META_WHATSAPP_APP_SECRET: optional,
  META_WHATSAPP_VERIFY_TOKEN: optional,
  ZOHO_CLIENT_ID: optional,
  ZOHO_CLIENT_SECRET: optional,
  ZOHO_ACCOUNTS_URL: z.url().default("https://accounts.zoho.com"),
  ZOHO_SCOPES: z.string().default("ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.UPDATE"),
  OLLAMA_BASE_URL: z.url().default("http://127.0.0.1:11434"),
  SARVAM_API_KEY: optional,
  CARTESIA_API_KEY: optional,
  GOOGLE_PLACES_API_KEY: optional,
  BRAVE_SEARCH_API_KEY: optional,
  CARTESIA_VOICE_ID: optional,
  CARTESIA_MODEL: z.string().default("sonic-3.6"),
  LLM_MODEL: z.string().default("qwen3.5:2b"),
  LLM_CONTEXT_TOKENS: z.coerce.number().int().positive().default(4096),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(400),
  LLM_CONCURRENCY: z.coerce.number().int().positive().default(1),
  LLM_MODE: z.enum(["ollama", "fixture", "sarvam"]).default("fixture"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Kolkata"),
  DEFAULT_PHONE_REGION: z.string().default("IN"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  return parsed.data;
}

export function publicBranding(config: Pick<AppConfig, "PRODUCT_NAME">): { productName: string } {
  return { productName: config.PRODUCT_NAME };
}
