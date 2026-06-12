// Shared trial-path vocabulary used by both the API routes and the browser.

export const TRIAL_DENY_REASONS = ["disabled", "origin_denied", "client_exhausted", "global_exhausted"] as const;
export type TrialDenyReason = (typeof TRIAL_DENY_REASONS)[number];

export function isTrialDenyReason(value: unknown): value is TrialDenyReason {
  return typeof value === "string" && (TRIAL_DENY_REASONS as readonly string[]).includes(value);
}

// Used only when the server response omits trial_seconds; the server enforces
// the real limit through the temporary key regardless of what we show.
export const FALLBACK_TRIAL_SECONDS = 180;

export class TrialDeniedError extends Error {
  readonly reason: TrialDenyReason;

  constructor(reason: TrialDenyReason, message: string) {
    super(message);
    this.name = "TrialDeniedError";
    this.reason = reason;
  }
}

// Thrown when a trial session tries to reconnect: letting auto_reconnect
// proceed would silently consume another trial slot.
export class TrialSessionEndedError extends Error {
  constructor() {
    super("Trial session ended.");
    this.name = "TrialSessionEndedError";
  }
}

export function formatTrialCountdown(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
