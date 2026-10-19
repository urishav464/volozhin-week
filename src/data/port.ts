import type { Edition, Week } from "../domain/types";
import type { WeekCommands } from "./commands";
import type { SettingsPort } from "./settings";
import type { WhoAmI } from "./types";

// Everything the screens need from storage goes through this interface. Two
// implementations: SupabasePort (the real database) and DemoPort (synthetic
// data in memory, for previews and the decision gate). The grid commands'
// semantics are fixed in docs/CONTRACT.md — both implementations follow it.
export interface DataPort {
  readonly mode: "demo" | "live";
  sessionEmail(): Promise<string | null>;
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
}
