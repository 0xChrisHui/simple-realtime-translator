import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { denyWithoutAccessCode, noStoreHeaders } from "../_shared/access";

export const runtime = "nodejs";

type SessionRequest = {
  targetLanguage?: string;
};

const ALLOWED_TARGET_LANGUAGES = new Set(["en", "zh", "es", "fr", "de", "it", "pt", "ja", "ko"]);

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Open http://localhost:3001 for the translator UI. This endpoint is used by the app with POST.",
  });
}

function getSafetyIdentifier(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.SAFETY_SALT ?? "simple-realtime-translator";
  return createHash("sha256")
    .update(`${salt}:${forwardedFor ?? "anonymous"}:${userAgent}`)
    .digest("hex")
    .slice(0, 64);
}

export async function POST(request: NextRequest) {
  const accessDenied = denyWithoutAccessCode(request);
  if (accessDenied) return accessDenied;

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY. Add it in Vercel Project Settings > Environment Variables." },
      { status: 500, headers: noStoreHeaders }
    );
  }

  let body: SessionRequest = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const targetLanguage = body.targetLanguage ?? "zh";

  if (!ALLOWED_TARGET_LANGUAGES.has(targetLanguage)) {
    return NextResponse.json({ error: "Unsupported targetLanguage." }, { status: 400, headers: noStoreHeaders });
  }

  const upstream = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": getSafetyIdentifier(request),
    },
    body: JSON.stringify({
      session: {
        model: "gpt-realtime-translate",
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            noise_reduction: { type: "near_field" },
          },
          output: {
            language: targetLanguage,
          },
        },
      },
    }),
  });

  const text = await upstream.text();

  try {
    return NextResponse.json(JSON.parse(text), { status: upstream.status, headers: noStoreHeaders });
  } catch {
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "text/plain", ...noStoreHeaders },
    });
  }
}
