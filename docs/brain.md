# Varun's brain: code plans, Claude writes

Agreed with the owner on 9 Oct 2026. Every feature that exists today stays (the 96-item inventory). What changes is
who writes the words: **code never writes a reply**. Code works out the state, checks the facts and decides what this
turn must do; Claude writes every word of every reply; code checks the reply against the brief and, when it is wrong,
has Claude rewrite it with the exact problem named.

## One turn

1. **Understand** (`understand`, Claude): the latest messages in, a typed reading out: answers given (by role),
   corrections, intents (price, timeline, slot, offer choice, complaint, not now, competitor, materials, site visit,
   identity, confusion …), language and quoted message. No words for the customer.
2. **Check** (code): the reading is validated with the existing domain checks: phone rules, email check (typo,
   placeholder, gibberish, no MX), BHK above 9, impossible numbers, property lookup + aliases + proof, working hours,
   holidays, passed times, flood and spam. Results land in **conversation state** (typed, its own table): answers by
   role, what was confirmed, checks done, ask counts, offer made and chosen, slot, declines, handoffs.
3. **Plan** (`plan`, code, pure): state + reading → a **turn brief**: the goal, what to answer first, what facts to
   include (proof, materials sheet lines, hours), the one question to ask (or none), what is known, what must never be
   said, tone, language, address (sir/mam), bubble count. Every business rule is a decision here.
4. **Write** (`write`, Claude): persona + knowledge base + chat + brief → 1 to 3 WhatsApp bubbles (JSON).
5. **Verify** (`verify`, code, pure): the bubbles against the brief. Never rewrites. Checks: the planned question is
   asked and it is the only one; required facts are there; no price figure, timeline, site visit/3D promise,
   competitor name, re-ask of a known detail, re-introduction, narration; length. A failure goes back to Claude once
   with the problems listed; a second failure hands the chat to the team with an alert.
6. **Act** (existing code): send with typing delay and voice, save, rating, alerts, Zoho, follow-ups.

## Models

- Understand, write, photos, floor plans, documents: **Claude Opus 5.5** (`claude-opus-5-5`).
- Voice in: Sarvam transcription. Voice out: Cartesia (Claude writes the words).
- Fallback when Claude is unreachable: Sarvam.

## Rollout

- `agentSettings.brain`: `"off"` (today's pipeline), `"shadow"` (brain runs, reply stored as a SYSTEM note, not
  sent), `"live"` (brain writes the reply).
- Tests: the guard scenarios and the real-chat replays become checks on the brief and the verifier.
