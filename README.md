# SnapServe Social

Internal staff application that turns new comments on owned Instagram posts and Facebook Page posts into one opening private reply, then qualifies an interiors enquiry with a local assistant and records a Zoho CRM lead. Branding is the `PRODUCT_NAME` environment value. The default is SnapServe Social.

This repository implements the 3 October 2026 two-channel plan. Simulation uses the real database, queues, and admin UI with labelled mock Instagram, Facebook, and Zoho transports. Live Instagram, Facebook, and Zoho verification stay pending until those accounts are connected and a real event is recorded.

## What runs locally

- Web admin at `http://localhost:3000` (Next.js, Node runtime)
- PostgreSQL for staff sessions, workspaces, conversations, leads, and the durable outbox
- Optional Redis worker for outbox dispatch
- Optional CPU-only Ollama for qualification (`LLM_MODE=ollama`)

`LLM_MODE=fixture` uses a labelled extractor so the inbox can be exercised without a model. It is not a measured Qwen run. An Ollama failure does not fall back to the fixture.

## Setup

Requirements: Node 22+, pnpm 12.6.0, PostgreSQL, and Redis if you run the worker.

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL, BETTER_AUTH_SECRET, and CREDENTIAL_ENCRYPTION_KEY.
# Generate secrets with: openssl rand -base64 32
pnpm db:generate
pnpm db:migrate
pnpm bootstrap:owner -- --email=you@example.com
pnpm dev
```

`pnpm bootstrap:owner` creates the first platform owner only when none exists, seeds the Demo Interiors simulation workspace and a paused Own accounts integration workspace, and prints a one-time password. There is no public signup and no default password. If an owner already exists the command exits.

A second terminal can run the worker after Redis is up:

```bash
pnpm dev:worker
```

Docker Compose provides PostgreSQL 16.10, Redis 7.4.2, and an optional CPU Ollama service (`docker compose --profile ai up -d`). The Ollama service publishes only on `127.0.0.1` and does not attach a GPU device. This machine already had PostgreSQL and Redis, so Compose was not required for the local demo. The Docker daemon was not available when the stack was first checked.

## Demo

Sign in as the bootstrapped owner and stay on **Demo Interiors · Simulation**. The banner states that Instagram, Facebook, and Zoho calls are mocks.

1. Integrations shows separate Instagram, Facebook, and Zoho cards. Simulation is not "live".
2. Inbox → Simulate Instagram comment, then Simulate Instagram reply.
3. Repeat with Simulate Facebook comment and Simulate Messenger reply.
4. Leads shows each channel separately, including matching phone numbers.
5. Take over a chat. The owner becomes HUMAN and pending AI replies stop.
6. Reports has combined, Instagram, Facebook, simulation, and integration views. Combined counts are channel contacts, not unique people.

See `docs/demo-script.md`.

## Checks

```bash
pnpm test          # domain, integrations, database pipeline
pnpm typecheck
pnpm lint
pnpm evaluate:llm  # records whether Ollama is reachable; does not claim a pass when it is not
```

Playwright is not configured yet, so `pnpm test:e2e` is not a completed gate.

## Live gates still pending

- Instagram: own professional account, OAuth, webhook, real comment, opening, and inbound reply
- Facebook Page: Page token, feed and messages subscriptions, real comment, Messenger reply, and a separate reel check
- Zoho: own-organization test lead create and correction
- CPU model: install Ollama, pull `qwen3.5:2b`, set `LLM_MODE=ollama`, and run `pnpm evaluate:llm`

Do not treat a simulation result, a webhook challenge, or the fixture extractor as evidence for those gates.
