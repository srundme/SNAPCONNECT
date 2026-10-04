import type { Db } from "./client";

export const DEMO_SLUG = "demo-interiors";
export const OWN_SLUG = "own-accounts";
export const IG_ACCOUNT = "17841405880000001";
export const FB_PAGE = "100860000000001";
export const SHARED_COMMENT = "shared-native-id-42";

const opening =
  "Hi! I'm the virtual assistant for Demo Interiors. Thanks for your interest. Are you planning interiors for a home or a commercial space?";

export async function seedDemo(db: Db): Promise<{ workspaceId: string; ownWorkspaceId: string; instagramId: string; facebookId: string }> {
  await db.platformSetting.upsert({
    where: { id: "platform" },
    update: {},
    create: { id: "platform", productName: process.env.PRODUCT_NAME || "SnapServe Social" },
  });
  await db.inferenceLease.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
  const workspace = await db.workspace.upsert({
    where: { slug: DEMO_SLUG },
    update: {},
    create: {
      name: "Demo Interiors",
      slug: DEMO_SLUG,
      mode: "SIMULATION",
      brandName: "Demo Interiors",
      services: "Home and commercial interior design",
      faqs: [{ question: "Which cities do you cover?", answer: "The demo workspace has no service-area restriction." }],
    },
  });
  const own = await db.workspace.upsert({
    where: { slug: OWN_SLUG },
    update: {},
    create: {
      name: "Own accounts",
      slug: OWN_SLUG,
      mode: "INTEGRATION",
      automationPaused: true,
      brandName: "Demo Interiors",
    },
  });
  const instagram = await db.channelConnection.upsert({
    where: { channel_mode_externalAccountId: { channel: "INSTAGRAM", mode: "SIMULATION", externalAccountId: IG_ACCOUNT } },
    update: {},
    create: {
      workspaceId: workspace.id,
      channel: "INSTAGRAM",
      mode: "SIMULATION",
      externalAccountId: IG_ACCOUNT,
      displayName: "Demo Interiors Instagram",
      username: "demo_interiors",
      automationPaused: false,
      scopes: ["instagram_business_basic", "instagram_business_manage_comments", "instagram_business_manage_messages"],
    },
  });
  const facebook = await db.channelConnection.upsert({
    where: { channel_mode_externalAccountId: { channel: "FACEBOOK", mode: "SIMULATION", externalAccountId: FB_PAGE } },
    update: {},
    create: {
      workspaceId: workspace.id,
      channel: "FACEBOOK",
      mode: "SIMULATION",
      externalAccountId: FB_PAGE,
      displayName: "Demo Interiors Page",
      automationPaused: false,
      scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging", "pages_read_user_content"],
      pageTasks: ["MESSAGING", "MODERATE", "CREATE_CONTENT"],
    },
  });
  await db.zohoConnection.upsert({
    where: { workspaceId: workspace.id },
    update: {},
    create: {
      workspaceId: workspace.id,
      mode: "SIMULATION",
      externalKeyField: "External_Lead_Key",
      instagramSource: "Instagram",
      facebookSource: "Facebook",
    },
  });
  for (const [connection, externalId, caption] of [
    [instagram.id, "media-ig-1", "Kitchen stories"],
    [facebook.id, "100860000000001_9001", "Page post"],
  ] as const) {
    const channel = connection === instagram.id ? "INSTAGRAM" : "FACEBOOK";
    await db.media.upsert({
      where: { connectionId_externalId: { connectionId: connection, externalId } },
      update: {},
      create: { workspaceId: workspace.id, connectionId: connection, channel, externalId, contentType: "POST", caption },
    });
  }
  const activatedAt = new Date("2026-10-01T00:00:00Z");
  for (const connection of [instagram, facebook]) {
    const existing = await db.triggerRule.findFirst({ where: { connectionId: connection.id, name: "All posts keywords" } });
    if (!existing) {
      await db.triggerRule.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          name: "All posts keywords",
          priority: 10,
          coverage: "ALL_POSTS",
          commentFilter: "KEYWORDS",
          keywords: ["interiors", "quote", "design"],
          exclusions: ["job"],
          openingTemplate: opening,
          active: true,
          activatedAt,
        },
      });
    }
  }
  await db.aiConfigVersion.upsert({
    where: { workspaceId_version: { workspaceId: workspace.id, version: 1 } },
    update: {},
    create: {
      workspaceId: workspace.id,
      version: 1,
      active: true,
      profile: { brandName: "Demo Interiors", model: process.env.LLM_MODEL || "qwen3.5:2b" },
    },
  });
  return { workspaceId: workspace.id, ownWorkspaceId: own.id, instagramId: instagram.id, facebookId: facebook.id };
}
