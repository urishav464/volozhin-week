// Links without an account (DESIGN «גישה בלי חשבון», schema v9): an escort's
// link, the class's sign-up link for מכריכה לכריכה, and the schedule link. An
// edition's admins issue them (`port.links`); whoever holds one opens a public
// page that reads only through the anon functions (`PublicPort`,
// src/data/publicPort.ts). The token travels after '#' — never in the path or
// the query, so it reaches no log and no Referer — and the database keeps only
// its sha256. The rules here are the database's own (supabase/schema.sql
// «Milestone 5a»: app.link_expiry, app.link_rate), held equal by tests/parity.
import { addDays, israelMidnight } from "../domain/israelTime";
import type { Edition } from "../domain/types";

export type LinkScope = "escort" | "kk_signup" | "schedule";
export const LINK_SCOPES: readonly LinkScope[] = ["escort", "kk_signup", "schedule"];

/** A link as its edition's admins see it — never the token, never its hash. */
export interface ShareLink {
  id: number;
  scope: LinkScope;
  /** The escort (a roster id) for an escort's link; null otherwise. */
  subject_id: number | null;
  created_by: number | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/** What issuing answers — the only time the token is ever seen. */
export interface IssuedLink {
  link_id: number;
  token: string;
  expires_at: string;
}

export interface LinksPort {
  /** The edition's links, newest first (its admins; anyone else gets none). */
  list(editionId: number): Promise<ShareLink[]>;
  /** A new link — the live one of the same subject is revoked (replace). The token comes back once. */
  issue(editionId: number, scope: LinkScope, subjectId?: number | null): Promise<IssuedLink>;
  revoke(linkId: number): Promise<void>;
}

/** Where each link opens: /e#<token>, /k#<token>, /s#<token>. */
export const LINK_PATH: Record<LinkScope, string> = { escort: "/e", kk_signup: "/k", schedule: "/s" };

export function linkUrl(origin: string, scope: LinkScope, token: string): string {
  return `${origin}${LINK_PATH[scope]}#${token}`;
}

export type LinkState = "live" | "expired" | "revoked";

export function linkState(l: Pick<ShareLink, "expires_at" | "revoked_at">, now = new Date().toISOString()): LinkState {
  if (l.revoked_at != null) return "revoked";
  return Date.parse(l.expires_at) <= Date.parse(now) ? "expired" : "live";
}

/** 30 days, in hours (the database adds `720 hours`, whatever the clock zone). */
export const TBD_LINK_MS = 720 * 3_600_000;

/**
 * When a link stops working («הצעה»): an escort's and the schedule's at the end of the week (Friday 00:00 Israel
 * time — start_date + 5), or 30 days after issue while the date is TBD; the sign-up link when its window closes (no
 * window: 30 days). app.link_expiry.
 */
export function linkExpiry(edition: Pick<Edition, "start_date" | "settings">, scope: LinkScope, createdAt: string): string {
  const fallback = new Date(Date.parse(createdAt) + TBD_LINK_MS).toISOString();
  if (scope === "kk_signup") return edition.settings?.kk_window?.closes_at ?? fallback;
  return edition.start_date ? israelMidnight(addDays(edition.start_date, 5)) : fallback;
}

/**
 * Calls a link may make in RATE_WINDOW_MS («הצעה»), app.link_rate: an escort's link is one person's, counted as one; a
 * class link (the sign-up, the schedule) is counted per caller's address (`linkClient`) — never one count the whole
 * class shares, which one holder could use up for everyone.
 */
export function linkRate(scope: LinkScope): number {
  return scope === "escort" ? 60 : 1200;
}

/** Whose count a call is (app.link_client): one for an escort's link; per caller's address ("" when none was reported) for a class link. */
export function linkClient(scope: LinkScope, address: string | undefined): string {
  return scope === "escort" ? "" : `@${address?.trim() ?? ""}`;
}
export const RATE_WINDOW_MS = 10 * 60_000;

/** The token's shape the database accepts at all (16–64 characters); anything else is `link_invalid` at once. */
export function tokenShape(token: unknown): token is string {
  return typeof token === "string" && [...token].length >= 16 && [...token].length <= 64;
}

/** 128 random bits, base64url — what public.issue_link makes (extensions.gen_random_bytes(16)). */
export function randomToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
