import { EXPECTED_SCHEMA_VERSION } from "../lib/schema";
import type { DataPort } from "./port";
import type { WhoAmI } from "./types";

// Synthetic data only — never a real name, phone or address.
export class DemoPort implements DataPort {
  readonly mode = "demo" as const;

  async sessionEmail(): Promise<string | null> {
    return "demo@example.org";
  }

  async whoami(): Promise<WhoAmI> {
    return {
      status: "ok",
      schema_version: EXPECTED_SCHEMA_VERSION,
      email: "demo@example.org",
      display_name: "מדריך/ה (הדגמה)",
      global_admin: true,
      memberships: [{ edition_id: null, role: "admin" }],
    };
  }

  async signInWithGoogle(): Promise<void> {}
  async signOut(): Promise<void> {}
  onAuthChange(): () => void {
    return () => {};
  }
}
