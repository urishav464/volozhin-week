import type { WhoAmI } from "./types";

// Everything the screens need from storage goes through this interface. Two
// implementations: SupabasePort (the real database) and DemoPort (synthetic
// data in memory, for previews and the decision gate).
export interface DataPort {
  readonly mode: "demo" | "live";
  sessionEmail(): Promise<string | null>;
  whoami(): Promise<WhoAmI>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** Called on sign-in / sign-out only. Returns an unsubscribe function. */
  onAuthChange(cb: () => void): () => void;
}
