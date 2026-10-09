import { describe, expect, it } from "vitest";
import { assertAllowedUrl } from "../src/hosts";
import { classifyFetch } from "../src/channel";
import { decryptSecret, encryptSecret } from "../src/crypto";
import { facebookAdapter, instagramAdapter } from "../src/meta";
import { listInstagramPosts } from "../src/meta-media";
import { assertPrivateOllamaUrl, parseFloorPlan, readVoiceDirection, sarvamDocumentReader, sarvamLlm, sarvamTranscriber, sarvamVision } from "../src/llm";
import { unzipText } from "../src/zip";
import { deflateRawSync } from "node:zlib";

function zipOf(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe("documents", () => {
  it("reads the markdown pages out of a ZIP", () => {
    const files = unzipText(zipOf({ "page_2.md": "Kitchen 10x8", "page_1.md": "3 BHK plan", "meta.json": "{}" }), (name) => name.endsWith(".md"));
    expect([...files.keys()].sort()).toEqual(["page_1.md", "page_2.md"]);
    expect(files.get("page_1.md")).toBe("3 BHK plan");
  });

  it("uploads a Meta-hosted PDF to Sarvam, then polls and returns its text", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.startsWith("https://lookaside.fbsbx.com/")) return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "content-type": "application/pdf" } });
      if (url.endsWith("/job/digitise")) {
        const file = (init?.body as FormData).get("file") as File;
        expect(file.name).toBe("plan.pdf");
        expect((init?.body as FormData).get("output_format")).toBe("md");
        return Response.json({ job_id: "j1", status: "pending" }, { status: 201 });
      }
      if (url.endsWith("/job/j1/status")) return Response.json({ status: "completed" });
      if (url.endsWith("/job/j1/download-url")) return Response.json({ method: "GET", url: "https://blob.sarvam.test/out.zip" });
      if (url === "https://blob.sarvam.test/out.zip") return new Response(zipOf({ "out/page_1.md": "3 BHK floor plan" }));
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    const reader = sarvamDocumentReader({ apiKey: "k", fetchImpl });
    expect(await reader.start("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", "wa", "plan.pdf")).toBe("j1");
    expect(await reader.poll("j1")).toEqual({ state: "done", text: "3 BHK floor plan" });
    await expect(reader.start("https://evil.example/plan.pdf", undefined, "plan.pdf")).rejects.toThrow(/Meta media host/);
    expect(calls[1]).toBe("POST https://api.sarvam.ai/doc-ai/v1/job/digitise");
  });

  it("refuses Word files so the chat can ask for a PDF", async () => {
    const fetchImpl = (async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } })) as unknown as typeof fetch;
    const reader = sarvamDocumentReader({ apiKey: "k", fetchImpl });
    await expect(reader.start("https://lookaside.fbsbx.com/x", undefined, "plan.docx")).rejects.toThrow(/Unsupported document type/);
  });

  it("reads a floor plan in a second pass and estimates the area from the room sizes", async () => {
    const prompts: string[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://lookaside.fbsbx.com/")) return new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } });
      const text = JSON.parse(String(init?.body)).messages[0].content[0].text as string;
      prompts.push(text);
      const content = prompts.length === 1
        ? "A floor plan of a 4 BHK apartment."
        : '```json\n{"written": false, "bhk": 5, "bathrooms": 6, "balconies": 1, "rooms": [{"name": "Bedroom 1", "size": "11 x 13 ft"}, {"name": "Living (and) Dining", "size": "22 x 25 ft"}, {"name": "Kitchen", "size": "10 x 12"}, {"name": "Bathrooms (avg)", "size": "5 x 8 ft"}], "carpetSqft": null, "notes": "Open living core."}\n```';
      return Response.json({ choices: [{ message: { content } }] });
    }) as typeof fetch;
    const seen = await sarvamVision({ apiKey: "k", fetchImpl })("https://lookaside.fbsbx.com/x");
    expect(prompts[1]).toMatch(/top-left/);
    expect(seen).toBe("A floor plan, no sizes written, sizes estimated from the furniture drawn: 5 BHK, 6 bathrooms. Rooms: Bedroom 1 about 11 x 13 ft; Living and Dining about 22 x 25 ft; Kitchen about 10 x 12 ft; Bathrooms avg about 5 x 8 ft. Estimated carpet area about 1800 to 2050 sq ft, an estimate from the plan, not measured. Open living core.");
    expect(parseFloorPlan('{"written": true, "bhk": 3, "rooms": [], "carpetSqft": 1450}')?.carpet).toEqual({ low: 1450, high: 1450, written: true });
    expect(parseFloorPlan("no json here")).toBeNull();
  });
});
import { zohoAdapter } from "../src/zoho";
import { checkWhatsAppNumber, subscribeWhatsAppAccount, whatsappAdapter } from "../src/whatsapp";
import { cartesiaSpeaker, speechLocale, speechScript, speechSentences } from "../src/cartesia";
import { bestPlaceLookup, bravePlaceLookup, correctAreaSpelling, googlePlaceLookup, osmPlaceLookup } from "../src/places";

describe("project lookup", () => {
  const reply = (results: unknown[]) => (async () => new Response(JSON.stringify(results), { status: 200 })) as unknown as typeof fetch;

  it("finds a named project and its locality, and ignores plain localities or other names", async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify([{ name: "Godrej Splendour (u/c)", type: "construction", address: { suburb: "Belathur", postcode: "560067" } }]), { status: 200 });
    }) as unknown as typeof fetch;
    const place = await osmPlaceLookup({ userAgent: "test", fetcher })("my flat is in Godrej Splendour", "Bengaluru");
    expect(place).toEqual({ name: "Godrej Splendour", locality: "Belathur", city: null, pincode: "560067", underConstruction: true, source: "OpenStreetMap" });
    expect(decodeURIComponent(urls[0]!)).toContain("q=Godrej Splendour, Bengaluru");
    expect(await osmPlaceLookup({ userAgent: "test", fetcher: reply([{ name: "HSR Layout", type: "suburb" }]) })("HSR Layout")).toBeNull();
    expect(await osmPlaceLookup({ userAgent: "test", fetcher: reply([{ name: "Brigade Gateway", type: "residential" }]) })("Prestige Shantiniketan")).toBeNull();
  });

  it("confirms a project on Google Maps only when the name and the city really match", async () => {
    const parts = (locality: string, pincode: string) => [
      { longText: locality, types: ["sublocality_level_1", "sublocality", "political"] },
      { longText: "Bengaluru", types: ["locality", "political"] },
      { longText: pincode, types: ["postal_code"] },
    ];
    const google = (places: unknown[]) => {
      const bodies: string[] = [];
      const fetcher = (async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(JSON.stringify({ places }), { status: 200 });
      }) as unknown as typeof fetch;
      return { lookup: googlePlaceLookup({ apiKey: "test", fetcher }), bodies };
    };
    const lakeside = { displayName: { text: "Prestige Lakeside Habitat" }, formattedAddress: "Varthur Main Rd, Gunjur, Bengaluru, Karnataka 560087", types: ["apartment_complex", "point_of_interest"], addressComponents: parts("Gunjur", "560087") };
    const { lookup, bodies } = google([lakeside]);
    expect(await lookup("whitefield, prestige lakeside habitat", "Bengaluru")).toEqual({
      name: "Prestige Lakeside Habitat", locality: "Gunjur", city: "Bengaluru", pincode: "560087", underConstruction: false,
      kind: "apartment", address: "Varthur Main Rd, Gunjur, Bengaluru, Karnataka 560087", source: "Google Maps",
    });
    expect(JSON.parse(bodies[0]!).textQuery).toBe("whitefield, Bengaluru");
    const villas = { displayName: { text: "Adarsh Palm Retreat Villas" }, formattedAddress: "Bellandur, Bengaluru 560103", types: ["housing_complex"], addressComponents: parts("Bellandur", "560103") };
    expect((await google([villas]).lookup("Adarsh Palm Retreat, Bellandur", "Bengaluru")) as { kind: string }).toMatchObject({ kind: "villa" });
    const mixed = { displayName: { text: "Sobha City" }, formattedAddress: "Thanisandra, Bengaluru 560077", types: ["housing_complex"], addressComponents: parts("Thanisandra", "560077") };
    expect(await google([mixed]).lookup("sobha city hebbal", "Bengaluru")).toMatchObject({ name: "Sobha City", kind: null });
    const otherProject = { displayName: { text: "Brigade Woods" }, formattedAddress: "Whitefield, Bengaluru", types: ["apartment_complex"] };
    expect(await google([otherProject]).lookup("Brigade Utopia Varthur", "Bengaluru")).toEqual({ missing: "Brigade Utopia Varthur", source: "Google Maps" });
    const office = { displayName: { text: "Prestige Lakeside Habitat Sales Office" }, formattedAddress: "Bengaluru", types: ["real_estate_agency"] };
    expect(await google([office]).lookup("Prestige Lakeside Habitat", "Bengaluru")).toEqual({ missing: "Prestige Lakeside Habitat", source: "Google Maps" });
    const elsewhere = { ...lakeside, formattedAddress: "Hyderabad, Telangana" };
    expect(await google([elsewhere]).lookup("Prestige Lakeside Habitat", "Bengaluru")).toEqual({ missing: "Prestige Lakeside Habitat", source: "Google Maps" });
    const area = { displayName: { text: "HSR Layout" }, formattedAddress: "HSR Layout, Bengaluru", types: ["sublocality_level_1", "sublocality", "political"] };
    expect(await google([area]).lookup("HSR Layout", "Bengaluru")).toBeNull();
  });

  it("reads the home type from a web result that names the project", async () => {
    const hits = (results: unknown[]) => bravePlaceLookup({
      apiKey: "test",
      fetcher: (async () => new Response(JSON.stringify({ web: { results } }), { status: 200 })) as unknown as typeof fetch,
    });
    const casagrand = await hits([
      { title: "Casagrand Casablanca | Luxury Flats in Mallasandra, Kanakapura Road", description: "2, 3 and 4 BHK apartments and 5 BHK floor villas in Bengaluru. Ongoing project." },
      { title: "Some other Casagrand project", description: "Villas in Whitefield" },
    ])("Casagrande Casablanca", "Bengaluru");
    expect(casagrand).toMatchObject({ name: "Casagrand Casablanca", kind: "apartment", locality: "Kanakapura Road", city: "Bengaluru", underConstruction: true, bhkOptions: [2, 3, 4, 5], source: "Brave Search" });
    expect(await hits([{ title: "Prestige Lakeside Habitat", description: "Ready to move 3 BHK apartments on Sarjapur Road, Bengaluru 560087." }])("Prestige Lakeside Habitat", "Bengaluru")).toMatchObject({ bhkOptions: [3], underConstruction: false, readyToMove: true });
    expect(await hits([{ title: "Sobha Dream Acres", description: "Apartments in Bengaluru. Possession in 2027." }])("Sobha Dream Acres", "Bengaluru")).toMatchObject({ possessionYear: 2027, underConstruction: false });
    expect(await hits([{ title: "Brigade Cornerstone Utopia", description: "Ready to move and under construction apartments in Bengaluru." }])("Brigade Cornerstone Utopia", "Bengaluru")).toMatchObject({ underConstruction: false });
    expect(correctAreaSpelling("sri bakthi nivas in madipakka")).toBe("sri bakthi nivas in Madipakkam");
    expect(await hits([{ title: "Sobha City", description: "Apartments in Bengaluru, priced around 560087 per home." }])("Sobha City", "Bengaluru")).not.toHaveProperty("bhkOptions");
    expect(await hits([{ title: "Brigade Woods", description: "Apartments in Bengaluru" }])("Brigade Utopia", "Bengaluru")).toEqual({ missing: "Brigade Utopia", source: "Brave Search" });
    expect(await hits([])("HSR Layout", "Bengaluru")).toBeNull();
  });

  it("falls back to OpenStreetMap when Google finds nothing", async () => {
    const osmHit = async () => ({ name: "Godrej Splendour", locality: "Belathur", city: null, pincode: null, underConstruction: false, source: "OpenStreetMap" as const });
    expect(await bestPlaceLookup(async () => ({ missing: "Godrej Splendour", source: "Google Maps" }), osmHit)("Godrej Splendour")).toMatchObject({ source: "OpenStreetMap" });
    expect(await bestPlaceLookup(async () => ({ missing: "Xyz Heights", source: "Google Maps" }), async () => null)("Xyz Heights")).toEqual({ missing: "Xyz Heights", source: "Google Maps" });
    expect(await bestPlaceLookup(async () => { throw new Error("403"); }, async () => null)("Xyz Heights")).toBeNull();
  });
});

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
      .toBe("seven thousand sir? [laughter] i think you meant seventy.");
    expect(speechScript("lol ok sir", { emotions: [], speed: 1, opener: "" })).toBe("[laughter] ok sir.");
    expect(speechScript("Hahaa sir good one 😂", { emotions: [], speed: 1, opener: "" })).toBe("[laughter] sir good one [laughter]");
    expect(speechScript("haaa haa nice one sir, so which area?", { emotions: [], speed: 1, opener: "" })).toBe("[laughter] nice one sir, so which area?");
    expect(speechScript("Aha, got it sir", { emotions: [], speed: 1, opener: "" })).toBe("Aha, got it sir.");
    expect(speechScript("That is a big space. What is the budget?", { emotions: [], speed: 1, opener: "Oh," }))
      .toBe("Oh, that is a big space. What is the budget?");
    expect(speechScript("Super sir! Budget evlo?", { emotions: [], speed: 1, opener: "Ah," }))
      .toBe("Super sir! Budget evlo?");
    expect(speechScript("**Details** here: https://x.test/a\nThanks", { emotions: [], speed: 1, opener: "" }))
      .toBe("Details here: the link Thanks.");
  });

  it("says numbers, money and units as words and does not spell shouted words", () => {
    const say = (text: string) => speechScript(text, { emotions: [], speed: 1, opener: "" });
    expect(say("Budget is 3L")).toBe("Budget is three lakhs.");
    expect(say("under 20L, 20 to 30L, 30-50 lakhs or 50L+?")).toBe("under twenty lakhs, twenty to thirty lakhs, thirty to fifty lakhs or fifty lakhs plus?");
    expect(say("around 1.5 cr for the villa")).toBe("around one point five crores for the villa.");
    expect(say("a 3BHK of about 1,452 sq ft")).toBe("a three BHK of about one thousand four hundred fifty two square feet.");
    expect(say("kitchen is 10 x 8.6 ft")).toBe("kitchen is ten by eight point six feet.");
    expect(say("the team will call at 11:30 AM on the 2nd")).toBe("the team will call at eleven thirty AM on the second.");
    expect(say("possession in March 2027, design fee ₹25,000")).toBe("possession in March twenty twenty seven, design fee twenty five thousand rupees.");
    expect(say("NOTED sir, OK we do 3D designs for HSR flats")).toBe("noted sir, okay we do 3D designs for HSR flats.");
    expect(say("call me on 9845012345 for 1 lakh")).toBe("call me on <spell>98450 12345</spell> for one lakh.");
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
