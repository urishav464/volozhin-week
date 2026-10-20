// The speaker pool against the real database: one RPC per operation
// (supabase/schema.sql «Milestone 2», docs/CONTRACT.md «The speaker pool»),
// called by its parameter names. A refusal comes back as a CommandError with
// the contract's code — never a raw Postgres message. Contacts are fetched
// one speaker at a time, through the contacts policy (get_speaker_contacts).
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { DayPart } from "../domain/dayParts";
import type { Day } from "../domain/time";
import type { ApproachStatus, SpeakerContacts, Vetting } from "../domain/types";
import { CommandError } from "./commands";
import type { ActivityEntry, CreateOptions, HistoryLesson, NewSpeaker, SpeakerMatch, SpeakerPatch, SpeakerPort } from "./speakers";
import { PortError } from "./types";

function refusal(error: PostgrestError): Error {
  // The functions raise the contract's codes (P0001) and catch their own
  // unique violations; 42501 is a role the function is not granted to.
  if (error.code === "P0001") return new CommandError(error.message);
  if (error.code === "42501") return new CommandError("forbidden");
  return new PortError(error.code ?? null, error.message);
}

/** jsonb numbers arrive as numbers; bigint scalars may arrive as strings. */
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export class SupabaseSpeakers implements SpeakerPort {
  constructor(private readonly sb: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw refusal(error);
    return data as T;
  }

  async matches(name: string): Promise<SpeakerMatch[]> {
    const rows = (await this.rpc<SpeakerMatch[] | null>("speaker_matches", { p_name: name })) ?? [];
    return rows.map((m) => ({ ...m, id: num(m.id), similarity: Number(m.similarity) }));
  }

  async create(editionId: number, s: NewSpeaker, opts: CreateOptions = {}) {
    const r = await this.rpc<{ speaker_id: unknown; approach_id: unknown }>("create_speaker", {
      p_edition: editionId,
      p_fields: s,
      p_claim: !!opts.claim,
      p_approve: !!opts.approve,
      p_confirmed: !!opts.confirmed,
    });
    return { speaker_id: num(r.speaker_id), approach_id: numOrNull(r.approach_id) };
  }

  async update(editionId: number, speakerId: number, version: number, patch: SpeakerPatch): Promise<void> {
    await this.rpc("update_speaker", { p_edition: editionId, p_speaker: speakerId, p_version: version, p_patch: patch });
  }

  async vet(speakerIds: number[], state: Vetting, note: string | null = null): Promise<void> {
    await this.rpc("vet_speakers", { p_speakers: speakerIds, p_state: state, p_note: note });
  }

  async contacts(speakerId: number): Promise<SpeakerContacts | null> {
    const c = await this.rpc<SpeakerContacts | null>("get_speaker_contacts", { p_speaker: speakerId });
    return c == null ? null : { phone: c.phone ?? null, email: c.email ?? null, secretary_note: c.secretary_note ?? null, notes: c.notes ?? null };
  }

  async setContacts(speakerId: number, c: SpeakerContacts): Promise<void> {
    await this.rpc("set_speaker_contacts", { p_speaker: speakerId, p_phone: c.phone, p_email: c.email, p_secretary_note: c.secretary_note, p_notes: c.notes });
  }

  async history(speakerId: number): Promise<HistoryLesson[]> {
    const rows = (await this.rpc<HistoryLesson[] | null>("speaker_history", { p_speaker: speakerId })) ?? [];
    return rows.map((h) => ({ ...h, edition_id: num(h.edition_id) }));
  }

  async activity(speakerId: number): Promise<ActivityEntry[]> {
    const rows = (await this.rpc<ActivityEntry[] | null>("speaker_activity", { p_speaker: speakerId })) ?? [];
    return rows.map((r) => ({ ...r, id: num(r.id), actor: numOrNull(r.actor), edition_id: numOrNull(r.edition_id), entity_id: numOrNull(r.entity_id) }));
  }

  async claim(editionId: number, speakerId: number): Promise<number> {
    return num(await this.rpc("claim_speaker", { p_edition: editionId, p_speaker: speakerId }));
  }

  // The approach knows its edition in the database; the parameter is the demo's.
  async setStatus(_editionId: number, approachId: number, version: number, status: ApproachStatus, note: string | null = null): Promise<void> {
    await this.rpc("set_approach_status", { p_approach: approachId, p_version: version, p_status: status, p_note: note });
  }

  async handOver(_editionId: number, approachId: number, to: number | null, note: string | null = null): Promise<void> {
    await this.rpc("hand_over", { p_approach: approachId, p_to: to, p_note: note });
  }

  async answerHandOver(_editionId: number, approachId: number, accept: boolean, note: string | null = null): Promise<void> {
    await this.rpc("answer_handover", { p_approach: approachId, p_accept: accept, p_note: note });
  }

  async setAvailability(editionId: number, speakerId: number, day: Day, part: DayPart, kind: "can" | "cannot" | null, note: string | null = null): Promise<void> {
    await this.rpc("set_availability", { p_edition: editionId, p_speaker: speakerId, p_day: day, p_part: part, p_kind: kind, p_note: note });
  }
}
