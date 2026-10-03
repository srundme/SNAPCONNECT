import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptSecret(plaintext: string, key: Buffer, keyId: string): string {
  if (key.length !== 32) throw new Error("Credential key must be 32 bytes.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [keyId, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, keys: Record<string, Buffer>): string {
  const [keyId, ivText, tagText, dataText] = payload.split(".");
  if (!keyId || !ivText || !tagText || !dataText) throw new Error("Credential payload is malformed.");
  const key = keys[keyId];
  if (!key) throw new Error("Credential key id is not available.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}
