import { NextRequest, NextResponse } from "next/server";
import { noStoreHeaders } from "../_shared/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const clientSecret = request.headers.get("x-client-secret")?.trim();
  const sdp = await request.text();

  if (!clientSecret || !sdp.trim()) {
    return NextResponse.json({ error: "Missing clientSecret or SDP offer." }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
      body: sdp,
    });

    const answer = await upstream.text();

    return new NextResponse(answer, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/sdp",
        ...noStoreHeaders,
      },
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? `Could not reach OpenAI Realtime Translation calls endpoint: ${caughtError.message}`
            : "Could not reach OpenAI Realtime Translation calls endpoint.",
      },
      { status: 502, headers: noStoreHeaders }
    );
  }
}
