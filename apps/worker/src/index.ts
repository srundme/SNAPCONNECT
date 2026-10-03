import { createServer } from "node:http";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig, loadDotEnv } from "@snapsocial/config";
import { getPrisma, processAvailableJobs, simulationRuntime } from "@snapsocial/db";
import { fixtureLlm, ollamaLlm } from "@snapsocial/integrations";

loadDotEnv(process.cwd());

const config = loadConfig();
const db = getPrisma();
const runtime = simulationRuntime({
  llm: config.LLM_MODE === "ollama"
    ? ollamaLlm({ baseUrl: config.OLLAMA_BASE_URL, model: config.LLM_MODEL, maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS })
    : fixtureLlm(),
});

let stopping = false;
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
const queue = new Queue("snapsocial-outbox", { connection: redis });
const worker = new Worker("snapsocial-outbox", async (job) => {
  await processAvailableJobs(db, runtime, 10);
  return { outboxJobId: job.data.outboxJobId ?? null };
}, { connection: redis, concurrency: 1 });

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
