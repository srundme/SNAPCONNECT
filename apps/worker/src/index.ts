import { createServer } from "node:http";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig, loadDotEnv } from "@snapsocial/config";
import { connectionSender, getPrisma, processAvailableJobs, simulationRuntime } from "@snapsocial/db";
import { fixtureLlm, ollamaLlm, sarvamLlm, sarvamTranscriber } from "@snapsocial/integrations";

loadDotEnv(process.cwd());

const config = loadConfig();
if (config.LLM_MODE === "sarvam" && !config.SARVAM_API_KEY) {
  throw new Error("SARVAM_API_KEY is required when LLM_MODE is sarvam.");
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
  ...(config.SARVAM_API_KEY ? { transcribe: sarvamTranscriber({ apiKey: config.SARVAM_API_KEY }) } : {}),
  replySettleMs: 2500,
});

let stopping = false;
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
const queue = new Queue("snapsocial-outbox", { connection: redis });
const worker = new Worker("snapsocial-outbox", async (job) => {
  await processAvailableJobs(db, runtime, 10);
  return { outboxJobId: job.data.outboxJobId ?? null };
}, { connection: redis, concurrency: 1, lockDuration: 600_000 });

async function tick() {
  await db.workerHeartbeat.upsert({
    where: { id: "worker" },
    update: { seenAt: new Date(), detail: config.LLM_MODE },
    create: { id: "worker", seenAt: new Date(), detail: config.LLM_MODE },
  });
  await db.outboxJob.updateMany({
    where: { status: "DISPATCHED", updatedAt: { lt: new Date(Date.now() - 120_000) } },
    data: { status: "PENDING" },
  });
  try {
    if (redis.status === "wait") await redis.connect();
    const pending = await db.outboxJob.findMany({ where: { status: "PENDING" }, take: 20, select: { id: true } });
    for (const job of pending) {
      await queue.add("process", { outboxJobId: job.id }, { jobId: job.id, removeOnComplete: true });
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

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
