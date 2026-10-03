import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig, loadDotEnv } from "@snapsocial/config";
import { ollamaLlm } from "@snapsocial/integrations";

loadDotEnv(process.cwd());

const config = loadConfig();
const llm = ollamaLlm({ baseUrl: config.OLLAMA_BASE_URL, model: config.LLM_MODEL, maxOutputTokens: config.LLM_MAX_OUTPUT_TOKENS });
const health = await llm.health();
const report = {
  checkedAt: new Date().toISOString(),
  model: config.LLM_MODEL,
  contextTokens: config.LLM_CONTEXT_TOKENS,
  concurrency: config.LLM_CONCURRENCY,
  health,
  scenarios: [] as Array<{ name: string; ok: boolean; latencyMs: number; note: string }>,
  blocker: health.ok ? null : "Ollama is not reachable. Live model evaluation is pending. Fixture tests do not replace it.",
};
if (health.ok && health.gpu) report.blocker = "The running model reported GPU memory. The CPU profile requires a CPU-only process.";
if (health.ok && !health.gpu) {
  const started = Date.now();
  try {
    const result = await llm.generate({
      schemaName: "qualification",
      system: "You qualify interiors leads. Return only the JSON object. Do not invent prices.",
      messages: [{ id: "m1", role: "user", content: "Home interiors in Mysuru. Budget is 15 lakhs. Call +91 98450 12345." }],
    });
    report.scenarios.push({ name: "multi-field", ok: result.output.field_updates.length > 0, latencyMs: result.latencyMs, note: result.output.reply.slice(0, 180) });
  } catch (error) {
    report.blocker = error instanceof Error ? error.message : "Generation failed";
    report.scenarios.push({ name: "multi-field", ok: false, latencyMs: Date.now() - started, note: "Generation failed" });
  }
}
const destination = resolve(process.cwd(), "../../docs/evaluation-result.json");
await writeFile(destination, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
