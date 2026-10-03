# Model evaluation

Candidate: Qwen3.5-2B through Ollama, Apache 2.0, quantized, about 4096 context tokens, non-thinking mode, capped output. Qwen3.5-4B is the alternate (`LLM_MODEL`) if qualification quality needs it. Neither is a latency or throughput promise.

The inference service listens on localhost only. CPU enforcement means the container has no GPU device. Instagram and Facebook share one lease. `LLM_CONCURRENCY=1` means a second turn waits.

## Current result

`docs/evaluation-result.json` from 3 October 2026:

- Model requested: `qwen3.5:2b`
- Health: Ollama is not reachable
- Scenarios: none run
- Blocker: fixture tests do not replace a live model

Install Ollama, pull the model, set `LLM_MODE=ollama`, and run:

```bash
pnpm evaluate:llm
```

Review extraction of several fields in one message, lakhs and ranges, a changed city, two different phone numbers, refusal, opt-out, a request for a person, and an instruction that tries to override the assistant. Enable another language only after that language has its own review.

The inbox simulation on 3 October 2026 used `LLM_MODE=fixture`. It extracted Mysuru, residential, 15 lakhs, and `+919845012345`, and it asked whether WhatsApp was the same number. That run is a fixture result.
