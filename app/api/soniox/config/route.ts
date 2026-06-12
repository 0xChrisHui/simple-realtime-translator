import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders } from "../../_shared/http";
import { getClientIdentity } from "../../_shared/identity";
import { checkAndConsumeTrial, getTrialSeconds, type TrialDenyReason } from "../../_shared/trial";

export const runtime = "nodejs";

type SonioxConfigRequest = {
  sonioxApiKey?: string;
  keyCount?: number;
};

const TEMPORARY_KEY_EXPIRES_IN_SECONDS = 60;
const TEMPORARY_KEY_SINGLE_USE = true;
const TEMPORARY_KEY_MAX_SESSION_DURATION_SECONDS = 18000;
// Split view runs one one-way translation stream per language, so a single
// gated request may mint up to two keys. The trial quota counts requests,
// not keys: one Start consumes one trial slot regardless of view.
const MAX_KEYS_PER_REQUEST = 2;

const TRIAL_DENY_MESSAGES: Record<TrialDenyReason, string> = {
  disabled: "The free trial is not enabled on this deployment. Enter your own Soniox API key.",
  origin_denied: "This origin is not allowed to use the free trial.",
  client_exhausted: "Today's free trials are used up for this device. Enter your own Soniox API key or come back tomorrow.",
  global_exhausted: "Today's free trial budget is used up. Enter your own Soniox API key or come back tomorrow.",
};

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

type TemporaryKeyOptions = {
  keyCount: number;
  maxSessionDurationSeconds: number;
  trial?: { seconds: number; setCookie: string };
};

type MintResult =
  | { ok: true; apiKey: string; expiresAt: string | null; status: number }
  | { ok: false; response: NextResponse };

async function mintTemporaryKey(apiKey: string, request: NextRequest, maxSessionDurationSeconds: number): Promise<MintResult> {
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
        max_session_duration_seconds: maxSessionDurationSeconds,
        client_reference_id: getClientIdentity(request),
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
      return {
        ok: false,
        response: NextResponse.json(
          { error: getSonioxErrorMessage(data, text || "Failed to create Soniox temporary key.") },
          { status: upstream.status, headers: noStoreHeaders }
        ),
      };
    }

    const responseData = data as Record<string, unknown>;
    if (typeof responseData.api_key !== "string") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Soniox temporary key response did not include api_key." },
          { status: 502, headers: noStoreHeaders }
        ),
      };
    }

    return {
      ok: true,
      apiKey: responseData.api_key,
      expiresAt: typeof responseData.expires_at === "string" ? responseData.expires_at : null,
      status: upstream.status,
    };
  } catch (caughtError) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            caughtError instanceof Error
              ? `Could not reach Soniox temporary key endpoint: ${caughtError.message}`
              : "Could not reach Soniox temporary key endpoint.",
        },
        { status: 502, headers: noStoreHeaders }
      ),
    };
  }
}

async function createTemporaryKeys(apiKey: string, request: NextRequest, options: TemporaryKeyOptions) {
  const responseHeaders: Record<string, string> = options.trial
    ? { ...noStoreHeaders, "Set-Cookie": options.trial.setCookie }
    : noStoreHeaders;

  const results = await Promise.all(
    Array.from({ length: options.keyCount }, () => mintTemporaryKey(apiKey, request, options.maxSessionDurationSeconds))
  );

  const failure = results.find((result): result is Extract<MintResult, { ok: false }> => !result.ok);
  if (failure) return failure.response;

  const minted = results as Array<Extract<MintResult, { ok: true }>>;

  return NextResponse.json(
    {
      api_key: minted[0].apiKey,
      api_keys: minted.map((result) => result.apiKey),
      expires_at: minted[0].expiresAt,
      max_session_duration_seconds: options.maxSessionDurationSeconds,
      ...(options.trial ? { trial: true, trial_seconds: options.trial.seconds } : {}),
    },
    { status: minted[0].status, headers: responseHeaders }
  );
}

export async function POST(request: NextRequest) {
  let body: SonioxConfigRequest = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestApiKey = typeof body.sonioxApiKey === "string" ? body.sonioxApiKey.trim() : "";
  const keyCount =
    typeof body.keyCount === "number" && Number.isInteger(body.keyCount)
      ? Math.min(Math.max(body.keyCount, 1), MAX_KEYS_PER_REQUEST)
      : 1;

  // BYOK path: the user's own key, full-length sessions, no quota.
  if (requestApiKey) {
    return createTemporaryKeys(requestApiKey, request, {
      keyCount,
      maxSessionDurationSeconds: TEMPORARY_KEY_MAX_SESSION_DURATION_SECONDS,
    });
  }

  // Trial path: the server key is only ever exposed behind the trial gate.
  const decision = await checkAndConsumeTrial(request);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: TRIAL_DENY_MESSAGES[decision.reason], reason: decision.reason },
      { status: 403, headers: noStoreHeaders }
    );
  }

  const serverApiKey = process.env.SONIOX_API_KEY;
  if (!serverApiKey) {
    return NextResponse.json(
      { error: "Enter a Soniox API key in the app, or set SONIOX_API_KEY on the server." },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const trialSeconds = getTrialSeconds();
  return createTemporaryKeys(serverApiKey, request, {
    keyCount,
    maxSessionDurationSeconds: trialSeconds,
    trial: { seconds: trialSeconds, setCookie: decision.setCookie },
  });
}
