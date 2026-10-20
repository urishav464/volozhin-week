import type { Edition, Week } from "../domain/types";
import type { WeekCommands } from "./commands";
import type { KkPort } from "./kk";
import type { KnowledgePort } from "./knowledge";
import type { LinksPort } from "./links";
import type { MemorialPort } from "./memorial";
import type { OutputsPort } from "./outputs";
import type { SettingsPort } from "./settings";
import type { SourcesPort } from "./sources";
import type { SpeakerPort } from "./speakers";
import type { WhoAmI } from "./types";

// Everything the screens need from storage goes through this interface. Two
// implementations: SupabasePort (the real database) and DemoPort (synthetic
// data in memory, for previews and the decision gate). The grid commands'
// semantics are fixed in docs/CONTRACT.md — both implementations follow it.
export interface DataPort {
  readonly mode: "demo" | "live";
  sessionEmail(): Promise<string | null>;
  /**
   * Whose session this device holds (the Supabase user id), read from the device alone — no network, no refresh; null
   * when nobody is signed in here. The offline snapshot is only ever shown to this user (src/offline/).
   */
  deviceUserId(): string | null;
  /** A failure with no answer from the server is a PortError with code «network» (src/offline/network.ts). */
  whoami(): Promise<WhoAmI>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** Called on sign-in / sign-out only. Returns an unsubscribe function. */
  onAuthChange(cb: () => void): () => void;
  /**
   * Why the last return from Google failed (wrong client secret, sign-ups
   * disabled, a code that could not be exchanged…), once — the address bar is
   * cleaned. null when there was no failed return.
   */
  authError(): Promise<string | null>;

  /** The editions this member can see, newest first. */
  editions(): Promise<Edition[]>;
  /** Everything the grid needs for one edition, in one load. */
  loadWeek(editionId: number): Promise<Week>;
  /** The grid's commands for one edition (docs/CONTRACT.md). */
  commands(editionId: number): WeekCommands;
  /** Calls `onChange` when anything in the edition changes (another device, another member). */
  subscribe(editionId: number, onChange: () => void): () => void;

  /** The «הגדרות» screens: editions, team, roster, rooms, categories (src/data/settings.ts). */
  readonly settings: SettingsPort;
  /** The speaker pool: create (search first), the sheet, contacts, vetting, approaches and hand-overs (src/data/speakers.ts). */
  readonly speakers: SpeakerPort;
  /** What the outputs need beyond the Week: phones (get_contacts_for), the designer's snapshots, the archive's extras (src/data/outputs.ts). */
  readonly outputs: OutputsPort;
  /** «ידע»: the knowledge base's notes and the milestones (src/data/knowledge.ts). */
  readonly knowledge: KnowledgePort;
  /** Links without an account — issue, replace, revoke, list (an edition's admins; src/data/links.ts). */
  readonly links: LinksPort;
  /** מכריכה לכריכה: groups, leaders, sign-ups, the window, book orders (src/data/kk.ts). */
  readonly kk: KkPort;
  /** The sources' files (upload, remove, short-lived URLs) and the reader's settings (src/data/sources.ts). */
  readonly sources: SourcesPort;
  /** The fallen and their families' contacts (admins only), cross-year (src/data/memorial.ts); the edition's plans are commands. */
  readonly memorial: MemorialPort;
}
