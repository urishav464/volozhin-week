// How a public page (/e, /k, /s) gets its PublicPort without loading the team's
// app: in production SupabasePublic alone — a plain fetch with the publishable
// key, so neither supabase-js nor SupabasePort is even downloaded, and no auth
// client starts; in demo mode the tab's one DemoPort (src/data/index.ts), so a
// link issued in «קישורים» opens on the same synthetic data.
import { demoRequested, supabaseConfig } from "../lib/config";
import type { PublicPort } from "./publicPort";
import { SupabasePublic } from "./supabaseLinks";

/** Is this build running on demo data (no Supabase configured, or `?demo`)? */
export const publicDemo = !supabaseConfig || demoRequested;

export async function loadPublicPort(): Promise<PublicPort> {
  if (!publicDemo) return new SupabasePublic(supabaseConfig!.url, supabaseConfig!.key);
  return (await import("./index")).makePublicPort();
}
