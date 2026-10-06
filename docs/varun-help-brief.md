# Varun, our AI sales assistant: how it works and where we need help

We run an AI assistant ("Varun") that chats with customers of a premium interiors firm in Bengaluru on WhatsApp, Instagram and Facebook. It answers questions, collects lead details, and sends the lead to Zoho CRM so the sales team can call.

It works, but it is **inconsistent**: the same chat gives different results on each test, and fixing one problem often surfaces another. We want outside advice on making it more accurate and consistent without making it slower.

We are staying on Sarvam (`sarvam-105b-conversations`) for Indian-language quality and data residency.

---

## 1. What a good chat looks like

A customer messages "Hi, I want to renovate my 3 BHK in HSR Layout". Varun should:

1. Reply like a warm, sharp sales consultant, not a form.
2. Answer any question first (portfolio, price, office hours, process) from the company knowledge base.
3. Collect the must-have details one at a time, reusing anything already said:
   - name
   - home location (area + project)
   - home type + BHK
   - full home or selected rooms
   - possession, or whether the home is already ready (skipped for renovations)
   - phone number (on WhatsApp, confirm the same number)
4. Then, while the customer keeps chatting, ask the optional details one per reply: budget, style/must-haves, carpet area, start date, email.
5. Note a preferred call or visit time. Only the team confirms it, and it must be inside working hours and not already past.
6. Send the lead to Zoho once the must-haves are in, and update it when details change.

Replies must be short (1–3 lines, WhatsApp style), in the customer's language (English, Tanglish, Hinglish, Kanglish), with at most one question.

---

## 2. How the "brain" is set up today

### 2.1 Model calls (all Sarvam `sarvam-105b-conversations`, `/v1/chat/completions`)

| Call | Temperature | Max tokens | Output |
| --- | --- | --- | --- |
| **Main reply** | 0.4 (0.2 on retry) | 1024 | Strict `json_schema`: `reply`, `field_updates[]` (with evidence quotes), `handoff_requested`, `handoff_reason` |
| Plain-text fallback if JSON fails | 0.3 | 400 | Reply text only |
| Fill the lead form from the whole chat | 0 | 500 | JSON, one key per question |
| Read the person's name | 0 | 30 | Name or NONE |
| Pick sir / mam / bro | 0 | 20 | One word |
| Summarise older messages into memory | 0.2 | 400 | Up to 8 bullets |
| Photo description (vision) | — | — | Text, inserted as "(Sent a photo. It shows: …)" |

Median main-reply latency is about 4 seconds.

### 2.2 The pipeline for every customer message

```
customer message(s)  (2.5 s debounce so double messages are answered together)
   │
   ▼
[A] PRE-PROCESSING IN CODE (deterministic)
    - detect language (script + word lists)
    - read details already recorded; work out which detail is "next"
    - regex "situation" detectors (11): renovation, wants-portfolio, book-consultation,
      price-push, rented-home, rush, small-job, credentials, spam, abuse, flirt
    - map lookup of the project name (OpenStreetMap) → "Purva Meraki is in Agara"
    - past-time check (e.g. "today 10 am" when it is already 11:50)
    - phone validation (Indian mobile rules), refusal detection
    - extra answer extraction by regex (renovation ⇒ home is ready, email, etc.)
   │
   ▼
[B] SYSTEM PROMPT ("sales briefing"), rebuilt every turn, ~5,000 tokens of rules
    + the company knowledge base + post captions + the last 20 chat messages
   │
   ▼
[C] ONE SARVAM CALL → reply text + extracted lead fields (strict JSON)
   │
   ▼
[D] POST-PROCESSING IN CODE (about 15 steps, in order)
    1  validate field_updates (evidence must appear in the customer's text)
    2  if no question was asked and a detail is missing → append our scripted question
    3  remove questions about details already answered
    4  if (3) removed the only question → append the next question
    5  remove questions repeated from the last two replies ("nagging" filter)
    6  WhatsApp: rewrite "which number?" into "shall the team call this same number?"
    7  drop sentences in the wrong language
    8  drop a repeated greeting
    9  replace robotic "Noted sir." with a natural reaction ("Got it sir", "Thanks Arjun")
    10 humanise punctuation and remove canned phrases
    11 fix portfolio links that don't match the customer's BHK
    12 swap the WhatsApp number for the typed number if they gave a different one
    13 add an honest "I'm the AI assistant" if asked whether it's a bot
    14 first WhatsApp reply gets an automation disclosure
    15 drop bubbles that repeat earlier replies
    Also: replace the reply entirely if a "today 10 am" time has already passed
    and the model ignored it.
   │
   ▼
[E] clean lead answers (drop "Okay"/"yes" as answers, require digits for budget/sq ft,
    map "I don't know" to "Not sure yet", don't save a visit time as the project start)
   │
   ▼
send reply  →  update lead  →  sync to Zoho when contactable
```

### 2.3 The system prompt, section by section

1. **Who you are:** the assistant's name, honest that it is an AI, "think like a sharp, warm sales consultant".
2. **What the company offers:** services, FAQs, pricing policy ("never quote, the team confirms"), working hours.
3. **Knowledge base:** the only source of company facts (projects, address, process, links).
4. **Your expertise:** free to give general design advice, but never company promises outside the knowledge base.
5. **Goal:** the must-have and nice-to-have questions.
6. **How to handle every message:** six numbered cases (question, doubt, answer, greeting, yes/no, bye).
7. **Use common sense:** about 12 rules (who a detail is about, jokes, famous names, corrections, unrealistic times, sarcasm…).
8. **Situations:** about 25 one-liners (why we need the number, refusals, price, complaints, "nobody called", preferred time, not interested, wants a human, off-topic, bot, job seeker, spam, small job, rented home, family member's home, competitor quote, NRI, possession far away, in a hurry…).
9. **How to address them:** sir / mam / bro rules.
10. **Where this chat is now:** what's collected, the next detail, plus the turn-specific lines from step [A] (situation notes, map note, past time, "never ask the home type again"…).
11. **How to write:** language line, Tanglish/Hinglish/Kanglish do's and don'ts, length, banned chatbot words, banned call-centre phrases, punctuation rules, example replies.
12. **Recording details:** how to fill `field_updates` with evidence.
13. **Post captions** and team notes.

The total prompt is roughly 8,000–10,000 tokens per turn.

---

## 3. Problems we see

All examples are from a single real test chat (the customer "Arjun", renovating an apartment in HSR Layout), replayed many times.

### 3.1 Instruction-following failures (the model ignores the prompt)

| What happened | What the prompt said |
| --- | --- |
| Customer: "I want to renovate my house". Varun asked "when do you get possession?" | A renovation situation line said "never ask about possession" |
| "Today 10 am" at 11:50 AM. Varun ignored it and asked the style question | The past-time line said to say it has passed and ask for another time |
| Invented "the team has other visits scheduled at that time" | "You cannot see the team's calendar; never say slots are booked" |
| "I want to see your previous works?" got only a budget question, with no link | "A question: answer it first" + a portfolio situation line |
| Customer said "It is apartment"; Varun asked "apartment, villa or independent house, and how many BHK?" again | "If their answer covers part of a question, ask only the missing part" |
| Sent a 3 BHK / 4 BHK portfolio page when the BHK was never given | "BHK page only if they told you their BHK" |
| Questioned whether "Arjun" was the customer's real name, and mentioned their Instagram chat | "Never accuse; never mention other chats" |
| Ended the conversation once must-haves were in ("our team will call you") | "Keep the conversation going; ask optional details one per reply" |

### 3.2 Dead-end and robotic replies

- "Whole home noted sir." then "Noted sir." then "Alright sir." These replies move nothing forward.
- Parroting: "so the home is already ready and you are living there now".
- Filler: "this helps us plan the work better".
- Two questions in one message, despite "at most one question".

### 3.3 Wrong data extracted for the CRM (the same JSON call does extraction)

- Budget saved as "I dnt know can u suggest me", and style saved as "I'll explain this to team". Both were synced to Zoho.
- Budget saved as "I'm living already".
- "Okay" saved as an answer.
- Visit time "Tomorrow 1pm" saved as the project start date.
- A typed phone number ignored because the WhatsApp number was already known.

### 3.4 Problems our own code creates

Each post-processing rule fixed one observed failure, but the rules interact:

- One rule cut the model's portfolio answer, and another appended a budget question, so only the question was sent.
- A demo-workspace fallback mapped any question label containing "team" to "How big is your telecalling team?". The interiors email question ("…for the team to share designs") was sent as that.
- Loose "was this already asked?" matching caused both nagging (asking BHK every turn) and skipping (never asking a detail).

### 3.5 Inconsistency

The same 15 customer messages, replayed against the live system, give a noticeably different chat each run. A bug can disappear in one run and reappear in the next. We think the causes are:

1. Temperature 0.4 on the main reply.
2. A very long, rule-heavy prompt, so the model drops a different subset of rules each run.
3. Conflicting instructions, like "answer their question first" vs "ask the next detail at the end", or "one question only" vs "ask the missing detail".
4. One call doing two jobs (writing the reply + structured extraction).
5. About 15 regex post-processing steps that interact in ways that are hard to predict.

---

## 4. What we already tried

| Change | Result |
| --- | --- |
| More and more prompt rules for each failure | Each fixed rule helps for a while; others start being ignored |
| Code post-processing for each failure (section 2.2 [D]) | Predictable for the exact case, brittle for new phrasings, and makes replies feel stitched together |
| Turn-specific "situation" lines injected into "Where this chat is now" | Followed most of the time, not always |
| `sarvam-105b` (reasoning model), `reasoning_effort: low` | Replies took 18–120 s, and quality was no better (more dead ends). Rejected |
| `sarvam-105b`, `reasoning_effort: null` | Replies took 20–30 s, some calls timed out, and quality was similar. Rejected |

---

## 5. Constraints

- **Model:** stay on Sarvam `sarvam-105b-conversations`, which has a 32K context window.
- **Latency:** a WhatsApp reply should arrive within about 5–8 seconds of the debounce. One extra small call is fine; several sequential large calls are not.
- **Languages:** English, Tanglish, Hinglish and Kanglish, typed casually with short forms ("u", "ur", "dnt").
- **Truthfulness:** never invent company facts, prices, bookings or calendar availability.
- **Multi-tenant:** the same engine serves other businesses with different questions and knowledge bases, so no hard-coding to interiors.
- **CRM data:** must be clean. A wrong field in Zoho is worse than an empty one.

---

## 6. What we would like help with

### Architecture

1. Should we split the main call into separate steps? For example:
   - (a) extract and update lead fields from the latest message (temperature 0, small schema);
   - (b) decide the next action in code (answer, ask detail X, note time, hand off, close);
   - (c) write the reply with a short prompt focused on that one action, as plain text, not JSON.

   Is this the right shape for Sarvam, and what latency should we expect?
2. How should we decide "what to do this turn": in code (a state machine / dialogue policy) or with the model? Today it's a mix, and that's where many conflicts come from.
3. Can we remove most of the ~15 regex post-processing steps safely? Which few are worth keeping as hard guards (phone numbers, links, no invented bookings)?

### Prompting

4. How short can the system prompt be while staying reliable? Should we send only the rules relevant to this turn instead of all ~40 rules every time?
5. Would 5–10 full example conversations (few-shot) work better than rule lists for tone and flow?
6. How should we phrase hard constraints ("never ask possession for a renovation") so the model reliably obeys them?
7. Where should turn-specific facts go (the current time, "the customer already said apartment", the map result)? At the end of the prompt, as a separate system message after the chat, or inside the last user turn?

### Settings

8. What temperature / top_p should we use for the reply call and for the extraction call, for natural but consistent Indic chat?
9. Does strict `json_schema` hurt reply quality on `sarvam-105b-conversations`?

### Data quality

10. What's the most reliable way to extract lead fields? Per-field validation, asking the model for "unknown" explicitly, or a second verification pass?

### Evaluation

11. How should we build a regression suite for this? We have a replay harness that pushes a scripted list of customer messages through the real engine and the live model. How many runs per chat, which metrics, and is LLM-as-judge reasonable here?

---

## 7. What we can share

- The full system prompt for a sample turn, with customer data anonymised.
- The replay harness and sample chats (Arjun renovation, Tanglish, Hinglish, price-pusher, refusal to share a number).
- Before/after transcripts for each bug above.
- The list of lead questions and the knowledge base for the interiors business.

We will not share API keys, real customer phone numbers or real customer chats.
