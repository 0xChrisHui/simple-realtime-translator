import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { denyWithoutAccessCode, noStoreHeaders } from "../../_shared/access";

export const runtime = "nodejs";

type SonioxConfigRequest = {
  sonioxApiKey?: string;
};

const TEMPORARY_KEY_EXPIRES_IN_SECONDS = 60;
const TEMPORARY_KEY_SINGLE_USE = true;
const TEMPORARY_KEY_MAX_SESSION_DURATION_SECONDS = 18000;

function getClientReferenceId(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.SAFETY_SALT ?? "simple-realtime-translator";

  return createHash("sha256")
    .update(`${salt}:${forwardedFor ?? "anonymous"}:${userAgent}`)
    .digest("hex")
    .slice(0, 64);
}

function getSonioxErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;

  const record = data as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;

  const error = record.error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }

  return fallback;
}

export async function POST(request: NextRequest) {
  const accessDenied = denyWithoutAccessCode(request);
  if (accessDenied) return accessDenied;

  let body: SonioxConfigRequest = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestApiKey = typeof body.sonioxApiKey === "string" ? body.sonioxApiKey.trim() : "";
  const apiKey = requestApiKey || process.env.SONIOX_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Enter a Soniox API key in the app, or set SONIOX_API_KEY on the server." },
      { status: 400, headers: noStoreHeaders }
    );
  }

  try {
    const upstream = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usage_type: "transcribe_websocket",
        expires_in_seconds: TEMPORARY_KEY_EXPIRES_IN_SECONDS,
        single_use: TEMPORARY_KEY_SINGLE_USE,
        max_session_duration_seconds: TEMPORARY_KEY_MAX_SESSION_DURATION_SECONDS,
        client_reference_id: getClientReferenceId(request),
      }),
    });

    const text = await upstream.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: getSonioxErrorMessage(data, text || "Failed to create Soniox temporary key.") },
        { status: upstream.status, headers: noStoreHeaders }
      );
    }

    const responseData = data as Record<string, unknown>;
    if (typeof responseData.api_key !== "string") {
      return NextResponse.json(
        { error: "Soniox temporary key response did not include api_key." },
        { status: 502, headers: noStoreHeaders }
      );
    }

    return NextResponse.json(
      {
        api_key: responseData.api_key,
        expires_at: typeof responseData.expires_at === "string" ? responseData.expires_at : null,
        max_session_duration_seconds: TEMPORARY_KEY_MAX_SESSION_DURATION_SECONDS,
      },
      { status: upstream.status, headers: noStoreHeaders }
    );
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? `Could not reach Soniox temporary key endpoint: ${caughtError.message}`
            : "Could not reach Soniox temporary key endpoint.",
      },
      { status: 502, headers: noStoreHeaders }
    );
  }
}
