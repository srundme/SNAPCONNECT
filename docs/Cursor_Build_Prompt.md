# Cursor build prompt

Updated 3 October 2026 for Instagram and Facebook V1. SnapServe Social is a configurable working name. The product decisions are in `docs/SnapServe_Social_Product_Plan.md`.

This repository was built from that prompt. The implementation order is:

1. Foundation: monorepo, Compose, auth, workspaces, navigation.
2. Two-channel simulation: fixtures, rules, inbox, identities, outbox, mock CRM.
3. CPU Ollama adapter and a measured evaluation when the model is installed.
4. Real Instagram adapter, with live verification pending until a real comment and reply are stored.
5. Real Facebook Page adapter, with the same pending live gate, and reels unverified.
6. Real Zoho adapter, with mock writes only until a controlled test organization is connected.
7. Dashboards, filters, takeover, export, audit, and independent pauses.
8. Recovery notes, privacy routes, and the demo script.

Constraints that stay in force:

- Do not deploy, mass-message, or create real CRM records from install, seed, or tests.
- Missing credentials do not block simulation. They leave the live gate pending.
- Do not report a mock, a fixture extractor, or a webhook challenge as a live integration.
- Public signup stays blocked. The first owner comes from `pnpm bootstrap:owner`.
- One shared inference lease serves both channels.
- Identical native ids on Instagram and Facebook must not merge contacts or share an opening reservation.
- A Facebook comment-author id is not a Messenger PSID.
