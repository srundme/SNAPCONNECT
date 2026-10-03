# Demo script

Use the Demo Interiors simulation workspace unless a live gate has its own evidence. The opening line is:

> Hi! I'm the virtual assistant for Demo Interiors. Thanks for your interest. Are you planning interiors for a home or a commercial space?

Do not substitute a client brand, price, or service area.

## Simulation walkthrough

1. Sign in. Confirm the simulation banner and that Integrations lists Instagram, Facebook, and Zoho separately.
2. Inbox → Simulate Instagram comment. The transcript shows the opening template, the reply box explains that a comment does not open the messaging window, and the source post is `media-ig-1`.
3. Simulate Instagram reply. The requirement panel fills city, project type, budget, and phone. The assistant asks about WhatsApp instead of copying the phone number. The lead can become QUALIFIED. CRM shows a simulated id.
4. Simulate Facebook comment, then Simulate Messenger reply. The source post is the Page post id. The Facebook lead stays separate from the Instagram lead even when the phone number matches.
5. Take over. The conversation owner becomes HUMAN and the page says pending AI replies are cancelled.
6. Pause one connection on Integrations. The other channel stays available.
7. Reports → Combined, then Instagram and Facebook. Combined counts channel contacts. CRM coverage follows the same filter. Simulation and integration metrics are separate.
8. System Health shows the database, worker heartbeat, unknown sends, and whether the model mode is fixture or Ollama.

## Live walkthrough

Run this only after each channel's readiness stamps have timestamps from a real check.

1. Comment a configured keyword on your own Instagram post. Record the provider ids.
2. Reply in Instagram with a test project and a consented test number.
3. Confirm the Zoho test lead and a later field correction on the same CRM id.
4. Repeat on your own Facebook Page and in Messenger.
5. Show that a Page commenter id was not used as a PSID, and that an unattributed Messenger thread has no invented post.

Use consenting test participants and clearly marked test CRM records. Keep workflow triggers explicit so a demo write does not start an unexpected Zoho automation.
