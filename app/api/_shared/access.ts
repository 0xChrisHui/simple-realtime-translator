import { NextRequest, NextResponse } from "next/server";

export function denyWithoutAccessCode(request: NextRequest) {
  const requiredAccessCode = process.env.ACCESS_CODE?.trim();
  if (!requiredAccessCode) return null;

  const providedAccessCode = request.headers.get("x-access-code")?.trim();
  if (providedAccessCode === requiredAccessCode) return null;

  return NextResponse.json(
    { error: "Access code required." },
    {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    }
  );
}

export const noStoreHeaders = {
  "Cache-Control": "no-store",
};
