// What both ports check before a settings write, so the demo refuses exactly
// what the real database (or the browser, before it) would — with the same
// code, and the same Hebrew from src/errors.ts.
import { CommandError } from "../data/commands";
import type { EditionPatch, NewEdition, NewMember } from "../data/settings";
import type { Gender } from "../domain/types";
import { normalizeEmail } from "./email";

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** A required name: trimmed, single-spaced, not empty. */
export function cleanName(s: string | null | undefined, max = 120): string {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  if (!v) fail("name_required");
  if (v.length > max) fail("bad_value");
  return v;
}

export function cleanGender(g: string | null | undefined): Gender | null {
  if (g == null || g === "") return null;
  if (g !== "m" && g !== "f") fail("bad_value");
  return g as Gender;
}

export function cleanNewMember(m: NewMember): NewMember {
  const email = normalizeEmail(m.email) ?? fail("bad_email");
  if (!["admin", "content", "logistics"].includes(m.role)) fail("bad_value");
  return { email, display_name: cleanName(m.display_name, 80), gender: cleanGender(m.gender), role: m.role, edition_id: m.edition_id };
}

/** The week opens on a Sunday (DESIGN: ראשון עד חמישי). */
export function isSunday(isoDate: string): boolean {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 0;
}

export function cleanEditionPatch(p: EditionPatch): EditionPatch {
  const out: EditionPatch = {};
  if ("start_date" in p) {
    const d = p.start_date || null;
    if (d != null && !isSunday(d)) fail("not_sunday");
    out.start_date = d;
  }
  if ("first_day_from" in p) {
    const t = p.first_day_from ?? null;
    if (t != null && !(Number.isInteger(t) && t >= 390 && t <= 1435)) fail("bad_time");
    out.first_day_from = t;
  }
  return out;
}

export function cleanNewEdition(e: NewEdition): NewEdition {
  const label = (e.label ?? "").trim();
  if (!label) fail("label_required");
  const rest = cleanEditionPatch({ start_date: e.start_date, first_day_from: e.first_day_from });
  return { label, start_date: rest.start_date ?? null, first_day_from: rest.first_day_from ?? null };
}

export function cleanColor(c: string): string {
  const v = c.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(v)) fail("bad_color");
  return v;
}
