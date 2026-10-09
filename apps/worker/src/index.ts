import { createServer } from "node:http";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig, loadDotEnv } from "@snapsocial/config";
import { connectionSender, getPrisma, processAvailableJobs, recoverStaleJobs, sendDailySummaries, simulationRuntime } from "@snapsocial/db";
import { bravePlaceLookup, cartesiaSpeaker, fixtureLlm, ollamaLlm, sarvamDocumentReader, sarvamLlm, sarvamTranscriber, sarvamVision, whatsappMediaUrl } from "@snapsocial/integrations";

loadDotEnv(process.cwd());

const config = loadConfig();
if (config.LLM_MODE === "sarvam" && !config.SARVAM_API_KEY) {
  throw new Error("SARVAM_API_KEY is required when LLM_MODE is sarvam.");
}
if (config.LLM_MODE === "fixture") {
  console.warn("LLM_MODE is fixture: replies are empty test output, not a real model. Set LLM_MODE=sarvam for live chats.");
}
const db = getPrisma();
const credentialKey = Buffer.from(config.CREDENTIAL_ENCRYPTION_KEY, "base64");
const runtime = simulationRuntime({
  llm: config.LLM_MODE === "sarvam"
    ? sarvamLlm({
        apiKey: config.SARVAM_API_KEY ?? "",
        maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS,
      })
    : config.LLM_MODE === "ollama"
      ? ollamaLlm({ baseUrl: config.OLLAMA_BASE_URL, model: config.LLM_MODEL, maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS })
      : fixtureLlm(),
  send: connectionSender({
    keys: { [config.CREDENTIAL_ENCRYPTION_KEY_ID]: credentialKey },
    instagramGraphBaseUrl: config.META_INSTAGRAM_GRAPH_BASE_URL,
    facebookGraphBaseUrl: config.META_FACEBOOK_GRAPH_BASE_URL,
    version: config.META_API_VERSION,
  }),
  credentialKeys: { [config.CREDENTIAL_ENCRYPTION_KEY_ID]: credentialKey },
  zohoClientId: config.ZOHO_CLIENT_ID ?? null,
  zohoClientSecret: config.ZOHO_CLIENT_SECRET ?? null,
  zohoAccountsUrl: config.ZOHO_ACCOUNTS_URL,
  ...(config.SARVAM_API_KEY
    ? {
        transcribe: sarvamTranscriber({ apiKey: config.SARVAM_API_KEY }),
        seeImage: sarvamVision({ apiKey: config.SARVAM_API_KEY }),
        readDocument: sarvamDocumentReader({ apiKey: config.SARVAM_API_KEY }),
      }
    : {}),
  whatsappMediaUrl: (mediaId, token) => whatsappMediaUrl({ mediaId, token, graphBaseUrl: config.META_FACEBOOK_GRAPH_BASE_URL, version: config.META_API_VERSION }),
  ...(config.CARTESIA_API_KEY && config.CARTESIA_VOICE_ID
    ? {
        speak: cartesiaSpeaker({ apiKey: config.CARTESIA_API_KEY, voiceId: config.CARTESIA_VOICE_ID, model: config.CARTESIA_MODEL }),
      }
    : {}),
  // Voice clip links and the "open chat" link in team alerts.
  publicBaseUrl: config.APP_BASE_URL,
  replySettleMs: 2500,
  lookupPlace: config.BRAVE_SEARCH_API_KEY
    ? bravePlaceLookup({ apiKey: config.BRAVE_SEARCH_API_KEY })
    : async () => null,
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

let stopping = false;
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
const queue = new Queue("snapsocial-outbox", { connection: redis });
const worker = new Worker("snapsocial-outbox", async (job) => {
  await processAvailableJobs(db, runtime, 10);
  return { outboxJobId: job.data.outboxJobId ?? null };
}, { connection: redis, concurrency: 1, lockDuration: 600_000 });

let ticking = false;

// One tick at a time, and a failed database call is logged instead of crashing the worker.
async function tick() {
  if (ticking || stopping) return;
  ticking = true;
  try {
    await work();
  } catch (error) {
    console.error("Worker tick failed:", error);
  } finally {
    ticking = false;
  }
}

let summaryCheckedAt = 0;

async function work() {
  // The owners' 9 AM summary: checked once a minute, sent once a day.
  if (Date.now() - summaryCheckedAt > 60_000) {
    summaryCheckedAt = Date.now();
    await sendDailySummaries(db, runtime).catch((error: unknown) => console.error("Daily summary failed:", error));
  }
  await db.workerHeartbeat.upsert({
    where: { id: "worker" },
    update: { seenAt: new Date(), detail: config.LLM_MODE },
    create: { id: "worker", seenAt: new Date(), detail: config.LLM_MODE },
  });
  await db.outboxJob.updateMany({
    where: { status: "DISPATCHED", updatedAt: { lt: new Date(Date.now() - 120_000) } },
    data: { status: "PENDING" },
  });
  await recoverStaleJobs(db, new Date());
  try {
    if (redis.status === "wait") await redis.connect();
    const pending = await db.outboxJob.findMany({ where: { status: "PENDING", availableAt: { lte: new Date() } }, take: 20, select: { id: true } });
    for (const job of pending) {
      await queue.add("process", { outboxJobId: job.id }, { jobId: job.id, removeOnComplete: true, removeOnFail: true });
      await db.outboxJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "DISPATCHED" } });
    }
  } catch {
    await processAvailableJobs(db, runtime, 20);
  }
}

if (process.env.PORT) {
  createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  }).listen(Number(process.env.PORT));
}

const timer = setInterval(() => { void tick(); }, 2000);
void tick();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await worker.close();
  await queue.close();
  redis.disconnect();
  await db.$disconnect();
  process.exit(0);
}

worker.on("error", (error) => console.error("Queue worker error:", error));
process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error));
process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
