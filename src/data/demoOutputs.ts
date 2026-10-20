// The outputs' and the knowledge base's storage in demo mode: in memory, with
// the database's rules — who reads and who writes (RLS), the cleaning and the
// refusal codes (the guard triggers), the version of a note, done_at's clock,
// a snapshot that keeps the public schedule's keys only. Phones and the
// archive's personal data come through the engine's contacts and transport
// rules, as get_contacts_for and the policies would give them. The demo's
// notes and milestones are synthetic and say «לדוגמה».
import { readSnapshot, type DesignerRow } from "../exports/designer";
import type { SpeakerContacts, TransportDetails } from "../domain/types";
import { CommandError } from "./commands";
import type { Engine, PoolShared } from "./engine";
import {
  cleanBody, cleanDaysBefore, cleanSection, cleanTitle, type KnowledgePort, type Milestone, type NewNote, type Note, type NotePatch,
} from "./knowledge";
import type { ArchiveExtras, ExportSnapshot, LessonPhone, OutputsPort, SnapshotKind } from "./outputs";

const fail = (code: string): never => {
  throw new CommandError(code);
};

const nextId = (rows: { id: number }[]) => Math.max(0, ...rows.map((r) => r.id)) + 1;

/** What DemoPort shares with its outputs and knowledge base. */
export interface DemoKnowledgeStore {
  readonly shared: PoolShared;
  notes: Note[];
  milestones: Milestone[];
  snapshots: (ExportSnapshot & { edition_id: number })[];
  engine(editionId: number): Engine;
  /** app.is_member / app.can_see_edition / app.is_global_admin / app.my_role(e) = 'admin', for the demo user. */
  isMember(): boolean;
  canSee(editionId: number): boolean;
  isGlobalAdmin(): boolean;
  adminOf(editionId: number): boolean;
  /** app.my_member_id. */
  memberIdFor(editionId: number | null): number | null;
}

/** The demo's notes and milestones: synthetic, and they say so. */
export function demoKnowledge(editionId: number): { notes: Note[]; milestones: Milestone[] } {
  const at = "2026-11-01T10:00:00.000Z";
  return {
    notes: [
      {
        id: 1, edition_id: null, section: "process", title: "הערה לדוגמה: איך כותבים כאן", version: 1, created_by: 1, updated_by: 1, updated_at: at,
        body_md: "נתון לדוגמה — את ההערות האמיתיות כותב/ת המדריך/ה.\n\nאפשר לכתוב פסקאות, **הדגשה**, ורשימה:\n- פריט לדוגמה ראשון\n- פריט לדוגמה שני",
      },
      { id: 2, edition_id: editionId, section: "lessons_learned", title: "לקח לדוגמה", version: 1, created_by: 1, updated_by: 1, updated_at: at, body_md: "נתון לדוגמה, של המחזור הזה בלבד." },
    ],
    milestones: [
      { id: 1, edition_id: editionId, title: "אבן דרך לדוגמה א׳", days_before: 42, done_at: null, done_by: null },
      { id: 2, edition_id: editionId, title: "אבן דרך לדוגמה ב׳", days_before: 21, done_at: at, done_by: 1 },
      { id: 3, edition_id: editionId, title: "אבן דרך לדוגמה ג׳ (אחרי השבוע)", days_before: -7, done_at: null, done_by: null },
    ],
  };
}

export class DemoKnowledge implements KnowledgePort {
  constructor(private readonly s: DemoKnowledgeStore) {}

  private mayWriteNote(editionId: number | null): boolean {
    return editionId == null ? this.s.isGlobalAdmin() : this.s.adminOf(editionId);
  }

  private note(id: number): Note {
    const n = this.s.notes.find((x) => x.id === id && this.mayWriteNote(x.edition_id));
    return n ?? fail("stale"); // RLS hides it, or someone deleted it: nothing came back
  }

  async notes(editionId: number): Promise<Note[]> {
    if (!this.s.isMember()) return [];
    return structuredClone(
      this.s.notes
        .filter((n) => (n.edition_id == null ? true : n.edition_id === editionId && this.s.canSee(editionId)))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id),
    );
  }

  async addNote(n: NewNote): Promise<void> {
    const v = { section: cleanSection(n.section), title: cleanTitle(n.title), body_md: cleanBody(n.body_md) };
    if (!this.mayWriteNote(n.edition_id)) fail("forbidden");
    const me = this.s.memberIdFor(n.edition_id);
    this.s.notes.push({ id: nextId(this.s.notes), edition_id: n.edition_id, ...v, version: 1, created_by: me, updated_by: me, updated_at: new Date().toISOString() });
  }

  async updateNote(id: number, version: number, patch: NotePatch): Promise<void> {
    const n = this.note(id);
    if (n.version !== version) fail("stale");
    const next = { ...n };
    if (patch.section !== undefined) next.section = cleanSection(patch.section);
    if (patch.title !== undefined) next.title = cleanTitle(patch.title);
    if (patch.body_md !== undefined) next.body_md = cleanBody(patch.body_md);
    Object.assign(n, next, { version: n.version + 1, updated_by: this.s.memberIdFor(n.edition_id), updated_at: new Date().toISOString() });
  }

  async deleteNote(id: number): Promise<void> {
    this.note(id);
    this.s.notes = this.s.notes.filter((x) => x.id !== id);
  }

  private milestone(id: number): Milestone {
    return this.s.milestones.find((x) => x.id === id && this.s.adminOf(x.edition_id)) ?? fail("stale");
  }

  async milestones(editionId: number): Promise<Milestone[]> {
    if (!this.s.canSee(editionId)) return [];
    return structuredClone(this.s.milestones.filter((m) => m.edition_id === editionId).sort((a, b) => b.days_before - a.days_before || a.id - b.id));
  }

  async addMilestone(editionId: number, m: { title: string; days_before: number }): Promise<void> {
    const v = { title: cleanTitle(m.title), days_before: cleanDaysBefore(m.days_before) };
    if (!this.s.adminOf(editionId)) fail("forbidden");
    this.s.milestones.push({ id: nextId(this.s.milestones), edition_id: editionId, ...v, done_at: null, done_by: null });
  }

  async updateMilestone(id: number, patch: { title?: string; days_before?: number }): Promise<void> {
    const m = this.milestone(id);
    const next = { ...m };
    if (patch.title !== undefined) next.title = cleanTitle(patch.title);
    if (patch.days_before !== undefined) next.days_before = cleanDaysBefore(patch.days_before);
    Object.assign(m, next);
  }

  async setMilestoneDone(id: number, done: boolean): Promise<void> {
    const m = this.milestone(id);
    // app.milestones_guard: the first «done» keeps its time; clearing clears both
    if (!done) Object.assign(m, { done_at: null, done_by: null });
    else if (m.done_at == null) Object.assign(m, { done_at: new Date().toISOString(), done_by: this.s.memberIdFor(m.edition_id) });
  }

  async deleteMilestone(id: number): Promise<void> {
    this.milestone(id);
    this.s.milestones = this.s.milestones.filter((x) => x.id !== id);
  }
}

/** app.export_snapshots_guard's keys. */
const SNAPSHOT_KEYS = new Set(["lesson_id", "kind", "day", "date", "time", "speaker", "title", "category", "room", "parallel"]);

export class DemoOutputs implements OutputsPort {
  private readonly knowledge: DemoKnowledge;

  constructor(private readonly s: DemoKnowledgeStore) {
    this.knowledge = new DemoKnowledge(s);
  }

  async phones(editionId: number, lessonIds: number[]): Promise<LessonPhone[]> {
    if (!this.s.canSee(editionId)) return [];
    const e = this.s.engine(editionId);
    const ids = new Set(lessonIds.slice(0, 1000));
    return e.week.lessonSpeakers
      .filter((x) => ids.has(x.lesson_id))
      .flatMap((x) => {
        const phone = e.contactsOf(x.speaker_id)?.phone; // null unless app.may_see_contacts
        return phone ? [{ lesson_id: x.lesson_id, speaker_id: x.speaker_id, phone }] : [];
      })
      .sort((a, b) => a.lesson_id - b.lesson_id || a.speaker_id - b.speaker_id);
  }

  async snapshots(editionId: number, kind: SnapshotKind): Promise<ExportSnapshot[]> {
    if (!this.s.adminOf(editionId)) return [];
    return structuredClone(
      this.s.snapshots
        .filter((x) => x.edition_id === editionId && x.kind === kind)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
        .map(({ edition_id: _e, ...x }) => x),
    );
  }

  async saveSnapshot(editionId: number, kind: SnapshotKind, rows: DesignerRow[]): Promise<void> {
    if (!this.s.adminOf(editionId)) fail("forbidden");
    if (!Array.isArray(rows) || rows.length > 2000 || rows.some((r) => Object.keys(r).some((k) => !SNAPSHOT_KEYS.has(k)))) fail("bad_value");
    this.s.snapshots.push({ id: nextId(this.s.snapshots), edition_id: editionId, kind, rows: readSnapshot(structuredClone(rows)), created_by: this.s.memberIdFor(editionId), created_at: new Date().toISOString() });
  }

  async archiveExtras(editionId: number, speakerIds: number[], lessonIds: number[]): Promise<ArchiveExtras> {
    const e = this.s.engine(editionId);
    const contacts: (SpeakerContacts & { speaker_id: number })[] = speakerIds.flatMap((id) => {
      const c = this.s.shared.contacts[id] ? e.contactsOf(id) : null; // a row, and the policy lets the caller see it
      return c ? [{ speaker_id: id, ...c }] : [];
    });
    const transport: (TransportDetails & { lesson_id: number })[] = lessonIds.flatMap((id) => {
      const t = this.s.shared.transport[`${editionId}:${id}`] ? e.transportOf(id) : null;
      return t ? [{ lesson_id: id, ...t }] : [];
    });
    return {
      activity: this.s.canSee(editionId) ? structuredClone(this.s.shared.log.filter((r) => r.edition_id === editionId)) : [],
      contacts,
      transport,
      notes: await this.knowledge.notes(editionId),
      milestones: await this.knowledge.milestones(editionId),
      snapshots: await this.snapshots(editionId, "designer"),
    };
  }
}
