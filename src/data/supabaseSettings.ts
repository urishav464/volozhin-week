// The settings screens against the real database. Plain settings are direct
// table writes that RLS limits to admins; the default room and one's own name
// are functions (supabase/schema.sql, «Settings»). Every refusal comes back as
// a CommandError with a code from src/errors.ts — never a raw Postgres message.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Category, Room, TeamMember } from "../domain/types";
import { cleanColor, cleanEditionPatch, cleanGender, cleanName, cleanNewEdition, cleanNewMember } from "../settings/validate";
import { CommandError } from "./commands";
import { type EditionPatch, type MemberPatch, type MemberRow, type NewEdition, type NewMember, type RosterEntry, type SettingsPort, resort } from "./settings";
import { PortError } from "./types";

const MEMBER_COLUMNS = "id,email,display_name,gender,role,edition_id,active";
const ROOM_COLUMNS = "id,name,sort,is_default";

/**
 * Postgres → the contract's codes. `unique` names what a duplicate means for
 * this table. 42501 is RLS or a missing column grant: the screen offers only
 * what the caller may do, so reaching it means someone else's admin row.
 */
function refusal(error: PostgrestError, unique = "duplicate"): Error {
  switch (error.code) {
    case "P0001":
      return new CommandError(error.message);
    case "23505":
      return new CommandError(unique);
    case "42501":
      return new CommandError("forbidden");
    case "23503":
      return new CommandError("in_use");
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
      return new CommandError("bad_value");
    default:
      return new PortError(error.code ?? null, error.message);
  }
}

export class SupabaseSettings implements SettingsPort {
  constructor(private readonly sb: SupabaseClient) {}

  /** A write RLS may silently filter: no row back means "not yours to change". */
  private async one(q: PromiseLike<{ data: unknown; error: PostgrestError | null }>, unique?: string): Promise<void> {
    const { data, error } = await q;
    if (error) throw refusal(error, unique);
    if (!Array.isArray(data) || data.length === 0) throw new CommandError("forbidden");
  }

  private async rows<T>(q: PromiseLike<{ data: unknown; error: PostgrestError | null }>): Promise<T[]> {
    const { data, error } = await q;
    if (error) throw refusal(error);
    return (data ?? []) as T[];
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw refusal(error, fn === "start_edition" ? "edition_exists" : undefined);
    return data;
  }

  // ------------------------------------------------------------- מחזור

  async startEdition(e: NewEdition): Promise<number> {
    const v = cleanNewEdition(e);
    return Number(await this.rpc("start_edition", { p_label: v.label, p_start_date: v.start_date, p_first_day_from: v.first_day_from }));
  }

  async updateEdition(id: number, patch: EditionPatch): Promise<void> {
    await this.one(this.sb.from("editions").update(cleanEditionPatch(patch)).eq("id", id).select("id"));
  }

  // ------------------------------------------------------------- צוות

  async members(editionId: number | null): Promise<MemberRow[]> {
    const q = this.sb.from("members").select(MEMBER_COLUMNS);
    const filtered = editionId == null ? q.is("edition_id", null) : q.eq("edition_id", editionId);
    return (await this.rows<MemberRow>(filtered.order("display_name").order("id"))).map((m) => ({ ...m, id: Number(m.id), edition_id: m.edition_id == null ? null : Number(m.edition_id) }));
  }

  async team(editionId: number): Promise<TeamMember[]> {
    return ((await this.rpc("team", { p_edition: editionId })) as TeamMember[]).map((t) => ({ ...t, id: Number(t.id) }));
  }

  async addMember(m: NewMember): Promise<MemberRow> {
    const row = cleanNewMember(m);
    const { data, error } = await this.sb.from("members").insert(row).select(MEMBER_COLUMNS).single();
    if (error) throw refusal(error, "member_exists");
    const r = data as unknown as MemberRow;
    return { ...r, id: Number(r.id), edition_id: r.edition_id == null ? null : Number(r.edition_id) };
  }

  async updateMember(id: number, patch: MemberPatch): Promise<void> {
    // The four columns `authenticated` may UPDATE — an address or an edition never moves.
    const p: MemberPatch = {};
    if ("display_name" in patch) p.display_name = cleanName(patch.display_name, 80);
    if ("gender" in patch) p.gender = cleanGender(patch.gender);
    if ("role" in patch) p.role = patch.role;
    if ("active" in patch) p.active = patch.active;
    await this.one(this.sb.from("members").update(p).eq("id", id).select("id"), "member_exists");
  }

  async deleteMember(id: number): Promise<void> {
    await this.one(this.sb.from("members").delete().eq("id", id).select("id"));
  }

  async setMyProfile(p: { display_name: string; gender: "m" | "f" | null }): Promise<void> {
    await this.rpc("set_my_profile", { p_display_name: cleanName(p.display_name, 80), p_gender: cleanGender(p.gender) });
  }

  // ------------------------------------------------------------- חניכים

  async roster(editionId: number): Promise<RosterEntry[]> {
    return (await this.rows<RosterEntry>(this.sb.from("roster").select("id,full_name,name_key,gender").eq("edition_id", editionId).order("full_name"))).map((r) => ({ ...r, id: Number(r.id) }));
  }

  async addRoster(editionId: number, names: { full_name: string; gender: "m" | "f" | null }[]): Promise<number> {
    if (names.length === 0) return 0;
    const rows = names.map((n) => ({ edition_id: editionId, full_name: cleanName(n.full_name), gender: cleanGender(n.gender) }));
    // A name someone else added a moment ago is skipped, not an error.
    const { data, error } = await this.sb.from("roster").upsert(rows, { onConflict: "edition_id,name_key", ignoreDuplicates: true }).select("id");
    if (error) throw refusal(error, "roster_exists");
    return (data ?? []).length;
  }

  async updateRoster(id: number, patch: { full_name?: string; gender?: "m" | "f" | null }): Promise<void> {
    const p: { full_name?: string; gender?: "m" | "f" | null } = {};
    if ("full_name" in patch) p.full_name = cleanName(patch.full_name);
    if ("gender" in patch) p.gender = cleanGender(patch.gender);
    await this.one(this.sb.from("roster").update(p).eq("id", id).select("id"), "roster_exists");
  }

  async deleteRoster(id: number): Promise<void> {
    await this.one(this.sb.from("roster").delete().eq("id", id).select("id"));
  }

  // ------------------------------------------------------------- חדרים

  async rooms(editionId: number): Promise<Room[]> {
    return (await this.rows<Room>(this.sb.from("rooms").select(ROOM_COLUMNS).eq("edition_id", editionId).order("sort").order("id"))).map((r) => ({ ...r, id: Number(r.id) }));
  }

  async addRoom(editionId: number, name: string): Promise<void> {
    const rooms = await this.rooms(editionId);
    const sort = Math.max(0, ...rooms.map((r) => r.sort)) + 1;
    await this.one(this.sb.from("rooms").insert({ edition_id: editionId, name: cleanName(name, 60), sort }).select("id"), "room_exists");
  }

  async renameRoom(id: number, name: string): Promise<void> {
    await this.one(this.sb.from("rooms").update({ name: cleanName(name, 60) }).eq("id", id).select("id"), "room_exists");
  }

  async setDefaultRoom(id: number): Promise<void> {
    await this.rpc("set_default_room", { p_room: id });
  }

  async reorderRooms(editionId: number, ids: number[]): Promise<void> {
    for (const r of resort(await this.rooms(editionId), ids)) {
      await this.one(this.sb.from("rooms").update({ sort: r.sort }).eq("id", r.id).select("id"));
    }
  }

  async deleteRoom(id: number): Promise<void> {
    await this.one(this.sb.from("rooms").delete().eq("id", id).select("id"));
  }

  // ------------------------------------------------------------- קטגוריות

  async categories(): Promise<Category[]> {
    return (await this.rows<Category>(this.sb.from("categories").select("id,name,color,sort,active").order("sort").order("id"))).map((c) => ({ ...c, id: Number(c.id) }));
  }

  async addCategory(c: { name: string; color: string }): Promise<void> {
    const sort = Math.max(0, ...(await this.categories()).map((x) => x.sort)) + 1;
    await this.one(this.sb.from("categories").insert({ name: cleanName(c.name, 60), color: cleanColor(c.color), sort }).select("id"), "category_exists");
  }

  async updateCategory(id: number, patch: Partial<Pick<Category, "name" | "color" | "active">>): Promise<void> {
    const p: Partial<Pick<Category, "name" | "color" | "active">> = { ...patch };
    if ("name" in p) p.name = cleanName(p.name, 60);
    if ("color" in p) p.color = cleanColor(p.color ?? "");
    await this.one(this.sb.from("categories").update(p).eq("id", id).select("id"), "category_exists");
  }

  async reorderCategories(ids: number[]): Promise<void> {
    for (const c of resort(await this.categories(), ids)) {
      await this.one(this.sb.from("categories").update({ sort: c.sort }).eq("id", c.id).select("id"));
    }
  }

  async deleteCategory(id: number): Promise<void> {
    await this.one(this.sb.from("categories").delete().eq("id", id).select("id"));
  }
}

