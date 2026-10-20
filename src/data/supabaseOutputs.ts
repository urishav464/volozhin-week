// The outputs' and the knowledge base's storage against the real database
// (supabase/schema.sql «Milestone 4»). Snapshots, notes and milestones are
// direct writes under RLS — column grants and guard triggers keep who, when
// and the version the database's; the phones are one invoker RPC under the
// contacts policy; the archive reads activity, speaker_contacts and
// transport_details through their own policies (a global admin sees all,
// anyone else only their own). A refusal is a CommandError with a code from
// src/errors.ts.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { SpeakerContacts, TransportDetails } from "../domain/types";
import { readSnapshot, type DesignerRow } from "../exports/designer";
import { CommandError } from "./commands";
import {
  cleanBody, cleanDaysBefore, cleanSection, cleanTitle, type KnowledgePort, type Milestone, type NewNote, type Note, type NotePatch,
} from "./knowledge";
import type { ArchiveExtras, ExportSnapshot, LessonPhone, OutputsPort, SnapshotKind } from "./outputs";
import type { ActivityEntry } from "./speakers";
import { callRpc } from "./supabaseCommands";
import { refusal } from "./supabaseSettings";

type Q = PromiseLike<{ data: unknown; error: PostgrestError | null }>;

async function rows<T>(q: Q): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw refusal(error);
  return (data ?? []) as T[];
}

/** A write RLS may silently filter: no row back is `none` (forbidden, or — with a version — stale). */
async function one(q: Q, none = "forbidden"): Promise<void> {
  const { data, error } = await q;
  if (error) throw refusal(error);
  if (!Array.isArray(data) || data.length === 0) throw new CommandError(none);
}

/** Every page of a read (PostgREST answers at most its max-rows — 1000 on Supabase — at a time). */
async function all<T>(page: (from: number, to: number) => Q, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const got = await rows<T>(page(from, from + size - 1));
    out.push(...got);
    if (got.length < size) return out;
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const SNAPSHOT_COLUMNS = "id,kind,payload,created_by,created_at";
const NOTE_COLUMNS = "id,edition_id,section,title,body_md,version,created_by,updated_by,updated_at";
const MILESTONE_COLUMNS = "id,edition_id,title,days_before,done_at,done_by";

function snapshot(r: Record<string, unknown>): ExportSnapshot {
  return { id: num(r.id), kind: "designer", rows: readSnapshot(r.payload), created_by: numOrNull(r.created_by), created_at: String(r.created_at) };
}

function note(r: Note): Note {
  return { ...r, id: num(r.id), edition_id: numOrNull(r.edition_id), version: num(r.version), created_by: numOrNull(r.created_by), updated_by: numOrNull(r.updated_by) };
}

function milestone(r: Milestone): Milestone {
  return { ...r, id: num(r.id), edition_id: num(r.edition_id), days_before: num(r.days_before), done_by: numOrNull(r.done_by) };
}

export class SupabaseOutputs implements OutputsPort {
  constructor(private readonly sb: SupabaseClient) {}

  async phones(_editionId: number, lessonIds: number[]): Promise<LessonPhone[]> {
    if (lessonIds.length === 0) return [];
    const out: LessonPhone[] = [];
    for (const ids of chunks(lessonIds, 1000)) {
      const got = ((await callRpc(this.sb, "get_contacts_for", { p_lessons: ids })) ?? []) as LessonPhone[];
      out.push(...got.map((p) => ({ lesson_id: num(p.lesson_id), speaker_id: num(p.speaker_id), phone: String(p.phone) })));
    }
    return out;
  }

  async snapshots(editionId: number, kind: SnapshotKind): Promise<ExportSnapshot[]> {
    const got = await rows<Record<string, unknown>>(
      this.sb.from("export_snapshots").select(SNAPSHOT_COLUMNS).eq("edition_id", editionId).eq("kind", kind).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50),
    );
    return got.map(snapshot);
  }

  async saveSnapshot(editionId: number, kind: SnapshotKind, rowsToSave: DesignerRow[]): Promise<void> {
    await one(this.sb.from("export_snapshots").insert({ edition_id: editionId, kind, payload: rowsToSave }).select("id"));
  }

  async archiveExtras(editionId: number, speakerIds: number[], lessonIds: number[]): Promise<ArchiveExtras> {
    const activity = await all<ActivityEntry>((from, to) =>
      this.sb.from("activity").select("id,at,actor,edition_id,entity,entity_id,kind,detail").eq("edition_id", editionId).order("id").range(from, to),
    );
    const contacts: (SpeakerContacts & { speaker_id: number })[] = [];
    for (const ids of chunks(speakerIds, 100)) {
      contacts.push(...(await rows<SpeakerContacts & { speaker_id: number }>(this.sb.from("speaker_contacts").select("speaker_id,phone,email,secretary_note,notes").in("speaker_id", ids))));
    }
    const transport: (TransportDetails & { lesson_id: number })[] = [];
    for (const ids of chunks(lessonIds, 100)) {
      transport.push(
        ...(await rows<TransportDetails & { lesson_id: number }>(
          this.sb.from("transport_details").select("lesson_id,pickup_address,pickup_time,driver_name,driver_phone,arranged").in("lesson_id", ids),
        )),
      );
    }
    const knowledge = new SupabaseKnowledge(this.sb);
    return {
      activity: activity.map((r) => ({ ...r, id: num(r.id), actor: numOrNull(r.actor), edition_id: numOrNull(r.edition_id), entity_id: numOrNull(r.entity_id) })),
      contacts: contacts.map((c) => ({ ...c, speaker_id: num(c.speaker_id) })).sort((a, b) => a.speaker_id - b.speaker_id),
      transport: transport.map((t) => ({ ...t, lesson_id: num(t.lesson_id) })).sort((a, b) => a.lesson_id - b.lesson_id),
      notes: await knowledge.notes(editionId),
      milestones: await knowledge.milestones(editionId),
      snapshots: await this.snapshots(editionId, "designer"),
    };
  }
}

export class SupabaseKnowledge implements KnowledgePort {
  constructor(private readonly sb: SupabaseClient) {}

  async notes(editionId: number): Promise<Note[]> {
    const got = await rows<Note>(
      this.sb.from("notes").select(NOTE_COLUMNS).or(`edition_id.is.null,edition_id.eq.${Number(editionId)}`).order("updated_at", { ascending: false }).order("id", { ascending: false }),
    );
    return got.map(note);
  }

  async addNote(n: NewNote): Promise<void> {
    await one(this.sb.from("notes").insert({ edition_id: n.edition_id, section: cleanSection(n.section), title: cleanTitle(n.title), body_md: cleanBody(n.body_md) }).select("id"));
  }

  async updateNote(id: number, version: number, patch: NotePatch): Promise<void> {
    const p: NotePatch = {};
    if (patch.section !== undefined) p.section = cleanSection(patch.section);
    if (patch.title !== undefined) p.title = cleanTitle(patch.title);
    if (patch.body_md !== undefined) p.body_md = cleanBody(patch.body_md);
    // at the version the screen saw: someone else's save meanwhile is not overwritten unseen
    await one(this.sb.from("notes").update(p).eq("id", id).eq("version", version).select("id"), "stale");
  }

  async deleteNote(id: number): Promise<void> {
    await one(this.sb.from("notes").delete().eq("id", id).select("id"), "stale");
  }

  async milestones(editionId: number): Promise<Milestone[]> {
    const got = await rows<Milestone>(this.sb.from("milestones").select(MILESTONE_COLUMNS).eq("edition_id", editionId).order("days_before", { ascending: false }).order("id"));
    return got.map(milestone);
  }

  async addMilestone(editionId: number, m: { title: string; days_before: number }): Promise<void> {
    await one(this.sb.from("milestones").insert({ edition_id: editionId, title: cleanTitle(m.title), days_before: cleanDaysBefore(m.days_before) }).select("id"));
  }

  async updateMilestone(id: number, patch: { title?: string; days_before?: number }): Promise<void> {
    const p: { title?: string; days_before?: number } = {};
    if (patch.title !== undefined) p.title = cleanTitle(patch.title);
    if (patch.days_before !== undefined) p.days_before = cleanDaysBefore(patch.days_before);
    await one(this.sb.from("milestones").update(p).eq("id", id).select("id"), "stale");
  }

  async setMilestoneDone(id: number, done: boolean): Promise<void> {
    // the time is the database's (app.milestones_guard); any non-null value means «done»
    await one(this.sb.from("milestones").update({ done_at: done ? new Date().toISOString() : null }).eq("id", id).select("id"), "stale");
  }

  async deleteMilestone(id: number): Promise<void> {
    await one(this.sb.from("milestones").delete().eq("id", id).select("id"), "stale");
  }
}
