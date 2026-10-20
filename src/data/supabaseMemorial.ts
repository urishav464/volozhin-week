// The fallen and their families' contacts against the real database
// (supabase/schema.sql «Milestone 5ב-2»): the list read under RLS (fallen_read),
// every write a function, a family's contact one fallen at a time through the
// invoker get_fallen_contacts (admins only — app.may_see_fallen_contacts).
// A refusal is a CommandError with a code from src/errors.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gender } from "../domain/types";
import type { Fallen, FallenContacts, FallenFields, MemorialPort } from "./memorial";
import { callRpc } from "./supabaseCommands";
import { refusal } from "./supabaseSettings";

const text = (v: unknown) => (v == null ? null : String(v));

export class SupabaseMemorial implements MemorialPort {
  constructor(private readonly sb: SupabaseClient) {}

  async fallen(): Promise<Fallen[]> {
    const { data, error } = await this.sb.from("fallen").select("id,name,gender,note,active").order("id");
    if (error) throw refusal(error);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id), name: String(r.name), gender: (r.gender as Gender | null) ?? null, note: text(r.note), active: r.active !== false,
    }));
  }

  async saveFallen(id: number | null, f: FallenFields): Promise<number> {
    return Number(await callRpc(this.sb, "save_fallen", { p_fallen: id, p_name: f.name, p_gender: f.gender, p_note: f.note, p_active: f.active }));
  }

  async deleteFallen(id: number): Promise<void> {
    await callRpc(this.sb, "delete_fallen", { p_fallen: id });
  }

  async contacts(fallenId: number): Promise<FallenContacts | null> {
    const c = (await callRpc(this.sb, "get_fallen_contacts", { p_fallen: fallenId })) as Record<string, unknown> | null;
    return c == null ? null : { contact_name: text(c.contact_name), relation: text(c.relation), phone: text(c.phone), email: text(c.email), note: text(c.note) };
  }

  async setContacts(fallenId: number, c: FallenContacts): Promise<void> {
    await callRpc(this.sb, "set_fallen_contacts", {
      p_fallen: fallenId, p_contact_name: c.contact_name, p_relation: c.relation, p_phone: c.phone, p_email: c.email, p_note: c.note,
    });
  }
}
