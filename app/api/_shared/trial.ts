import { createHmac, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";
import type { TrialDenyReason } from "../../../lib/trial";
import { getClientIdentity } from "./identity";

// Trial gate for the no-key Soniox path. Four checks run in order: feature
// switch, Origin allowlist, per-client quota (signed cookie + Redis), and the
// global daily budget. Every ambiguous case fails closed: a broken cookie, a
// Redis timeout, or a misconfigured "full" mode denies the trial instead of
// risking unmetered spend on the server key.

export type { TrialDenyReason };

export type TrialDecision =
  | { allowed: true; setCookie: string }
  | { allowed: false; reason: TrialDenyReason };

const TRIAL_COOKIE_NAME = "trial_quota";
const TRIAL_COOKIE_MAX_AGE_SECONDS = 86400;
const REDIS_TIMEOUT_MS = 1500;
const CLIENT_KEY_TTL_SECONDS = 86400;
const GLOBAL_KEY_TTL_SECONDS = 172800;

const DEFAULT_TRIAL_SECONDS = 180;
const DEFAULT_PER_CLIENT_PER_DAY = 2;
const DEFAULT_GLOBAL_PER_DAY = 100;

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTrialSeconds() {
  return readPositiveInt(process.env.TRIAL_SECONDS, DEFAULT_TRIAL_SECONDS);
}

// "full" requires both Upstash variables; without them the trial is disabled
// rather than silently dropping the global budget. Operators who accept the
// weaker guarantee opt in explicitly with TRIAL_ENABLED=cookie-only.
function resolveTrialMode(): "full" | "cookie-only" | null {
  const raw = (process.env.TRIAL_ENABLED ?? "off").trim().toLowerCase();
  if (raw === "cookie-only") return "cookie-only";
  if (raw === "full" && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return "full";
  }
  return null;
}

// UTC day everywhere so quota windows cannot be shifted by client time zones.
function getUtcDay() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function getCookieSecret() {
  return process.env.SAFETY_SALT ?? "simple-realtime-translator";
}

function signCookiePayload(payload: string) {
  return createHmac("sha256", getCookieSecret()).update(payload).digest("base64url");
}

function encodeTrialCookie(day: string, count: number) {
  const payload = Buffer.from(JSON.stringify({ day, count })).toString("base64url");
  return `${payload}.${signCookiePayload(payload)}`;
}

function decodeTrialCookieCount(value: string | undefined, today: string) {
  if (!value) return 0;

  const [payload, signature] = value.split(".");
  if (!payload || !signature) return 0;

  const expected = signCookiePayload(payload);
  if (expected.length !== signature.length) return 0;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return 0;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.day !== today) return 0;
    const count = parsed.count;
    return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : 0;
  } catch {
    return 0;
  }
}

function getRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) return origin;

  const referer = request.headers.get("referer");
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function isOriginAllowed(request: NextRequest) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (!allowedOrigins.length) return true;

  const origin = getRequestOrigin(request);
  return origin !== null && allowedOrigins.includes(origin);
}

function withTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Redis request timed out.")), REDIS_TIMEOUT_MS);
    }),
  ]);
}

// INCR before judging: an over-limit increment is never rolled back, so a
// race between concurrent requests can only over-count, never under-count.
async function incrementWithTtl(redis: Redis, key: string, ttlSeconds: number) {
  const count = await withTimeout(redis.incr(key));
  if (count === 1) {
    await withTimeout(redis.expire(key, ttlSeconds));
  }
  return count;
}

function buildTrialCookie(day: string, count: number) {
  return [
    `${TRIAL_COOKIE_NAME}=${encodeTrialCookie(day, count)}`,
    "Path=/",
    `Max-Age=${TRIAL_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export async function checkAndConsumeTrial(request: NextRequest): Promise<TrialDecision> {
  const mode = resolveTrialMode();
  if (!mode) return { allowed: false, reason: "disabled" };

  if (!isOriginAllowed(request)) return { allowed: false, reason: "origin_denied" };

  const today = getUtcDay();
  const perClientLimit = readPositiveInt(process.env.TRIAL_PER_CLIENT_PER_DAY, DEFAULT_PER_CLIENT_PER_DAY);
  const globalLimit = readPositiveInt(process.env.TRIAL_GLOBAL_PER_DAY, DEFAULT_GLOBAL_PER_DAY);

  const cookieCount = decodeTrialCookieCount(request.cookies.get(TRIAL_COOKIE_NAME)?.value, today);
  if (cookieCount >= perClientLimit) return { allowed: false, reason: "client_exhausted" };

  if (mode === "full") {
    try {
      const redis = Redis.fromEnv();

      const clientKey = `trial:client:${getClientIdentity(request)}:${today}`;
      const clientCount = await incrementWithTtl(redis, clientKey, CLIENT_KEY_TTL_SECONDS);
      if (clientCount > perClientLimit) return { allowed: false, reason: "client_exhausted" };

      const globalCount = await incrementWithTtl(redis, `trial:global:${today}`, GLOBAL_KEY_TTL_SECONDS);
      if (globalCount > globalLimit) return { allowed: false, reason: "global_exhausted" };
    } catch {
      return { allowed: false, reason: "client_exhausted" };
    }
  }

  return { allowed: true, setCookie: buildTrialCookie(today, cookieCount + 1) };
}
