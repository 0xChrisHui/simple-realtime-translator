import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders } from "../_shared/http";
import { getClientIdentity } from "../_shared/identity";

export const runtime = "nodejs";

type SessionRequest = {
  openaiApiKey?: string;
  targetLanguage?: string;
};

const ALLOWED_TARGET_LANGUAGES = new Set(["en", "zh", "es", "fr", "de", "it", "pt", "ja", "ko"]);

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "This endpoint is used by the translator app with POST. Open the site root for the UI.",
  });
}

export async function POST(request: NextRequest) {
  let body: SessionRequest = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const apiKey = typeof body.openaiApiKey === "string" ? body.openaiApiKey.trim() : "";

  if (!apiKey) {
    return NextResponse.json(
      { error: "Enter your OpenAI API key in the app." },
      { status: 400, headers: noStoreHeaders }
    );
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
      "OpenAI-Safety-Identifier": getClientIdentity(request),
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
