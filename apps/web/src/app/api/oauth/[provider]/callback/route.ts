import { createHash } from "node:crypto";
import { getPrisma } from "@snapsocial/db";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const record = await getPrisma().oauthState.findUnique({ where: { stateHash: createHash("sha256").update(state).digest("hex") } });
  if (!record || record.usedAt || record.expiresAt < new Date() || record.provider !== provider) {
    return Response.json({ error: "OAuth state is missing or expired." }, { status: 400 });
  }
  await getPrisma().oauthState.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  if (!url.searchParams.get("code")) return Response.json({ pending: true, reason: "The provider did not return an authorization code." }, { status: 400 });
  return Response.json({
    pending: true,
    provider,
    workspaceId: record.workspaceId,
    reason: "The authorization code was received with a bound state. Token exchange stays pending until the app secret and a controlled account test are configured. This is not a live connection.",
  });
}
