import { createHash } from "crypto";
import { NextRequest } from "next/server";

// Stable, salted per-client hash used as the OpenAI safety identifier and
// the Soniox client reference id. Never reversible to the raw IP/UA.
export function getClientIdentity(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.SAFETY_SALT ?? "simple-realtime-translator";

  return createHash("sha256")
    .update(`${salt}:${forwardedFor ?? "anonymous"}:${userAgent}`)
    .digest("hex")
    .slice(0, 64);
}
