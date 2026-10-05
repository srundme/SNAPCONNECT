import { getPrisma } from "@snapsocial/db";

export const dynamic = "force-dynamic";

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(_request: Request, context: { params: Promise<{ clip: string }> }) {
  const { clip } = await context.params;
  const id = clip.replace(/\.(mp3|wav)$/, "");
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const found = await getPrisma().voiceClip.findUnique({ where: { id } });
  if (!found || Date.now() - found.createdAt.getTime() > MAX_AGE_MS) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(found.data), {
    headers: {
      "content-type": found.mimeType,
      "content-length": String(found.data.byteLength),
      "cache-control": "private, max-age=3600",
      "x-robots-tag": "noindex",
    },
  });
}
