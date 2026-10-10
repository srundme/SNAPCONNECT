import { describe, expect, it } from "vitest";
import {
  acceptExtractedAnswers,
  mediaNote,
  documentNote,
  impossibleBhk,
  casualText,
  plainWords,
  readingMs,
  typingMs,
  nameConcern,
  nameFitsProfile,
  publicFigure,
  cleanName,
  greetedByName,
  validPhonesIn,
  buildZohoRecord,
  can,
  canGrantPlatformRole,
  canMutateLead,
  cohortFunnel,
  crmCoverage,
  dedupKey,
  looksEnglish,
  chatLanguageSample,
  languageName,
  humanizeReply,
  deterministicIntent,
  displayLastName,
  duplicateCheckFields,
  evaluateQualification,
  demoQualificationSettings,
  openingForPost,
  commentLeadSignal,
  parseLeadFields,
  parseLeadQuestions,
  questionsFromRows,
  zohoValuesFromQuestions,
  readyForZoho,
  screenLead,
  postSystemPrompt,
  inferenceSlotAvailable,
  manualQualification,
  normalizeMetaPayload,
  openingEligibility,
  parseBudget,
  withAutomationDisclosure,
  parsePhone,
  replyEligibility,
  routingDecision,
  selectRule,
  shouldCreateAgain,
  surfaceSupport,
  toCsv,
  validateZohoMapping,
  verifyMetaSignature,
  zonedDay,
  type Actor,
  type LeadSnapshot,
  type RuleSnapshot,
} from "../src/index";
import { createHmac } from "node:crypto";

const staff: Actor = {
  userId: "user-1",
  platformRole: "STAFF",
  suspended: false,
  memberships: [{ workspaceId: "ws-1", role: "AGENT" }],
};
const admin: Actor = { ...staff, userId: "admin-1", memberships: [{ workspaceId: "ws-1", role: "ADMIN" }] };
const viewer: Actor = { ...staff, userId: "viewer-1", memberships: [{ workspaceId: "ws-1", role: "VIEWER" }] };
const owner: Actor = { ...staff, userId: "owner-1", platformRole: "SUPER_ADMIN", memberships: [] };

const emptyLead: LeadSnapshot = {
  chosenName: null,
  city: null,
  projectType: null,
  propertyType: null,
  workType: null,
  requirement: null,
  budgetRaw: null,
  budgetAmountMinor: null,
  budgetMinMinor: null,
  budgetMaxMinor: null,
  budgetCurrency: null,
  budgetDeclined: false,
  timeframeRaw: null,
  timeframeDeclined: false,
  phoneE164: null,
  phoneDeclined: false,
  whatsappE164: null,
  whatsappDeclined: false,
  sameNumberConfirmed: false,
  preferredChannel: null,
  phonePermission: false,
  whatsappPermission: false,
  email: null,
};

describe("authorization", () => {
  it("blocks viewers from transcripts, exports and other workspaces", () => {
    expect(can(viewer, "inbox.read", "ws-1")).toBe(false);
    expect(can(viewer, "lead.export", "ws-1")).toBe(false);
    expect(can(viewer, "report.read", "ws-1")).toBe(true);
    expect(can(viewer, "report.read", "ws-2")).toBe(false);
    expect(can(staff, "lead.export", "ws-1")).toBe(false);
    expect(can(admin, "lead.export", "ws-1")).toBe(true);
  });

  it("stops suspended and revoked memberships", () => {
    expect(can({ ...staff, suspended: true }, "inbox.read", "ws-1")).toBe(false);
    expect(can({ ...staff, memberships: [] }, "inbox.read", "ws-1")).toBe(false);
  });

  it("prevents an admin from granting platform authority", () => {
    expect(canGrantPlatformRole(admin, "SUPER_ADMIN")).toBe(false);
    expect(canGrantPlatformRole(owner, "SUPER_ADMIN")).toBe(true);
    expect(can(owner, "inbox.read", "ws-2")).toBe(true);
  });

  it("lets an agent claim only unassigned leads or edit their own", () => {
    expect(canMutateLead({ actor: staff, workspaceId: "ws-1", assignedUserId: null, claimUnassigned: true })).toBe(true);
    expect(canMutateLead({ actor: staff, workspaceId: "ws-1", assignedUserId: "other", claimUnassigned: false })).toBe(false);
    expect(canMutateLead({ actor: staff, workspaceId: "ws-1", assignedUserId: "user-1", claimUnassigned: false })).toBe(true);
  });
});

describe("budgets and phones", () => {
  it("parses INR lakhs, ranges and ambiguous amounts", () => {
    expect(parseBudget("15 lakhs")).toMatchObject({ kind: "amount", amountMinor: 1_500_000, currency: "INR" });
    expect(parseBudget("1.5 crore")).toMatchObject({ kind: "amount", amountMinor: 15_000_000 });
    expect(parseBudget("10-15 lakhs")).toMatchObject({ kind: "range", minMinor: 1_000_000, maxMinor: 1_500_000 });
    expect(parseBudget("around 10-15").kind).toBe("ambiguous");
    expect(parseBudget("not sure").kind).toBe("declined");
    expect(parseBudget("₹8,50,000")).toMatchObject({ kind: "amount", amountMinor: 850_000 });
  });

  it("validates numbers without treating a username as a phone", () => {
    expect(parsePhone("+91 98450 12345").kind).toBe("valid");
    expect(parsePhone("not sure").kind).toBe("declined");
    expect(parsePhone("call me maybe")).toMatchObject({ kind: "invalid" });
  });

  it("spots a mistyped mobile number but not a valid one or a small count", () => {
    expect(validPhonesIn("8904887300")).toEqual(["+918904887300"]);
    expect(validPhonesIn("8904887300899")).toEqual([]);
  });

  it("accepts only real-looking Indian mobiles", () => {
    for (const fake of ["9876543210", "1234567890", "123456789090", "9999999999", "9898989898", "9123456789", "9000000001", "5845012345", "080 2345 6789"]) {
      expect(parsePhone(fake).kind, fake).toBe("invalid");
    }
    for (const real of ["9845012345", "+91 89048 87300", "919677112233", "7019 552 846", "6382004417"]) {
      expect(parsePhone(real).kind, real).toBe("valid");
    }
    expect(parsePhone("+1 415 555 2671").kind).toBe("valid");
  });
});

describe("qualification", () => {
  it("requires permission before contactable and does not disqualify a declined budget", () => {
    const withNumber = evaluateQualification(
      { ...emptyLead, phoneE164: "+919845012345", city: "Mysuru", projectType: "residential", requirement: "Kitchen", budgetRaw: "15 lakhs", budgetAmountMinor: 1_500_000, timeframeRaw: "June" },
      demoQualificationSettings,
    );
    expect(withNumber.qualification).toBe("IN_PROGRESS");
    const permitted = evaluateQualification(
      { ...emptyLead, phoneE164: "+919845012345", phonePermission: true, city: "Mysuru", projectType: "residential", requirement: "Kitchen", budgetDeclined: true, budgetRaw: "not sure" },
      demoQualificationSettings,
    );
    expect(permitted.contactable).toBe(true);
    expect(permitted.qualification).not.toBe("DISQUALIFIED");
    expect(permitted.qualification).not.toBe("QUALIFIED");
  });

  it("qualifies only when configured project fields and permission exist", () => {
    const decision = evaluateQualification(
      {
        ...emptyLead,
        phoneE164: "+919845012345",
        phonePermission: true,
        city: "Mysuru",
        projectType: "residential",
        requirement: "Full home",
        budgetAmountMinor: 1_500_000,
        budgetRaw: "15 lakhs",
        timeframeRaw: "next month",
      },
      demoQualificationSettings,
    );
    expect(decision.qualification).toBe("QUALIFIED");
  });

  it("requires a reason for manual overrides", () => {
    expect(manualQualification({ next: "QUALIFIED", reason: " " }).ok).toBe(false);
    expect(manualQualification({ next: "DISQUALIFIED", reason: "Outside city list confirmed by staff" }).ok).toBe(true);
  });
});

describe("rules and eligibility", () => {
  const base: RuleSnapshot = {
    id: "rule-a",
    priority: 10,
    coverage: "ALL_POSTS",
    commentFilter: "KEYWORDS",
    keywords: ["interiors", "quote", "design"],
    exclusions: ["job"],
    selectedMediaIds: [],
    excludedMediaIds: ["excluded-post"],
    active: true,
    activatedAt: new Date("2026-10-01T00:00:00Z"),
  };

  it("tells junk comments from enquiries before any model is asked", () => {
    for (const junk of ["😍", "🔥🔥🔥", "❤️👏", "@priya.k @anand_99", "Nice", "wow!!", "Beautiful work 😍", "Semma", "love it", "bahut badhiya", "Check my page for cheap modular kitchens", "looking for a job as interior designer", "We supply modular kitchen hardware, DM us", "follow back pls"]) {
      expect(commentLeadSignal(junk).verdict, junk).toBe("not_lead");
    }
    for (const lead of ["Price?", "price for 3bhk", "interested", "need this for my flat", "evlo aagum?", "kitna kharcha hoga", "DM details pls", "@karthik see this, how much for full home"]) {
      expect(commentLeadSignal(lead).verdict, lead).toBe("lead");
    }
    expect(commentLeadSignal("who designed this?").verdict).toBe("unsure");
  });

  it("uses a post opening and prompt when that post has its own copy", () => {
    expect(openingForPost("Default hello", "  Ask about this reel.  ")).toBe("Ask about this reel.");
    expect(openingForPost("Default hello", "   ")).toBe("Default hello");
    expect(parseLeadFields(["city", "nope", "projectType"])).toEqual(["projectType", "city"]);
    expect(readyForZoho({ qualification: "CONTACTABLE", reasons: [], missing: ["city"], contactable: true }, "CONTACTABLE")).toBe(true);
    expect(readyForZoho({ qualification: "CONTACTABLE", reasons: [], missing: ["city"], contactable: true }, "QUALIFIED")).toBe(false);
    const screened = screenLead({
      questions: [
        { id: "person-name", label: "Person name", kind: "name", zohoField: "Last_Name" },
        { id: "demo", label: "Are you interested to attend the demo?", kind: "yesno", zohoField: null },
      ],
      answers: { demo: "no" },
      name: "Asha",
      phoneE164: "+919845012345",
    });
    expect(screened.cold).toBe(true);
    expect(screened.ready).toBe(false);
    const mapped = questionsFromRows(
      ["Person name", "Company name", "Contact number", "Why AI calling may help"],
      ["Last_Name", "Company", "Phone", ""],
    );
    expect(mapped.map((question) => question.zohoField)).toEqual(["Last_Name", "Company", "Phone", null]);
    expect(parseLeadQuestions([{ id: "company-name", label: "Company name" }])[0]?.zohoField).toBe("Company");
    const placed = zohoValuesFromQuestions({
      questions: mapped,
      answers: { "company-name": "SnapServe", "why-ai-calling-may-help": "The team cannot cover night calls" },
      name: "Asha",
      phoneE164: "+919845012345",
    });
    expect(placed.fields).toMatchObject({ Last_Name: "Asha", Company: "SnapServe", Phone: "+919845012345" });
    expect(placed.lines.join(" ")).toContain("night calls");
    expect(postSystemPrompt(" Ask the city, then the budget. ")).toBe("Ask the city, then the budget.");
    expect(postSystemPrompt("")).toBeNull();
  });

  it("covers new posts with keywords and ignores old comments", () => {
    const match = selectRule({
      rules: [base],
      text: "Need interiors for a home",
      mediaId: "future-post",
      commentAt: new Date("2026-10-03T00:00:00Z"),
    });
    expect(match.winner?.id).toBe("rule-a");
    const old = selectRule({
      rules: [base],
      text: "interiors",
      mediaId: "future-post",
      commentAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(old.winner).toBeNull();
  });

  it("keeps selected posts and exclusions independent from keywords", () => {
    const selected = selectRule({
      rules: [{ ...base, id: "selected", coverage: "SELECTED_POSTS", selectedMediaIds: ["post-1"] }],
      text: "design please",
      mediaId: "post-2",
      commentAt: new Date("2026-10-03T00:00:00Z"),
    });
    expect(selected.winner).toBeNull();
    const excluded = selectRule({
      rules: [base],
      text: "interiors",
      mediaId: "excluded-post",
      commentAt: new Date("2026-10-03T00:00:00Z"),
    });
    expect(excluded.winner).toBeNull();
  });

  it("picks one winner by priority", () => {
    const decision = selectRule({
      rules: [base, { ...base, id: "higher", priority: 20, keywords: ["interiors"] }],
      text: "interiors quote",
      mediaId: "post-1",
      commentAt: new Date("2026-10-03T00:00:00Z"),
    });
    expect(decision.winner?.id).toBe("higher");
    expect(decision.skipped.some((item) => item.ruleId === "rule-a")).toBe(true);
  });

  it("blocks openings after seven days and replies without an inbound message", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    expect(
      openingEligibility({
        commentAt: new Date("2026-10-01T00:00:00Z"),
        now,
        alreadyReserved: false,
        paused: false,
        optedOut: false,
        connectionReady: true,
        supportedSurface: true,
      }).allowed,
    ).toBe(false);
    expect(
      replyEligibility({
        now,
        lastUserMessageAt: null,
        paused: false,
        optedOut: false,
        connectionReady: true,
        ownerAllowsAutomation: true,
        manual: false,
      }).reason,
    ).toMatch(/inbound reply/i);
  });

  it("does not treat Facebook reels as ready before verification", () => {
    expect(surfaceSupport({ channel: "FACEBOOK", contentType: "REEL", facebookReelsVerified: false, isAd: false, isLive: false, isGroup: false }).supported).toBe(false);
    expect(surfaceSupport({ channel: "INSTAGRAM", contentType: "REEL", facebookReelsVerified: false, isAd: false, isLive: false, isGroup: false }).supported).toBe(true);
  });
});

describe("webhooks", () => {
  const instagram = {
    object: "instagram",
    entry: [
      {
        id: "17841405880000001",
        changes: [
          {
            field: "comments",
            value: {
              id: "shared-native-id-42",
              text: "Need interiors",
              from: { id: "shared-native-id-42", username: "prospect_ig" },
              media: { id: "media-ig-1", media_product_type: "FEED" },
            },
          },
        ],
        messaging: [
          {
            sender: { id: "igsid-1" },
            recipient: { id: "17841405880000001" },
            timestamp: 1759500000000,
            message: { mid: "mid-ig-1", text: "Home in Mysuru" },
          },
        ],
      },
    ],
  };
  const facebook = {
    object: "page",
    entry: [
      {
        id: "100860000000001",
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: "shared-native-id-42",
              post_id: "100860000000001_9001",
              sender_id: "shared-native-id-42",
              sender_name: "Prospect",
              message: "Need interiors",
              created_time: 1759500000,
            },
          },
          {
            field: "feed",
            value: { item: "comment", verb: "edited", comment_id: "shared-native-id-42", message: "edited" },
          },
        ],
        messaging: [
          {
            sender: { id: "psid-9" },
            recipient: { id: "100860000000001" },
            timestamp: 1759500001000,
            message: { mid: "mid-fb-1", text: "Hello", is_echo: false },
            referral: { comment_id: "shared-native-id-42", post_id: "100860000000001_9001" },
          },
          {
            sender: { id: "psid-9" },
            recipient: { id: "100860000000001" },
            read: { watermark: 1 },
          },
        ],
      },
    ],
  };

  it("keeps colliding native ids on separate channels", () => {
    const ig = normalizeMetaPayload("INSTAGRAM", instagram, new Date("2026-10-03T00:00:00Z"));
    const fb = normalizeMetaPayload("FACEBOOK", facebook, new Date("2026-10-03T00:00:00Z"));
    const igComment = ig.find((event) => event.kind === "comment");
    const fbComment = fb.find((event) => event.kind === "comment" && event.action === "add");
    const fbEdit = fb.find((event) => event.kind === "comment" && event.action === "edit");
    expect(igComment && fbComment && dedupKey("INSTAGRAM", igComment)).not.toBe(fbComment && dedupKey("FACEBOOK", fbComment));
    expect(fbEdit?.kind).toBe("comment");
    expect(fbComment && fbComment.kind === "comment" && fbComment.isAd).toBe(false);
    const inactive = normalizeMetaPayload("FACEBOOK", {
      object: "page",
      entry: [{ id: "1", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "c-organic", post_id: "1_2", sender_id: "9", message: "Hi", post: { promotion_status: "inactive", status_type: "added_photos" } } }] }],
    }, new Date("2026-10-04T00:00:00Z"));
    const organic = inactive.find((event) => event.kind === "comment");
    expect(organic && organic.kind === "comment" && organic.isAd).toBe(false);
    const promoted = normalizeMetaPayload("FACEBOOK", {
      object: "page",
      entry: [{ id: "1", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "c-ad", post_id: "1_2", sender_id: "9", message: "Hi", post: { promotion_status: "active" } } }] }],
    }, new Date("2026-10-04T00:00:00Z"));
    const ad = promoted.find((event) => event.kind === "comment");
    expect(ad && ad.kind === "comment" && ad.isAd).toBe(true);
    expect(fb.some((event) => event.kind === "ignore" && event.reason.includes("Non-message"))).toBe(true);
    const message = fb.find((event) => event.kind === "message");
    expect(message && message.kind === "message" && message.referralCommentId).toBe("shared-native-id-42");
  });

  it("reads a customer DM edit and skips empty or own edits", () => {
    const at = new Date("2026-10-05T00:00:00Z");
    const edits = (messaging: unknown[]) => normalizeMetaPayload("INSTAGRAM", { object: "instagram", entry: [{ id: "ig-1", messaging }] }, at);
    const [edit] = edits([{ sender: { id: "igsid-7" }, timestamp: 1759622400000, message_edit: { mid: "mid-7", text: "9845012345", num_edit: "1" } }]);
    expect(edit).toMatchObject({ kind: "message_edit", messageId: "mid-7", senderId: "igsid-7", text: "9845012345", editCount: 1 });
    expect(edit && dedupKey("INSTAGRAM", edit)).toBe("INSTAGRAM:ig-1:message_edit:mid-7:1");
    expect(edits([{ timestamp: 1, message_edit: { mid: "mid-8", num_edit: 0 } }])[0]?.kind).toBe("ignore");
    expect(edits([{ sender: { id: "ig-1" }, message_edit: { mid: "mid-9", text: "fixed", num_edit: 1 } }])[0]?.kind).toBe("ignore");
    expect(edits([{ message_edit: { mid: "mid-10", text: "fixed", num_edit: 2 } }])[0]).toMatchObject({ kind: "message_edit", editCount: 2 });
  });

  it("reads WhatsApp text, voice and button messages and keeps delivery receipts", () => {
    const events = normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "pnid-1" },
            contacts: [{ profile: { name: "Kishore" }, wa_id: "919845012345" }],
            messages: [
              { from: "919845012345", id: "wamid.1", timestamp: "1759670000", type: "text", text: { body: "Hi, need AI calling" } },
              { from: "919845012345", id: "wamid.2", timestamp: "1759670010", type: "audio", audio: { id: "media-9", mime_type: "audio/ogg; codecs=opus", voice: true } },
              { from: "919845012345", id: "wamid.3", timestamp: "1759670020", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } } },
              { from: "919845012345", id: "wamid.4", timestamp: "1759670030", type: "reaction", reaction: { message_id: "wamid.1", emoji: "👍" } },
            ],
            statuses: [{ id: "wamid.out", status: "delivered" }],
          },
        }],
      }],
    }, new Date("2026-10-05T00:00:00Z"));
    const messages = events.filter((event) => event.kind === "message");
    // A reaction keeps the chat going: it reaches Varun as a short reply.
    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ externalAccountId: "pnid-1", senderId: "919845012345", text: "Hi, need AI calling", senderName: "Kishore" });
    expect(messages[3]).toMatchObject({ text: "(Reacted 👍 to your message)" });
    const replied = normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "pnid-1" },
            messages: [{ from: "919845012345", id: "wamid.5", timestamp: "1759670040", type: "text", context: { id: "wamid.out" }, text: { body: "no" } }],
          },
        }],
      }],
    }, new Date("2026-10-05T00:00:00Z"));
    expect(replied[0]).toMatchObject({ kind: "message", text: "no", replyToMessageId: "wamid.out" });
    expect(messages[1]).toMatchObject({ text: "", audioMediaId: "media-9" });
    expect(messages[2]).toMatchObject({ text: "Yes" });
    const delivered = events.find((event) => event.kind === "delivery");
    expect(delivered).toMatchObject({ messageId: "wamid.out", status: "delivered", recipient: null, errorCode: null });
    expect(delivered && dedupKey("WHATSAPP", delivered)).toBe("WHATSAPP:pnid-1:delivery:wamid.out:delivered");
    expect(normalizeMetaPayload("WHATSAPP", { object: "page", entry: [] }, new Date())[0]?.kind).toBe("ignore");
  });

  it("rejects unknown and conflicting routes", () => {
    expect(routingDecision([])).toEqual({ reject: "Unknown account." });
    expect(routingDecision(["a", "b"])).toEqual({ reject: "Conflicting account connections." });
    expect(routingDecision(["a"])).toEqual({ connectionId: "a" });
  });

  it("rejects a tampered signature and selects the route secret", () => {
    const body = JSON.stringify(instagram);
    const secret = "instagram-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, signature, secret)).toBe(true);
    expect(verifyMetaSignature(body, signature, "facebook-secret")).toBe(false);
    expect(verifyMetaSignature(`${body} `, signature, secret)).toBe(false);
  });
});

describe("ai validation", () => {

  it("rejects unsupported claims and adversarial instructions without evidence", () => {
    expect(deterministicIntent("please talk to a human").human).toBe(true);
    expect(deterministicIntent("I want to talk to a human agent").human).toBe(true);
    expect(deterministicIntent("I need the AI Voice agent for my business").human).toBe(false);
    expect(deterministicIntent("I want the voice ai to qualify the leads and my human team can continue on follow-up").human).toBe(false);
    expect(chatLanguageSample(["Enaku calls ah scale pannanum so", "20000", "Ok", "Yes"])).toBe("Enaku calls ah scale pannanum so");
    expect(chatLanguageSample(["En company la ipo 40 Peru irukanga", "I want to know the pricing details please"])).toBeNull();
    expect(chatLanguageSample(["Yes", "6383653279"])).toBeNull();
    expect(chatLanguageSample(["Yes I wanted to know about how voice agent can help me in the business."])).toBeNull();
    expect(chatLanguageSample(["Enaku calls ah scale pannanum so", "I don’t know Tamil"])).toBeNull();
    expect(chatLanguageSample(["Enaku calls ah scale pannanum so", "Speak in English"])).toBeNull();
    expect(chatLanguageSample(["Speak in English", "ok"])).toBeNull();
    expect(chatLanguageSample(["bhai hamari team bahut calls miss karti hai"])).not.toBeNull();
    expect(languageName(chatLanguageSample(["Yes I want to know about cold calling.", "Achaaa setup kaya hai"]) ?? "")).toMatch(/^Hinglish/);
    expect(languageName(chatLanguageSample(["Mujueeee apka pricing bolo", "2000 mins ko kethaa"]) ?? "")).toMatch(/^Hinglish/);
    expect(languageName(chatLanguageSample(["Yes I want to know", "Can you talk in Hindi", "Okay ji"]) ?? "")).toMatch(/^Hinglish/);
    expect(chatLanguageSample(["Achaaa setup kaya hai", "I can't speak Hindi"])).toBeNull();
    expect(chatLanguageSample(["Yes I want to know about how Snapsoc can help me in my cold calling."])).toBeNull();
    expect(languageName("Enaku calls ah scale pannanum so")).toMatch(/^Tanglish/);
    expect(humanizeReply("Sorry, wait panna. Unga details team-ku 21 minutes munnadiye pochu — Working hours-la call pannuvanga; enna-nu sollunga, appo correct-a theriyum.")).toBe(
      "Sorry, wait panna. Unga details team ku 21 minutes munnadiye pochu, Working hours la call pannuvanga, enna nu sollunga, appo correct a theriyum.",
    );
    expect(humanizeReply("Sure ma'am, number +916383653279-ku call varum.")).toBe("Sure mam, number +916383653279 ku call varum.");
    expect(languageName("bhai hamare kaam aayega kya")).toMatch(/^Hinglish/);
    expect(languageName("हमारी टीम में 20 लोग हैं")).toMatch(/^Hindi/);
    expect(looksEnglish("How many calls do you handle?")).toBe(true);
    expect(looksEnglish("enga team la 20 per irukanga")).toBe(false);
    expect(looksEnglish("हमारी टीम में 20 लोग हैं")).toBe(false);
    expect(deterministicIntent("stop messaging me").optOut).toBe(true);
    expect(deterministicIntent("please leave me alone").optOut).toBe(true);
    expect(deterministicIntent("STOP").optOut).toBe(true);
    expect(deterministicIntent("pls stop").optOut).toBe(true);
    expect(deterministicIntent("stop sending messages").optOut).toBe(true);
    expect(deterministicIntent("my flat is near the bus stop").optOut).toBe(false);
    expect(deterministicIntent("one stop solution for full home?").optOut).toBe(false);
    expect(withAutomationDisclosure("Thanks for commenting.", "SnapServe")).toContain("automated assistant");
    expect(withAutomationDisclosure("Thanks for commenting.", "SnapServe", "Maya")).toContain("Maya, an automated assistant");
    expect(withAutomationDisclosure("I'm the virtual assistant for SnapServe.", "SnapServe")).toBe("I'm the virtual assistant for SnapServe.");
  });
});

describe("crm and analytics", () => {
  const fields = [
    { apiName: "Last_Name", required: true, dataType: "text", picklist: [] },
    { apiName: "Phone", required: false, dataType: "phone", picklist: [] },
    { apiName: "City", required: false, dataType: "text", picklist: [] },
    { apiName: "Lead_Source", required: false, dataType: "picklist", picklist: ["Instagram", "Facebook"] },
    { apiName: "External_Lead_Key__c", required: false, dataType: "text", picklist: [] },
    { apiName: "Layout_Must__c", required: true, dataType: "text", picklist: [] },
  ];
  const mapping = {
    lastNameField: "Last_Name" as const,
    phoneField: "Phone" as const,
    whatsappField: null,
    cityField: "City",
    projectField: null,
    budgetField: null,
    timeframeField: null,
    sourceField: "Lead_Source" as const,
    instagramSourceValue: "Instagram",
    facebookSourceValue: "Facebook",
    externalKeyField: "External_Lead_Key__c",
    descriptionFallback: true,
  };

  it("catches missing mandatory fields and uses the external key", () => {
    expect(validateZohoMapping(mapping, fields).join(" ")).toMatch(/Layout_Must__c/);
    expect(duplicateCheckFields(mapping)).toEqual(["External_Lead_Key__c"]);
    const record = buildZohoRecord(
      {
        leadId: "11111111-1111-1111-1111-111111111111",
        channel: "FACEBOOK",
        chosenName: null,
        username: null,
        displayName: "Prospect",
        phoneE164: "+919845012345",
        whatsappE164: "+919000011111",
        city: "Mysuru",
        projectType: "residential",
        requirement: "Kitchen",
        budgetRaw: "15 lakhs",
        timeframeRaw: "June",
        connectionLabel: "Demo Page",
        postId: null,
        permissionSummary: "phone",
        testRecord: true,
      },
      mapping,
    );
    expect(record.Last_Name.startsWith("[TEST]")).toBe(true);
    expect(record.Lead_Source).toBe("Facebook");
    expect(record.External_Lead_Key__c).toBe("11111111-1111-1111-1111-111111111111");
    expect(record.Description).toMatch(/unattributed/);
    expect(displayLastName({ leadId: "abcdefghij", channel: "INSTAGRAM", chosenName: null, username: "prospect_ig", displayName: null, testRecord: false })).toMatch(/Instagram user/);
  });

  it("does not recreate an uncertain CRM record", () => {
    expect(shouldCreateAgain({ knownCrmId: null, lastResult: "UNKNOWN" })).toBe(false);
    expect(shouldCreateAgain({ knownCrmId: "1", lastResult: "FAILED" })).toBe(false);
  });

  it("builds a fixed cohort and separates simulation from live contacts", () => {
    const contacts = [
      {
        contactId: "ig",
        channel: "INSTAGRAM" as const,
        connectionId: "ig-conn",
        mode: "SIMULATION" as const,
        firstMatchingCommentAt: "2026-10-03T04:00:00Z",
        firstAcceptedOpeningAt: "2026-10-03T04:01:00Z",
        firstInboundAt: "2026-10-03T05:00:00Z",
        contactableAt: "2026-10-03T06:00:00Z",
        qualifiedAt: null,
      },
      {
        contactId: "fb",
        channel: "FACEBOOK" as const,
        connectionId: "fb-conn",
        mode: "INTEGRATION" as const,
        firstMatchingCommentAt: "2026-09-01T00:00:00Z",
        firstAcceptedOpeningAt: "2026-10-03T04:01:00Z",
        firstInboundAt: "2026-10-03T05:00:00Z",
        contactableAt: "2026-10-03T06:00:00Z",
        qualifiedAt: "2026-10-03T07:00:00Z",
      },
    ];
    const funnel = cohortFunnel({
      contacts,
      start: new Date("2026-10-01T00:00:00Z"),
      end: new Date("2026-10-31T23:59:59Z"),
      observationCutoff: new Date("2026-10-20T00:00:00Z"),
      mode: "ALL",
    });
    expect(funnel.matchingContacts).toBe(1);
    expect(funnel.qualified).toBe(0);
    expect(funnel.note).toMatch(/not unique people/);
    expect(zonedDay(new Date("2026-10-02T20:30:00Z"), "Asia/Kolkata")).toBe("2026-10-03");
    expect(crmCoverage(1, 2).ratio).toBe(0.5);
  });

  it("guards spreadsheet formulas", () => {
    expect(toCsv([{ name: "=cmd()", phone: "+919845012345" }])).toContain(`"'=cmd()"`);
  });
});

describe("shared inference limit", () => {
  it("does not allow a second generation when concurrency is one", () => {
    expect(inferenceSlotAvailable(0, 1)).toBe(true);
    expect(inferenceSlotAvailable(1, 1)).toBe(false);
  });
});

describe("name capture", () => {
  it("keeps full names and initials and drops fillers and honorifics", () => {
    expect(cleanName("Karthikeyan R", "Karthikeyan R")).toBe("Karthikeyan R");
    expect(cleanName("gopi", "en peru gopi da")).toBe("Gopi");
    expect(cleanName("Rahul Sharma", "Mera naam Rahul Sharma hai")).toBe("Rahul Sharma");
    expect(cleanName("Gopi sir", "Gopi sir")).toBe("Gopi");
    expect(cleanName("my name is Priya", "my name is Priya")).toBe("Priya");
    expect(cleanName("K Mohan", "K. Mohan")).toBe("K Mohan");
    expect(cleanName("K", "K")).toBeNull();
  });

  it("rejects fillers, numbers and names that were never typed", () => {
    expect(cleanName("Areee", "Areee bhaiiii")).toBeNull();
    expect(cleanName("Enoda", "Enoda peru")).toBeNull();
    expect(cleanName("Suresh", "my name is Gopi")).toBeNull();
    expect(cleanName("Gopi 123", "Gopi 123")).toBeNull();
    expect(cleanName("Acha", "Achaaaa")).toBeNull();
    expect(cleanName(null, "anything")).toBeNull();
    expect(cleanName("Varun", "Hi Varun", "Varun")).toBeNull();
    expect(cleanName("Varun", "hello varun, I want a 3 bhk", "Varun")).toBeNull();
    expect(cleanName("Varun", "my name is Varun", "Varun")).toBe("Varun");
    expect(cleanName("Karthik", "Hi Varun, I am Karthik", "Varun")).toBe("Karthik");
    expect(greetedByName("Hi Varun", "Varun")).toBe(true);
    expect(greetedByName("my name is Varun", "Varun")).toBe(false);
  });
});

describe("lead form read by the model", () => {
  const questions = [
    { id: "person-name", label: "Person name", kind: "name" as const, zohoField: "Last_Name" },
    { id: "company-name", label: "Company name", kind: "text" as const, zohoField: "Company" },
    { id: "contact-number", label: "Contact number", kind: "phone" as const, zohoField: "Phone" },
    { id: "team", label: "Current telecaller team size", kind: "text" as const, zohoField: null },
    { id: "volume", label: "Monthly call volume", kind: "text" as const, zohoField: null },
    { id: "issue", label: "What is the issue, or why do you think AI calling may help?", kind: "text" as const, zohoField: null },
    { id: "demo", label: "Are you interested to attend the demo?", kind: "yesno" as const, zohoField: null },
  ];

  it("accepts values the customer typed, including short forms and number words", () => {
    const prospectText = "this is Priya from Glow Studio, we have 12 telecallers\naround 25k\n98450 12345\nYes iruku\nDho azar calls\nfollow ups get missed";
    const got = acceptExtractedAnswers({
      questions,
      raw: { "person-name": "Priya", "company-name": "Glow Studio", "contact-number": "98450 12345", team: 12, volume: 25000, issue: "follow ups get missed", demo: "yes" },
      prospectText,
    });
    expect(got).toEqual({
      name: "Priya",
      phoneE164: "+919845012345",
      answers: { "company-name": "Glow Studio", team: "12", volume: "25000", issue: "follow ups get missed", demo: "yes" },
      callbackTime: null,
    });
  });

  it("rejects anything the customer never typed", () => {
    const got = acceptExtractedAnswers({
      questions,
      raw: { "person-name": "Suresh", "company-name": "Acme Corp", "contact-number": "9876543210", team: 45, volume: 9999, issue: null, demo: "maybe" },
      prospectText: "my name is Gopi\nwe are a small shop\n8904887300",
    });
    expect(got).toEqual({ name: null, phoneE164: null, answers: {}, callbackTime: null });
  });

  it("keeps what they meant, and drops a place or a name they never said", () => {
    const questions = [
      { id: "possession", label: "When do you get possession, or is the home already ready?", kind: "text" as const, zohoField: null },
      { id: "place", label: "Where is the home?", kind: "text" as const, zohoField: null },
      { id: "person-name", label: "Person name", kind: "name" as const, zohoField: null },
    ];
    const meant = acceptExtractedAnswers({
      questions,
      raw: { possession: "under construction", place: "Whitefield", "person-name": "Rahul" },
      prospectText: "it is still in construction\n(Sent a photo. It shows: owner Rahul Sharma)",
    });
    expect(meant.answers.possession).toBe("under construction");
    expect(meant.answers.place).toBeUndefined();
    expect(meant.name).toBeNull();
    const respelt = acceptExtractedAnswers({
      questions,
      raw: { place: "HSR Layout, Bangalore, Puravankara Purva Meraki" },
      prospectText: "In banglore HSR LAYOUT\nIt is puravankara purva meraki project",
    });
    expect(respelt.answers.place).toBe("HSR Layout, Bangalore, Puravankara Purva Meraki");
    const otherCity = acceptExtractedAnswers({ questions, raw: { place: "Bengaluru, Whitefield" }, prospectText: "In banglore whitefeild" });
    expect(otherCity.answers.place).toBe("Bengaluru, Whitefield");
    const elsewhere = acceptExtractedAnswers({ questions, raw: { place: "HSR Layout, Prestige Lakeside" }, prospectText: "In banglore HSR LAYOUT" });
    expect(elsewhere.answers.place).toBeUndefined();
  });

  it("reads a bare budget range as lakhs and never takes a refusal as an answer", () => {
    const style = [{ id: "style", label: "Any style you love or must-haves?", kind: "text" as const, zohoField: null }];
    expect(acceptExtractedAnswers({ questions: style, raw: { style: "Not necessarily right now" }, prospectText: "Not necessarily right now" }).answers).toEqual({});
    expect(acceptExtractedAnswers({ questions: style, raw: { style: "no pooja space" }, prospectText: "no pooja space" }).answers).toEqual({ style: "no pooja space" });
  });

  it("reads a bare BHK number as BHK, and never treats an email question as a number", () => {
    const questions = [
      { id: "home", label: "What kind of home is it: apartment, villa or independent house, and how many BHK?", kind: "text" as const, zohoField: null },
      { id: "email", label: "Email for the team to share designs?", kind: "text" as const, zohoField: null },
    ];
    const read = acceptExtractedAnswers({ questions, raw: { home: "4", email: "4500000", _next: "email" }, prospectText: "it is apartment sir\n4\nbudget 45 lakh" });
    expect(read.answers).toEqual({ home: "4 BHK" });
    expect(read.next).toBe("email");
  });

  it("keeps the preferred call time only when they typed it", () => {
    const typed = acceptExtractedAnswers({ questions, raw: { "preferred-call-time": "Tom 2 pm" }, prospectText: "Tom 2 pm" });
    expect(typed.callbackTime).toBe("Tom 2 pm");
    const invented = acceptExtractedAnswers({ questions, raw: { "preferred-call-time": "Friday evening" }, prospectText: "yes iruku" });
    expect(invented.callbackTime).toBeNull();
  });
});

describe("name sanity", () => {
  it("flags a famous name as a likely joke", () => {
    expect(nameConcern("Kumar Vembu", ["Karthikeyan", "karthikeyansru"])).toEqual({ kind: "public_figure", name: "Kumar Vembu", who: "the Zoho co-founder" });
    expect(publicFigure("I am Elon Musk")).toBe("the Tesla CEO");
    expect(publicFigure("Kumar")).toBeNull();
  });

  it("accepts nicknames, partial names and small transcription slips", () => {
    expect(nameFitsProfile("Karthik", ["Karthikeyan", "karthikeyansru"])).toBe(true);
    expect(nameFitsProfile("Gopi", ["gopi.talks"])).toBe(true);
    expect(nameFitsProfile("Karthikeyan R", ["karthik_r"])).toBe(true);
    expect(nameFitsProfile("Jumar", ["Kumar S"])).toBe(true);
    expect(nameFitsProfile("Priya", [null, ""])).toBeNull();
  });

  it("asks once when the name clearly differs from the profile", () => {
    expect(nameConcern("Ramesh", ["Karthikeyan", "karthikeyansru"])).toEqual({ kind: "profile_mismatch", name: "Ramesh", profile: "Karthikeyan / karthikeyansru" });
    expect(nameConcern("Ramesh", [])).toBeNull();
    expect(nameConcern("Karthik", ["Karthikeyan"])).toBeNull();
    expect(nameConcern(null, ["Karthikeyan"])).toBeNull();
  });
});

describe("texting like a person", () => {
  it("drops commas and full stops, uses no short forms and joins short thoughts with dots", () => {
    expect(casualText("Okay sir, please type your number. I'm waiting! Don't worry, it's safe."))
      .toBe("ok sir please type your number...I'm waiting...don't worry it's safe");
    expect(casualText("Sure sir, 3:30 PM should be fine. Our agent handles 40,000 calls.")).toBe("sure sir 3:30 PM should be fine...our agent handles 40000 calls");
    expect(casualText("Hi sir. SnapServe can help you?", ["SnapServe"])).toBe("hi sir...SnapServe can help you?");
  });

  it("swaps chatbot praise for plain words", () => {
    expect(plainWords("Great sir! That's perfect. Absolutely, we can.")).toBe("ok sir! ok. sure, we can.");
  });

  it("waits longer for longer messages", () => {
    expect(readingMs("hi")).toBeLessThan(200);
    expect(readingMs("x".repeat(400))).toBe(7000);
    expect(typingMs("ok sir")).toBe(1200);
    expect(typingMs("x".repeat(400))).toBe(5000);
  });
});

describe("joke numbers and canned lines", () => {

  it("rejects a BHK no home has and keeps a normal one", () => {
    expect(impossibleBhk("it is a 100 bhk")).toBe(100);
    expect(impossibleBhk("I have 100 BSK house")).toBe(100);
    expect(impossibleBhk("3 BHK apartment")).toBeNull();
  });
});

describe("photos, videos and other attachments", () => {
  it("keeps WhatsApp photos with their media id and caption, and other media as kinds", () => {
    const events = normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "pnid-1" },
            contacts: [{ profile: { name: "Kishore" }, wa_id: "919845012345" }],
            messages: [
              { from: "919845012345", id: "wamid.p1", timestamp: "1759670000", type: "image", image: { id: "img-1", mime_type: "image/jpeg", caption: "our call log" } },
              { from: "919845012345", id: "wamid.p2", timestamp: "1759670010", type: "video", video: { id: "vid-1", mime_type: "video/mp4" } },
            ],
          },
        }],
      }],
    }, new Date("2026-10-05T00:00:00Z"));
    const messages = events.filter((event) => event.kind === "message");
    expect(messages[0]).toMatchObject({ text: "our call log", mediaKind: "image", imageMediaId: "img-1" });
    expect(messages[1]).toMatchObject({ text: "", mediaKind: "video", imageMediaId: null });
  });

  it("keeps Instagram photos and shared reels instead of dropping them", () => {
    const events = normalizeMetaPayload("INSTAGRAM", {
      object: "instagram",
      entry: [{
        id: "1784",
        messaging: [
          { sender: { id: "u1" }, recipient: { id: "1784" }, timestamp: 1759670000000, message: { mid: "m1", attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" } }] } },
          { sender: { id: "u1" }, recipient: { id: "1784" }, timestamp: 1759670010000, message: { mid: "m2", attachments: [{ type: "ig_reel", payload: { reel_video_id: "9" } }] } },
        ],
      }],
    }, new Date("2026-10-05T00:00:00Z"));
    const messages = events.filter((event) => event.kind === "message");
    expect(messages[0]).toMatchObject({ mediaKind: "image", imageUrl: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" });
    expect(messages[1]).toMatchObject({ mediaKind: "ig_reel", imageUrl: null });
  });

  it("writes a clear note for each kind", () => {
    expect(mediaNote("image", "A screenshot of a call log showing 40 missed calls.")).toBe("(Sent a photo. It shows: A screenshot of a call log showing 40 missed calls.)");
    expect(mediaNote("image", "")).toBe("(Sent a photo.)");
    expect(mediaNote("ig_reel")).toBe("(Shared a reel.)");
    expect(mediaNote("something_new")).toBe("(Sent an attachment.)");
    expect(documentNote("plan (A).pdf", { seen: "A 3 BHK floor plan (1,450 sq ft)." })).toBe("(Sent a document [plan A.pdf]. It shows: A 3 BHK floor plan 1,450 sq ft.)");
    expect(documentNote(null, { problem: "It could not be read." })).toBe("(Sent a document. It could not be read.)");
  });

  it("keeps every photo of a Messenger message and its PDF, and WhatsApp documents with their name", () => {
    const facebook = normalizeMetaPayload("FACEBOOK", {
      object: "page",
      entry: [{
        id: "page-1",
        messaging: [{
          sender: { id: "u1" },
          recipient: { id: "page-1" },
          timestamp: 1759670000000,
          message: {
            mid: "m1",
            attachments: [
              { type: "image", payload: { url: "https://lookaside.fbsbx.com/p/1.jpg" } },
              { type: "image", payload: { url: "https://lookaside.fbsbx.com/p/2.jpg" } },
              { type: "file", payload: { url: "https://cdn.fbsbx.com/v/t59/Floor%20Plan.pdf?_nc=1" } },
            ],
          },
        }],
      }],
    }, new Date("2026-10-05T00:00:00Z"));
    expect(facebook[0]).toMatchObject({
      mediaKind: "image",
      imageUrls: ["https://lookaside.fbsbx.com/p/1.jpg", "https://lookaside.fbsbx.com/p/2.jpg"],
      document: { url: "https://cdn.fbsbx.com/v/t59/Floor%20Plan.pdf?_nc=1", fileName: "Floor Plan.pdf" },
    });
    const whatsapp = normalizeMetaPayload("WHATSAPP", {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba-1",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "pnid-1" },
            messages: [{ from: "919845012345", id: "wamid.d1", timestamp: "1759670000", type: "document", document: { id: "doc-1", filename: "plan.pdf", mime_type: "application/pdf" } }],
          },
        }],
      }],
    }, new Date("2026-10-05T00:00:00Z"));
    expect(whatsapp[0]).toMatchObject({ mediaKind: "document", document: { mediaId: "doc-1", fileName: "plan.pdf", mimeType: "application/pdf" } });
  });
});
