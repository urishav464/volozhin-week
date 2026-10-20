// A request that never got an answer — no connection, DNS, a dropped socket — as opposed to an answer that refused.
// Only the first may fall back to the device's snapshot (src/offline/snapshot.ts): a refusal (not a member, a stale
// schema, a revoked session) never shows what the device kept.
import { PortError } from "../data/types";

/** PortError's code for «no answer from the server». */
export const NETWORK = "network";

export function isNetworkError(e: unknown): boolean {
  if (e instanceof PortError) return e.code === NETWORK;
  // fetch's own rejection: Chromium «Failed to fetch», Firefox «NetworkError when attempting…», Safari «Load failed»
  return e instanceof TypeError && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message);
}

/** A supabase-js answer's error as a PortError: status 0 is postgrest-js's «the fetch itself failed». */
export function portError(error: { code?: string | null; message: string }, status: number): PortError {
  return new PortError(status === 0 ? NETWORK : (error.code ?? null), error.message);
}
