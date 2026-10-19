import { demoRequested, supabaseConfig } from "../lib/config";
import { DemoPort } from "./demoPort";
import type { DataPort } from "./port";
import { SupabasePort } from "./supabasePort";

export function makePort(): DataPort {
  if (supabaseConfig && !demoRequested) return new SupabasePort(supabaseConfig.url, supabaseConfig.key);
  return new DemoPort();
}
