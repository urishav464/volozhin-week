export type Role = "admin" | "content" | "logistics";

export interface Membership {
  edition_id: number | null; // null = every edition
  role: Role;
}

// public.whoami() — one round trip that decides the screen.
export type WhoAmI =
  | { status: "signed_out"; schema_version?: number }
  | { status: "wrong_provider"; schema_version: number }
  | { status: "not_member"; schema_version: number }
  | {
      status: "ok";
      schema_version: number;
      email: string;
      display_name: string | null;
      global_admin: boolean;
      memberships: Membership[];
    };

export type Me = Extract<WhoAmI, { status: "ok" }>;

// A failed call, with PostgREST's error code when there is one
// (PGRST202 = the function does not exist: schema.sql was never run).
export class PortError extends Error {
  constructor(
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}
