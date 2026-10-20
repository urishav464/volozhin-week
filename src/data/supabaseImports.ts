// The import of 5786 against the real database: the pool read under RLS (speakers_read — names, never a contact),
// public.import_lookup and public.import_commit (supabase/schema.sql «Import 5786»), called by their parameter
// names. A row the commit refused comes back as an ImportRowError (the code import_bad_row, «row:reason» in
// PostgREST's details) — never a raw Postgres message.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Speaker } from "../domain/types";
import { portError } from "../offline/network";
import { CommandError } from "./commands";
import { type ImportCommit, type ImportLookup, type ImportPort, type ImportResult, rowErrorOf } from "./imports";
import { refusal } from "./supabaseSettings";

const SPEAKER_COLUMNS = "id,title,name,disambiguator,gender,affiliation,bio_short,topics,contact_pref,vetted,vetted_by,vetted_note,retired,name_key,version";

export class SupabaseImports implements ImportPort {
  constructor(private readonly sb: SupabaseClient) {}

  async pool(): Promise<Speaker[]> {
    const { data, error } = await this.sb.from("speakers").select(SPEAKER_COLUMNS).order("id");
    if (error) throw refusal(error);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...(r as unknown as Speaker), id: Number(r.id), topics: (r.topics as string[] | null) ?? [], vetted_by: r.vetted_by == null ? null : Number(r.vetted_by) }));
  }

  async lookup(speakerIds: number[], phoneKeys: string[]): Promise<ImportLookup> {
    const { data, error, status } = await this.sb.rpc("import_lookup", { p_speakers: speakerIds, p_phone_keys: phoneKeys });
    if (error) throw error.code === "P0001" ? new CommandError(error.message) : error.code === "42501" ? new CommandError("forbidden") : portError(error, status);
    const r = (data ?? {}) as ImportLookup;
    return {
      phones: (r.phones ?? []).map((p) => ({ key: String(p.key), speaker_id: Number(p.speaker_id) })),
      contacts: (r.contacts ?? []).map((c) => ({ speaker_id: Number(c.speaker_id), phone: !!c.phone, email: !!c.email, secretary_note: !!c.secretary_note, notes: !!c.notes })),
    };
  }

  async commit(c: ImportCommit): Promise<ImportResult> {
    const { data, error, status } = await this.sb.rpc("import_commit", { p_kind: c.kind, p_payload: c.payload });
    if (error) {
      if (error.code === "P0001") throw (error.message === "import_bad_row" && rowErrorOf(error.details)) || new CommandError(error.message);
      if (error.code === "42501") throw new CommandError("forbidden");
      throw portError(error, status);
    }
    const r = data as ImportResult;
    return {
      created: Number(r.created), merged: Number(r.merged), filled: Number(r.filled), contacts: Number(r.contacts), notes: Number(r.notes ?? 0), lessons: Number(r.lessons), replaced: Number(r.replaced),
      edition_id: r.edition_id == null ? null : Number(r.edition_id),
      speakers: (r.speakers ?? []).map((s) => ({ row: Number(s.row), speaker_id: Number(s.speaker_id), created: !!s.created })),
    };
  }
}
