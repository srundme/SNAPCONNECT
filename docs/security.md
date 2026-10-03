# Security

SnapServe Social is invitation-only. Public self-registration is disabled in Better Auth and rejected on `POST /api/auth/sign-up`.

## Access

- `SUPER_ADMIN` is platform authority stored on the user, separate from workspace membership. Cross-workspace switches are audited.
- `ADMIN`, `AGENT`, and `VIEWER` come from the membership row for the selected workspace. A submitted workspace id is not trusted by itself.
- An admin cannot grant `SUPER_ADMIN`.
- Removing a membership deletes that user's sessions.
- Viewers receive aggregate reports only. Lead pages and CSV export refuse that role.
- CSV cells that start with `=`, `+`, `-`, or `@` are prefixed so a spreadsheet does not treat them as formulas.

## Sessions and mutations

Better Auth stores sessions in PostgreSQL. Cookie-authenticated mutations use the framework's origin checks. Login attempts are rate-limited. Secrets are not exposed through `NEXT_PUBLIC_` variables.

## Credentials

Integration tokens are encrypted with AES-256-GCM. The key is `CREDENTIAL_ENCRYPTION_KEY` and is identified by `CREDENTIAL_ENCRYPTION_KEY_ID`. Rotate by writing a new key id, re-encrypting stored credentials, and keeping the previous key only until that rewrite finishes. Back up the key outside the database. Logs must not include the key, access tokens, or raw transcripts.

Outbound HTTP for Meta and Zoho is limited to documented hosts. Integration settings are not a general URL fetch.

## Webhooks

Each channel route selects its own app secret before parsing. Unknown or conflicting account routing is rejected. Verification of the callback challenge is stored separately from account subscription and from a real event.

## Data deletion

`/privacy` and `/data-deletion` describe the product's handling for Meta app setup. They are not a legal certification. Deleting a contact suppresses queued work for that contact and removes the contact, messages, notes, and lead rows in that workspace. Another workspace is untouched. An opening reservation can remain so the same comment is not messaged again.

## What this does not do

There is no public signup, no default password, and no automatic hosted-model fallback. Staff replies use the same eligibility checks as automation. Ambiguous send timeouts are marked `UNKNOWN` and are not blindly resent.
