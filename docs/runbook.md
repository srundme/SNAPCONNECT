# Runbook

## Processes

- Web: `pnpm dev` (port 3000)
- Worker: `pnpm dev:worker` (needs `REDIS_URL`)
- Database migrations: `pnpm db:migrate`
- Owner bootstrap: `pnpm bootstrap:owner -- --email=you@example.com` (once)
- Model check: `pnpm evaluate:llm`

The worker marks pending outbox rows dispatched and enqueues their ids. If Redis is unavailable it processes pending rows from PostgreSQL. Rows left `DISPATCHED` for more than two minutes return to `PENDING`. A job that throws is marked `FAILED` with a short error so the admin request does not hang.

## Recovery

| Failure | What to do |
| --- | --- |
| Redis down | Leave the web app up. The outbox remains in PostgreSQL. Restart Redis, then the worker. |
| Worker crash | Restart `pnpm dev:worker`. Pending and stale dispatched jobs resume. |
| Inference down | System Health shows the model unreachable. New qualification turns route to the staff inbox. There is no hosted fallback. |
| Send timeout | The attempt stays `UNKNOWN`. Reconcile from provider evidence or review it. Do not resend automatically. |
| Zoho error | The lead and transcript stay. CRM state becomes retry or needs attention. Retry updates the same lead revision and CRM id. |
| Token revoked | That connection stops sending. The other channel is unchanged. Reconnect from Integrations. |

## Backup

PostgreSQL is the durable store. Redis persistence is convenient and is not the source of pending work.

```bash
pg_dump "$DATABASE_URL" -Fc -f snapsocial.dump
pg_restore --clean --if-exists -d "$DATABASE_URL" snapsocial.dump
```

Practice a restore before any production rollout. This repository has not yet demonstrated a restore. Keep `CREDENTIAL_ENCRYPTION_KEY` with the backup, outside the dump's access path, or restored tokens cannot be read.

## Retention and deletion

Deletion is a workspace action on a lead. It cancels queued work for that contact and removes the contact's messages, notes, and lead. Audit the action without storing the deleted transcript. Opt-out is separate: new comments do not clear it.

## Pauses

Platform, workspace, and connection pauses all block automation. Use the connection pause when only one channel should stop.
