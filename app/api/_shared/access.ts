import { NextRequest } from "next/server";

export function denyWithoutAccessCode(_request: NextRequest) {
  return null;
}

export const noStoreHeaders = {
  "Cache-Control": "no-store",
};
