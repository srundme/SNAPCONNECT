# Architecture

SnapServe Social is a modular monolith. The web app serves the admin UI and HTTP API. A separate worker drains the PostgreSQL outbox into BullMQ when Redis is available, and can process pending rows directly when Redis is down.

## Packages

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js App Router, Better Auth, route handlers, admin screens |
| `apps/worker` | Outbox dispatcher, heartbeats, LLM evaluation command |
| `packages/domain` | Rules, qualification, webhook normalization, analytics, authorization helpers |
| `packages/db` | Prisma schema, migrations, repositories, simulation engine |
| `packages/integrations` | Instagram, Facebook, simulation, Zoho, and LLM adapters |
| `packages/config` | Validated environment variables |

Business rules consume normalized events. They do not branch on raw Meta payloads.

## Request path

1. `GET/POST /api/webhooks/meta/instagram` and `/api/webhooks/meta/facebook` verify the route's app secret before parsing.
2. The handler checks `X-Hub-Signature-256` with a timing-safe compare, enforces a size limit, splits the batch, and inserts webhook rows plus outbox jobs in one transaction.
3. The worker, or the simulation action, processes jobs. Inference and provider calls stay out of the webhook response.
4. One opening is reserved per connection and comment. A later automated reply requires an inbound user message inside the 24-hour window.
5. Qualification status is computed in domain code from validated fields. The model cannot set it.
6. CRM sync is queued only after the lead is contactable and permission is stored. A sync failure does not change qualification.

## Identity

`ContactIdentity` is unique on workspace, channel, connection, identity type, and external id. `COMMENT_AUTHOR` and `MESSAGING_PARTICIPANT` are never treated as the same identity because their strings match. A Messenger turn without referral evidence stays unattributed. Instagram and Facebook contacts are not merged by phone or name.

## Inference

One `InferenceLease` row (`id = global`) caps generation at `LLM_CONCURRENCY` (default 1) for both channels. The Ollama container profile has no GPU device. The fixture extractor is a development stand-in and is labelled in System Health.

## State

Qualification, sales stage, conversation owner, CRM sync, and outbound attempt status are separate. Messaging eligibility is derived at read and send time. Opt-out is a suppression record. Pausing one connection does not pause the other.
