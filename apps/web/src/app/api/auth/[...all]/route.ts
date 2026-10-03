import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

const handler = toNextJsHandler(auth);

async function guarded(request: Request, method: "GET" | "POST") {
  const url = new URL(request.url);
  if (url.pathname.includes("/sign-up")) return new Response("Public signup is disabled.", { status: 403 });
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  if (!rateLimit(`auth:${ip}`, 20, 60_000)) return new Response("Too many requests.", { status: 429 });
  return method === "GET" ? handler.GET(request) : handler.POST(request);
}

export function GET(request: Request) { return guarded(request, "GET"); }
export function POST(request: Request) { return guarded(request, "POST"); }
