// What the outputs (milestone 4) need beyond the loaded Week — reached as
// `port.outputs`, SupabaseOutputs and DemoOutputs. The outputs themselves are
// made in the browser (src/exports/); nothing is uploaded but the designer
// export's snapshot (the public schedule only).
import type { DesignerRow } from "../exports/designer";
import type { SpeakerContacts, TransportDetails } from "../domain/types";
import type { Milestone, Note } from "./knowledge";
import type { ActivityEntry } from "./speakers";

/** A lesson's speaker's phone — only those the caller may see (public.get_contacts_for, under the contacts policy). */
export interface LessonPhone {
  lesson_id: number;
  speaker_id: number;
  phone: string;
}

export type SnapshotKind = "designer";

/** What one export for the designer held. */
export interface ExportSnapshot {
  id: number;
  kind: SnapshotKind;
  rows: DesignerRow[];
  created_by: number | null;
  created_at: string;
}

/** What the archive adds to the Week. Contacts and transport details: only the rows the caller's RLS shows. */
export interface ArchiveExtras {
  activity: ActivityEntry[];
  contacts: (SpeakerContacts & { speaker_id: number })[];
  transport: (TransportDetails & { lesson_id: number })[];
  notes: Note[];
  milestones: Milestone[];
  snapshots: ExportSnapshot[];
}

export interface OutputsPort {
  /**
   * «כולל טלפונים»: one call for the lessons on screen; never a phone the caller may not see. (The edition is the
   * demo's: its editions number their lessons apart; the database knows a lesson's edition.)
   */
  phones(editionId: number, lessonIds: number[]): Promise<LessonPhone[]>;
  /** The edition's exports of this kind, newest first (an edition's admins only). */
  snapshots(editionId: number, kind: SnapshotKind): Promise<ExportSnapshot[]>;
  /** Kept after each export; who and when are the database's. */
  saveSnapshot(editionId: number, kind: SnapshotKind, rows: DesignerRow[]): Promise<void>;
  /** For the archive export (a global admin): the edition's log, and the personal data the caller's RLS shows. */
  archiveExtras(editionId: number, speakerIds: number[], lessonIds: number[]): Promise<ArchiveExtras>;
}
