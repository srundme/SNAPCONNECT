import { describe, expect, it } from "vitest";
import { assertAllowedUrl } from "../src/hosts";
import { classifyFetch } from "../src/channel";
import { decryptSecret, encryptSecret } from "../src/crypto";
import { facebookAdapter, instagramAdapter } from "../src/meta";
import { assertPrivateOllamaUrl } from "../src/llm";
import { zohoAdapter } from "../src/zoho";

describe("integration guards", () => {
  it("encrypts credentials with an external key", () => {
    const key = Buffer.alloc(32, 7);
    const payload = encryptSecret("page-token", key, "local-1");
    expect(payload.includes("page-token")).toBe(false);
    expect(decryptSecret(payload, { "local-1": key })).toBe("page-token");
  });

  it("allows only a private Ollama address", () => {
    expect(assertPrivateOllamaUrl("http://127.0.0.1:11434").hostname).toBe("127.0.0.1");
    expect(assertPrivateOllamaUrl("http://ollama.railway.internal:8080").hostname).toBe("ollama.railway.internal");
    expect(() => assertPrivateOllamaUrl("https://ollama.com")).toThrow(/private/);
    expect(() => assertPrivateOllamaUrl("http://example.com:11434")).toThrow(/private/);
  });

  it("rejects unexpected hosts", () => {
    expect(() => assertAllowedUrl("https://evil.example/crm", "zoho-api")).toThrow(/not allowed/);
    expect(() => assertAllowedUrl("http://graph.facebook.com/v23.0", "meta")).toThrow(/HTTPS/);
    expect(assertAllowedUrl("https://www.zohoapis.in", "zoho-api").hostname).toBe("www.zohoapis.in");
  });

  it("marks a timeout as unknown instead of retryable success", async () => {
    const result = await classifyFetch(() => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    expect(result.status).toBe("UNKNOWN");
  });

  it("does not reuse an Instagram URL for Facebook", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ message_id: "m1", recipient_id: "psid" }), { status: 200 });
    };
    await facebookAdapter({ baseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl }).sendPrivateReply({
      accountId: "page",
      commentId: "c1",
      text: "Hello",
      token: "page-token",
    });
    await instagramAdapter({ baseUrl: "https://graph.instagram.com", version: "v23.0", fetchImpl }).sendText({
      accountId: "ig",
      recipientId: "igsid",
      text: "Hello",
      token: "ig-token",
    });
    expect(calls[0]).toContain("graph.facebook.com");
    expect(calls[1]).toContain("graph.instagram.com");
  });

  it("treats an error inside a Zoho HTTP success as failure", async () => {
    const result = await zohoAdapter(async () => new Response(JSON.stringify({ data: [{ status: "error", code: "INVALID_DATA" }] }), { status: 200 })).upsert({
      apiDomain: "https://www.zohoapis.com",
      token: "token",
      record: { Last_Name: "Prospect" },
      duplicateCheckFields: ["External_Lead_Key__c"],
      trigger: [],
    });
    expect(result.status).toBe("FAILED");
  });
});
