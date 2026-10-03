import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMetaSignature(
  rawBody: string | Buffer,
  header: string | null | undefined,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const provided = header.startsWith("sha256=") ? header.slice("sha256=".length) : header;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function verifyAnyMetaSignature(
  rawBody: string | Buffer,
  header: string | null | undefined,
  secrets: string[],
): string | null {
  for (const secret of secrets) {
    if (verifyMetaSignature(rawBody, header, secret)) return secret;
  }
  return null;
}
