import { demoRequested, supabaseConfig } from "../lib/config";
import { DemoPort } from "./demoPort";
import type { DataPort } from "./port";
import type { PublicPort } from "./publicPort";
import { SupabasePublic } from "./supabaseLinks";
import { SupabasePort } from "./supabasePort";

const live = () => !!supabaseConfig && !demoRequested;

// One demo per tab: the team's screens and a public page opened in the same tab
// read the same synthetic data (a link issued in «קישורים» opens right away).
let demo: DemoPort | null = null;
const theDemo = () => (demo ??= new DemoPort());

export function makePort(): DataPort {
  if (live()) return new SupabasePort(supabaseConfig!.url, supabaseConfig!.key);
  return theDemo();
}

/**
 * What a public page (/e, /k, /s) reads through: the anon functions alone — no session, no sign-in, never an
 * authenticated endpoint. Built without SupabasePort, so opening a link starts no auth client at all.
 */
export function makePublicPort(): PublicPort {
  if (live()) return new SupabasePublic(supabaseConfig!.url, supabaseConfig!.key);
  return theDemo().public;
}
