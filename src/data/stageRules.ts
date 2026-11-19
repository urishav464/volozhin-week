// What a lesson's stages accept, in the browser — payment, transport, sources,
// escorts, the template and the duty phrases (milestone 3): the same cleaning,
// limits and refusal codes as the database (app.pick_url,
// app.clean_duty_phrases and the checks inside set_payment, set_sources,
// set_transport_details … in supabase/schema.sql «Milestone 3»), so the demo
// (src/data/engine.ts) refuses exactly what production refuses — tests/parity
// runs the same inputs through both.
import type { DutyPhrase, DutyWhen, PrintWhen, SourcesKind, Transport, TransportDetails } from "../domain/types";
import { CommandError, type TransportDriverPatch, type TransportRequestPatch } from "./commands";
import { cleanLine, cleanPhone } from "./speakerRules";

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** Characters (code points), as the database counts them. */
export const STAGE_LIMITS = {
  /** Whole shekels. A guard against a typo (an extra zero), «הצעה» — not a budget. */
  amount_max: 100_000,
  decision_note: 300,
  escort_note: 300,
  sources_note: 500,
  url: 500,
  template: 4000,
  duty_text: 200,
  duty_count: 30,
  pickup_address: 200,
  pickup_time: 60,
  driver_name: 80,
  /** v18: transport_details.pickup_min — minutes from 00:00 of the lesson's grid day, 0 … 1830. */
  pickup_min_max: 1830,
} as const;

export const TRANSPORTS: readonly Transport[] = ["none", "one_way", "round_trip"];
export const SOURCES_KINDS: readonly SourcesKind[] = ["pending", "sheet", "presentation", "sheet_presentation", "sheet_video", "none", "other"];
export const PRINT_WHENS: readonly PrintWhen[] = ["none", "before", "same_day"];
export const DUTY_WHENS: readonly DutyWhen[] = ["always", "self_intro", "escort_intro", "transport", "memorial"];

/** Whole shekels 1…amount_max, or null (none asked). Never a default. */
export function cleanAmount(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > STAGE_LIMITS.amount_max) fail("bad_amount");
  return v as number;
}

export function pickTransport(v: unknown): Transport {
  if (typeof v !== "string" || !TRANSPORTS.includes(v as Transport)) fail("bad_value");
  return v as Transport;
}

export function pickSourcesKind(v: unknown): SourcesKind {
  if (typeof v !== "string" || !SOURCES_KINDS.includes(v as SourcesKind)) fail("bad_value");
  return v as SourcesKind;
}

export function pickPrintWhen(v: unknown): PrintWhen {
  if (typeof v !== "string" || !PRINT_WHENS.includes(v as PrintWhen)) fail("bad_value");
  return v as PrintWhen;
}

/** A presentation link: http:// or https:// and no space, at most 500 characters (app.pick_url). */
export function cleanUrl(v: string | null | undefined): string | null {
  const u = cleanLine(v, STAGE_LIMITS.url);
  if (u != null && !/^https?:\/\/[^ ]+$/i.test(u)) fail("bad_url");
  return u;
}

/** A kind with something to print can go into the reader; pending, none and a presentation never do. */
export function readerKind(kind: SourcesKind): boolean {
  return kind !== "pending" && kind !== "none" && kind !== "presentation";
}

/** app.clean_duty_phrases: {when, text} objects; empty texts and repeats dropped (the first kept); at most 30. */
export function cleanDutyPhrases(v: unknown): DutyPhrase[] {
  if (v == null) return [];
  if (!Array.isArray(v)) fail("bad_value");
  const out: DutyPhrase[] = [];
  for (const e of v as unknown[]) {
    const o = e as { when?: unknown; text?: unknown } | null;
    if (typeof o !== "object" || o === null || Array.isArray(o) || typeof o.when !== "string" || typeof o.text !== "string" || !DUTY_WHENS.includes(o.when as DutyWhen)) {
      fail("bad_value");
    }
    const text = cleanLine(o!.text as string, STAGE_LIMITS.duty_text);
    if (text == null) continue;
    const when = o!.when as DutyWhen;
    if (out.some((x) => x.when === when && x.text === text)) continue;
    out.push({ when, text });
  }
  if (out.length > STAGE_LIMITS.duty_count) fail("bad_value");
  return out;
}

/** public.set_transport_details: every field one line; a driver's phone with at least 6 digits; arranged false unless true. */
export function cleanTransportDetails(d: Partial<TransportDetails>): TransportDetails {
  return {
    pickup_address: cleanLine(d.pickup_address, STAGE_LIMITS.pickup_address),
    pickup_time: cleanLine(d.pickup_time, STAGE_LIMITS.pickup_time),
    driver_name: cleanLine(d.driver_name, STAGE_LIMITS.driver_name),
    driver_phone: cleanPhone(d.driver_phone),
    arranged: d.arranged === true,
  };
}

/** A JSON object's keys as the database sees them: one whose value is undefined is not there (JSON drops it). */
function presentKeys(v: unknown): [string, unknown][] {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail("bad_value");
  return Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
}

const isText = (x: unknown): x is string | null => x === null || typeof x === "string";

/**
 * public.set_transport_request (v18): the request's half of the details — any of pickup_address, pickup_time (one line
 * each, empty → null) and pickup_min (a whole minute 0…1830, or null). Only the keys present come back; any other key,
 * a text that is neither a string nor null, a minute that is not one: `bad_value`.
 */
export function cleanTransportRequest(v: unknown): TransportRequestPatch {
  const entries = presentKeys(v);
  for (const [k, x] of entries) {
    if (k === "pickup_address" || k === "pickup_time") {
      if (!isText(x)) fail("bad_value");
    } else if (k === "pickup_min") {
      if (x !== null && !(typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= STAGE_LIMITS.pickup_min_max)) fail("bad_value");
    } else fail("bad_value");
  }
  const p = Object.fromEntries(entries) as { pickup_address?: string | null; pickup_time?: string | null; pickup_min?: number | null };
  const out: TransportRequestPatch = {};
  if ("pickup_address" in p) out.pickup_address = cleanLine(p.pickup_address, STAGE_LIMITS.pickup_address);
  if ("pickup_time" in p) out.pickup_time = cleanLine(p.pickup_time, STAGE_LIMITS.pickup_time);
  if ("pickup_min" in p) out.pickup_min = p.pickup_min ?? null;
  return out;
}

/**
 * public.set_transport_driver (v18): the driver's half — any of driver_name, driver_phone (one line each, empty → null;
 * a phone of at least 6 digits, else `bad_phone`) and arranged (a boolean). The shape first — any other key, a text
 * that is neither a string nor null, an `arranged` that is not true or false: `bad_value` — then the values.
 */
export function cleanTransportDriver(v: unknown): TransportDriverPatch {
  const entries = presentKeys(v);
  for (const [k, x] of entries) {
    if (k === "driver_name" || k === "driver_phone") {
      if (!isText(x)) fail("bad_value");
    } else if (k === "arranged") {
      if (typeof x !== "boolean") fail("bad_value");
    } else fail("bad_value");
  }
  const p = Object.fromEntries(entries) as { driver_name?: string | null; driver_phone?: string | null; arranged?: boolean };
  const out: TransportDriverPatch = {};
  if ("driver_name" in p) out.driver_name = cleanLine(p.driver_name, STAGE_LIMITS.driver_name);
  if ("driver_phone" in p) out.driver_phone = cleanPhone(p.driver_phone);
  if ("arranged" in p) out.arranged = p.arranged === true;
  return out;
}

export const EMPTY_TRANSPORT: TransportDetails = { pickup_address: null, pickup_time: null, driver_name: null, driver_phone: null, arranged: false };

/**
 * What the team's «פרטי ההסעה» saves, now that the escort's link writes the pickup address too (public.escort_pickup):
 * the fields the form changed from what it loaded, and for the rest what the database holds at the moment of saving
 * — so an address the escort sent while the form was open is never overwritten with the stale copy.
 */
export function mergeTransport(loaded: TransportDetails, draft: TransportDetails, current: TransportDetails | null): TransportDetails {
  if (!current) return draft;
  const pick = <K extends keyof TransportDetails>(k: K): TransportDetails[K] => (draft[k] === loaded[k] ? current[k] : draft[k]);
  return { pickup_address: pick("pickup_address"), pickup_time: pick("pickup_time"), driver_name: pick("driver_name"), driver_phone: pick("driver_phone"), arranged: pick("arranged") };
}
