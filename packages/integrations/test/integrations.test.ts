import { describe, expect, it } from "vitest";
import { assertAllowedUrl } from "../src/hosts";
import { classifyFetch } from "../src/channel";
import { decryptSecret, encryptSecret } from "../src/crypto";
import { facebookAdapter, instagramAdapter } from "../src/meta";
import { listInstagramPosts } from "../src/meta-media";
import { assertPrivateOllamaUrl, sarvamLlm, sarvamTranscriber } from "../src/llm";
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
    expect(assertPrivateOllamaUrl("https://kpod-example-11434.blr-1.aipod.olakrutrimsvc.com").hostname).toBe("kpod-example-11434.blr-1.aipod.olakrutrimsvc.com");
    expect(() => assertPrivateOllamaUrl("http://kpod-example-11434.blr-1.aipod.olakrutrimsvc.com")).toThrow(/private/);
    expect(() => assertPrivateOllamaUrl("https://ollama.com")).toThrow(/private/);
    expect(() => assertPrivateOllamaUrl("http://example.com:11434")).toThrow(/private/);
  });

  it("calls the Sarvam conversation model without putting the key in the body", async () => {
    const calls: Array<{ url: string; headers: Headers; body: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ reply: "What is your name?", field_updates: [], handoff_requested: false, handoff_reason: null }) } }],
      }), { status: 200 });
    };
    const result = await sarvamLlm({ apiKey: "test-key", maxOutputTokens: 200, fetchImpl }).generate({
      schemaName: "qualification",
      system: "Ask the next question.",
      messages: [{ id: "m1", role: "user", content: "I want 𝗩𝗼𝗶𝗰𝗲 AI." }, { id: "m2", role: "user", content: " " }],
    });
    expect(result.model).toBe("sarvam-105b-conversations");
    expect(result.output.reply).toBe("What is your name?");
    expect(calls[0]?.url).toBe("https://api.sarvam.ai/v1/chat/completions");
    expect(calls[0]?.headers.get("api-subscription-key")).toBe("test-key");
    const body = JSON.parse(calls[0]?.body ?? "{}") as { model?: string; messages?: unknown[] };
    expect(body.model).toBe("sarvam-105b-conversations");
    expect(JSON.stringify(body)).not.toContain("test-key");
    expect(body.messages).toEqual([
      { role: "system", content: "Ask the next question." },
      { role: "user", content: "I want Voice AI." },
    ]);
  });

  it("keeps a Sarvam reply when the JSON stops early in blank padding", async () => {
    const content = `{\n  "reply": "Unga team la evlo per irukanga?",\n  "field_updates": [],\n  "handoff_requested": false\n${"  \n".repeat(300)}`;
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as typeof fetch;
    const result = await sarvamLlm({ apiKey: "test-key", maxOutputTokens: 200, fetchImpl }).generate({
      schemaName: "qualification",
      system: "Ask the next question.",
      messages: [{ id: "m1", role: "user", content: "AI calling pathi sollunga" }],
    });
    expect(result.output.reply).toBe("Unga team la evlo per irukanga?");
    expect(result.output.handoff_reason).toBeNull();
    const stalled = `{"reply":"Sari, unga company peru enna?","field_updates":[{"field":"company_name","value":"PENDING"${"\n    ".repeat(200)}`;
    const stalledFetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: stalled } }] }), { status: 200 })) as typeof fetch;
    const rescued = await sarvamLlm({ apiKey: "test-key", maxOutputTokens: 200, fetchImpl: stalledFetch }).generate({
      schemaName: "qualification",
      system: "Ask the next question.",
      messages: [{ id: "m1", role: "user", content: "Yes" }],
    });
    expect(rescued.output.reply).toBe("Sari, unga company peru enna?");
    expect(rescued.output.field_updates).toEqual([]);
  });

  it("retries a busy Sarvam and falls back to a plain reply when JSON keeps failing", async () => {
    let calls = 0;
    const busyThenOk = (async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "Unga peru enna?", field_updates: [], handoff_requested: false, handoff_reason: null }) } }] }), { status: 200 });
    }) as typeof fetch;
    const retried = await sarvamLlm({ apiKey: "test-key", maxOutputTokens: 200, fetchImpl: busyThenOk }).generate({ schemaName: "qualification", system: "Ask.", messages: [{ id: "m1", role: "user", content: "hi" }] });
    expect(retried.output.reply).toBe("Unga peru enna?");
    expect(calls).toBe(2);

    const bodies: Array<Record<string, unknown>> = [];
    const brokenJson = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      const content = body.response_format ? "not json at all" : "Sari, unga company peru enna?";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch;
    const plain = await sarvamLlm({ apiKey: "test-key", maxOutputTokens: 200, fetchImpl: brokenJson }).generate({ schemaName: "qualification", system: "Ask.", messages: [{ id: "m1", role: "user", content: "Yes" }] });
    expect(plain.output.reply).toBe("Sari, unga company peru enna?");
    expect(plain.diagnostics.mode).toBe("sarvam-plain");
    expect(bodies.filter((body) => body.response_format)).toHaveLength(3);
  }, 10_000);

  it("transcribes a Meta voice note with Sarvam in romanized text", async () => {
    const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body });
      if (String(url).startsWith("https://lookaside.fbsbx.com/")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
      }
      return new Response(JSON.stringify({ transcript: "enga team la 20 per irukanga" }), { status: 200 });
    }) as typeof fetch;
    const transcribe = sarvamTranscriber({ apiKey: "test-key", fetchImpl });
    expect(await transcribe("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1")).toBe("enga team la 20 per irukanga");
    expect(calls[1]?.url).toBe("https://api.sarvam.ai/speech-to-text");
    expect(calls[1]?.headers.get("api-subscription-key")).toBe("test-key");
    const form = calls[1]?.body as FormData;
    expect(form.get("model")).toBe("saaras:v4");
    expect(form.get("mode")).toBe("translit");
    expect((form.get("file") as File).type).toBe("audio/mp4");
    await expect(transcribe("https://evil.example/voice.mp4")).rejects.toThrow(/Meta media host/);
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

  it("lists Instagram posts without putting the token in the request path", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({
        data: [{ id: "post-1", caption: "Hello", media_product_type: "FEED", permalink: "https://www.instagram.com/p/abc/", timestamp: "2026-10-04T00:00:00+0000", media_url: "https://cdn.example/a.jpg" }],
      }), { status: 200 });
    };
    const posts = await listInstagramPosts({
      baseUrl: "https://graph.instagram.com",
      version: "v23.0",
      accountId: "1784",
      token: "secret-token",
      fetchImpl,
    });
    expect(posts[0]?.externalId).toBe("post-1");
    expect(posts[0]?.previewUrl).toBe("https://cdn.example/a.jpg");
    expect(calls[0]).not.toContain("secret-token");
  });

  it("refuses an Instagram paging link on a host outside Meta", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      data: [{ id: "post-1", caption: "Hello" }],
      paging: { next: "https://evil.example/next" },
    }), { status: 200 });
    await expect(listInstagramPosts({
      baseUrl: "https://graph.instagram.com",
      version: "v23.0",
      accountId: "1784",
      token: "token",
      fetchImpl,
    })).rejects.toThrow(/not allowed/);
  });
});
