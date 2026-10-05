import { describe, expect, it } from "vitest";
import { assertAllowedUrl } from "../src/hosts";
import { classifyFetch } from "../src/channel";
import { decryptSecret, encryptSecret } from "../src/crypto";
import { facebookAdapter, instagramAdapter } from "../src/meta";
import { listInstagramPosts } from "../src/meta-media";
import { assertPrivateOllamaUrl, readVoiceDirection, sarvamLlm, sarvamTranscriber } from "../src/llm";
import { zohoAdapter } from "../src/zoho";
import { checkWhatsAppNumber, subscribeWhatsAppAccount, whatsappAdapter } from "../src/whatsapp";
import { cartesiaSpeaker, speechLocale, speechScript, speechSentences } from "../src/cartesia";

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

describe("whatsapp", () => {
  it("sends a text reply through the Cloud API and reads the message id", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: "919845012345" }], messages: [{ id: "wamid.out" }] }), { status: 200 });
    };
    const result = await whatsappAdapter({ baseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl }).sendText({
      accountId: "pnid-1",
      recipientId: "919845012345",
      text: "Hi, I'm Maya",
      token: "wa-token",
    });
    expect(result).toMatchObject({ status: "ACCEPTED", providerMessageId: "wamid.out", providerRecipientId: "919845012345" });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/pnid-1/messages");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer wa-token");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "919845012345",
      type: "text",
      text: { body: "Hi, I'm Maya", preview_url: false },
    });
  });

  it("checks the number and subscribes the business account", async () => {
    const fetchImpl = async (url: string) => new Response(JSON.stringify(
      url.includes("subscribed_apps") ? { success: true } : { display_phone_number: "+91 90000 11111", verified_name: "SnapServe" },
    ), { status: 200 });
    await expect(checkWhatsAppNumber({ phoneNumberId: "pnid-1", token: "t", graphBaseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl }))
      .resolves.toEqual({ displayPhoneNumber: "+91 90000 11111", verifiedName: "SnapServe" });
    await expect(subscribeWhatsAppAccount({ businessAccountId: "waba-1", token: "t", graphBaseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl }))
      .resolves.toEqual(["messages"]);
    const denied = async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token." } }), { status: 401 });
    await expect(checkWhatsAppNumber({ phoneNumberId: "pnid-1", token: "bad", graphBaseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl: denied }))
      .rejects.toThrow(/Invalid OAuth access token/);
  });
});

describe("voice replies", () => {
  it("picks the spoken locale from the reply script and the chat language", () => {
    expect(speechLocale("Sure, what is your budget?")).toEqual({ locale: "en-IN" });
    expect(speechLocale("Budget evlo sir?", "Tanglish, which is Tamil typed in English letters")).toEqual({ locale: "ta-IN", normalization: "en-IN" });
    expect(speechLocale("Budget kitna hai?", "Hinglish, which is Hindi typed in English letters")).toEqual({ locale: "hi-IN", normalization: "en-IN" });
    expect(speechLocale("உங்கள் பட்ஜெட் என்ன?")).toEqual({ locale: "ta-IN" });
    expect(speechLocale("आपका बजट क्या है?")).toEqual({ locale: "hi-IN" });
    expect(speechLocale("ميزانيتك؟")).toBeNull();
  });

  it("writes the spoken script with openers and spelled phone numbers", () => {
    expect(speechScript("Got it 😄 we will call you on +919845012345", { emotions: [], speed: 1, opener: "" }))
      .toBe("Got it we will call you on <spell>98450 12345</spell>.");
    expect(speechScript("[laughter] Good one! So is it for your home?", { emotions: [], speed: 1.1, opener: "" }))
      .toBe("Good one! So is it for your home?");
    expect(speechScript("Haha sir, good one. So is it for your home?", { emotions: [], speed: 1, opener: "Oh," }))
      .toBe("[laughter] sir, good one. So is it for your home?");
    expect(speechScript("7000 sir? ha ha ha i think you meant 70", { emotions: [], speed: 1, opener: "" }))
      .toBe("7000 sir? [laughter] i think you meant 70.");
    expect(speechScript("lol ok sir", { emotions: [], speed: 1, opener: "" })).toBe("[laughter] ok sir.");
    expect(speechScript("That is a big space. What is the budget?", { emotions: [], speed: 1, opener: "Oh," }))
      .toBe("Oh, that is a big space. What is the budget?");
    expect(speechScript("Super sir! Budget evlo?", { emotions: [], speed: 1, opener: "Ah," }))
      .toBe("Super sir! Budget evlo?");
    expect(speechScript("**Details** here: https://x.test/a\nThanks", { emotions: [], speed: 1, opener: "" }))
      .toBe("Details here: the link Thanks.");
  });

  it("tags each sentence's emotion inline, only where it changes and only in English", () => {
    const reply = "Sorry for the slow reply. The demo is free! It takes ten minutes. What time suits you?";
    expect(speechSentences(reply)).toHaveLength(4);
    const direction = { emotions: ["apologetic", "happy", "happy", "curious"] as const, speed: 1, opener: "" as const };
    expect(speechScript(reply, { ...direction, emotions: [...direction.emotions] }, { emotionTags: true })).toBe(
      '<emotion value="apologetic"/> Sorry for the slow reply. <emotion value="happy"/> The demo is free! It takes ten minutes. <emotion value="curious"/> What time suits you?',
    );
    expect(speechScript(reply, { ...direction, emotions: [...direction.emotions] }, { emotionTags: false })).toBe(reply);
    expect(speechScript("<emotion value=\"angry\"/> Hi there", { emotions: ["calm"], speed: 1, opener: "" }, { emotionTags: true }))
      .toBe('<emotion value="calm"/> Hi there.');
  });

  it("reads a voice direction safely", () => {
    expect(readVoiceDirection({ emotions: ["Happy", "furious"], speed: 3, opener: "oh," }, 3)).toEqual({ emotions: ["happy", "content", "content"], speed: 1.15, opener: "Oh," });
    expect(readVoiceDirection({ emotion: "apologetic", opener: "Yo" }, 2)).toEqual({ emotions: ["apologetic", "apologetic"], speed: 1, opener: "" });
    expect(readVoiceDirection({}, 1)).toEqual({ emotions: ["content"], speed: 1, opener: "" });
  });

  it("asks Cartesia for speech with locale and speed, with emotion only inline", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(new Uint8Array(400), { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const speak = cartesiaSpeaker({ apiKey: "sk_test", voiceId: "voice-1", fetchImpl });
    const speech = await speak({ transcript: '<emotion value="happy"/> Hello.', locale: "en-IN", speed: 1.1, format: "mp3" });
    expect(speech.mimeType).toBe("audio/mpeg");
    expect(speech.audio.byteLength).toBe(400);
    expect(calls[0]!.url).toBe("https://api.cartesia.ai/tts/bytes");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer sk_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      transcript: '<emotion value="happy"/> Hello.',
      voice: { id: "voice-1" },
      locale: "en-IN",
      output_format: { container: "mp3" },
      generation_config: { speed: 1.1 },
    });
    await speak({ transcript: "Budget evlo?", locale: "ta-IN", normalization: "en-IN", format: "wav" });
    const tamil = JSON.parse(String(calls[1]!.init.body)) as Record<string, unknown>;
    expect(tamil).toMatchObject({ locale: "ta-IN", normalization: "en-IN", output_format: { container: "wav" } });
    expect(tamil.generation_config).toBeUndefined();
    const failing = async () => new Response("bad voice", { status: 400 });
    await expect(cartesiaSpeaker({ apiKey: "k", voiceId: "v", fetchImpl: failing })({ transcript: "Hi.", locale: "en-IN", format: "wav" })).rejects.toThrow(/HTTP 400/);
  });

  it("sends audio attachments on every channel", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ message_id: "m1", recipient_id: "r1" }), { status: 200 });
    };
    const input = { accountId: "acct", recipientId: "r1", audioUrl: "https://app.test/api/voice/abc.mp3", token: "t" };
    await instagramAdapter({ baseUrl: "https://graph.instagram.com", version: "v23.0", fetchImpl }).sendAudio(input);
    await facebookAdapter({ baseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl }).sendAudio(input);
    await whatsappAdapter({ baseUrl: "https://graph.facebook.com", version: "v23.0", fetchImpl }).sendAudio(input);
    expect(bodies[0]).toEqual({ recipient: { id: "r1" }, message: { attachment: { type: "audio", payload: { url: input.audioUrl } } } });
    expect(bodies[1]).toMatchObject({ message: { attachment: { type: "audio", payload: { url: input.audioUrl } } }, messaging_type: "RESPONSE" });
    expect(bodies[2]).toMatchObject({ messaging_product: "whatsapp", to: "r1", type: "audio", audio: { link: input.audioUrl } });
  });
});
