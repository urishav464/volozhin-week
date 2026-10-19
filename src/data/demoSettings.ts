// The settings screens in demo mode: the same operations as SupabaseSettings,
// in memory, refusing what the database refuses with the same codes (a second
// address in the same edition, deleting someone with history, the default
// room, a used category…). Synthetic people only.
import type { Category, Edition, Room, TeamMember, Week } from "../domain/types";
import { nameKey } from "../domain/nameKey";
import { cleanColor, cleanEditionPatch, cleanGender, cleanName, cleanNewEdition, cleanNewMember } from "../settings/validate";
import { CommandError } from "./commands";
import type { Engine } from "./engine";
import { type EditionPatch, type MemberPatch, type MemberRow, type NewEdition, type NewMember, type RosterEntry, type SettingsPort, resort } from "./settings";

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** What DemoPort shares with its settings: every edition's engine, and the cross-edition lists. */
export interface DemoStore {
  readonly myEmail: string;
  readonly engines: Map<number, Engine>;
  members: MemberRow[];
  roster: (RosterEntry & { edition_id: number })[];
  categories: Category[];
  /** A new edition's week: the 2026 grid, one default room, the shared pool. */
  addEngine(edition: Edition, room: Room): void;
  /** Pushes the shared lists into every engine and tells open screens. */
  changed(): void;
}

const nextId = (rows: { id: number }[]) => Math.max(0, ...rows.map((r) => r.id)) + 1;

export class DemoSettings implements SettingsPort {
  constructor(private readonly s: DemoStore) {}

  private weeks(): Week[] {
    return [...this.s.engines.values()].map((e) => e.week);
  }

  private me(): MemberRow[] {
    return this.s.members.filter((m) => m.active && m.email === this.s.myEmail);
  }

  private isGlobalAdmin(): boolean {
    return this.me().some((m) => m.role === "admin" && m.edition_id == null);
  }

  private adminOf(editionId: number | null): boolean {
    return this.isGlobalAdmin() || (editionId != null && this.me().some((m) => m.role === "admin" && m.edition_id === editionId));
  }

  /** members_admin_write: an edition's admin manages that edition's non-admin rows only. */
  private mayManage(row: { edition_id: number | null; role: string }): boolean {
    return this.isGlobalAdmin() || (row.edition_id != null && row.role !== "admin" && this.adminOf(row.edition_id));
  }

  private done<T>(v: T): T {
    this.s.changed();
    return structuredClone(v);
  }

  // ------------------------------------------------------------- מחזור

  async startEdition(e: NewEdition): Promise<number> {
    const v = cleanNewEdition(e);
    if (!this.isGlobalAdmin()) fail("forbidden");
    const weeks = this.weeks();
    if (weeks.some((w) => w.edition.label === v.label)) fail("edition_exists");
    for (const w of weeks) if (w.edition.kind === "real" && w.edition.status !== "archived") w.edition.status = "archived";
    const edition: Edition = {
      id: nextId(weeks.map((w) => w.edition)),
      label: v.label,
      kind: "real",
      start_date: v.start_date,
      first_day_from: v.first_day_from,
      last_day_until: 1140,
      status: "planning",
      settings: { lesson_minutes: 75, row_minutes: 90 },
    };
    this.s.addEngine(edition, { id: nextId(weeks.flatMap((w) => w.rooms)), name: "בית מדרש", sort: 1, is_default: true });
    return this.done(edition.id);
  }

  async updateEdition(id: number, patch: EditionPatch): Promise<void> {
    const p = cleanEditionPatch(patch);
    const w = this.s.engines.get(id)?.week;
    if (!w || !this.isGlobalAdmin()) fail("forbidden");
    Object.assign(w!.edition, p);
    this.done(null);
  }

  // ------------------------------------------------------------- צוות

  async members(editionId: number | null): Promise<MemberRow[]> {
    // members_select: one's own rows, and the rows of editions one administers.
    const visible = this.s.members.filter((m) => m.email === this.s.myEmail || (m.edition_id == null ? this.isGlobalAdmin() : this.adminOf(m.edition_id)));
    return structuredClone(visible.filter((m) => m.edition_id === editionId).sort((a, b) => a.display_name.localeCompare(b.display_name, "he") || a.id - b.id));
  }

  async team(editionId: number): Promise<TeamMember[]> {
    return this.s.members
      .filter((m) => m.active && (m.edition_id === editionId || m.edition_id == null))
      .map(({ id, display_name, gender, role }) => ({ id, display_name, gender, role }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "he"));
  }

  async addMember(m: NewMember): Promise<MemberRow> {
    const v = cleanNewMember(m);
    if (!this.mayManage(v)) fail("forbidden");
    if (this.s.members.some((x) => x.email === v.email && x.edition_id === v.edition_id)) fail("member_exists");
    const row: MemberRow = { id: nextId(this.s.members), ...v, active: true };
    this.s.members.push(row);
    return this.done(row);
  }

  private member(id: number): MemberRow {
    const m = this.s.members.find((x) => x.id === id);
    // RLS: a row one may not manage is simply not there to change.
    if (!m || !this.mayManage(m)) fail("forbidden");
    return m!;
  }

  async updateMember(id: number, patch: MemberPatch): Promise<void> {
    const m = this.member(id);
    const next = { ...m, ...patch };
    if ("display_name" in patch) next.display_name = cleanName(patch.display_name, 80);
    if ("gender" in patch) next.gender = cleanGender(patch.gender);
    if (!this.mayManage(next)) fail("forbidden");
    if (m.email === this.s.myEmail && m.role === "admin" && (next.role !== "admin" || !next.active)) fail("self_lockout");
    Object.assign(m, next);
    this.done(null);
  }

  async deleteMember(id: number): Promise<void> {
    const m = this.member(id);
    if (m.email === this.s.myEmail && m.role === "admin") fail("self_lockout");
    const used = this.weeks().some(
      (w) =>
        w.approaches.some((a) => a.owner_member_id === id) ||
        w.pitches.some((p) => p.proposed_by === id) ||
        w.lessons.some((l) => l.updated_by === id),
    );
    if (used) fail("member_has_history");
    this.s.members = this.s.members.filter((x) => x.id !== id);
    this.done(null);
  }

  async setMyProfile(p: { display_name: string; gender: "m" | "f" | null }): Promise<void> {
    const name = cleanName(p.display_name, 80);
    const gender = cleanGender(p.gender);
    const mine = this.me();
    if (mine.length === 0) fail("not_member");
    for (const m of this.s.members) if (m.email === this.s.myEmail) Object.assign(m, { display_name: name, gender });
    this.done(null);
  }

  // ------------------------------------------------------------- חניכים

  async roster(editionId: number): Promise<RosterEntry[]> {
    return this.s.roster
      .filter((r) => r.edition_id === editionId)
      .map(({ id, full_name, name_key, gender }) => ({ id, full_name, name_key, gender }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
  }

  async addRoster(editionId: number, names: { full_name: string; gender: "m" | "f" | null }[]): Promise<number> {
    if (!this.adminOf(editionId)) fail("forbidden");
    const clean = names.map((n) => ({ full_name: cleanName(n.full_name), gender: cleanGender(n.gender) }));
    let added = 0;
    for (const n of clean) {
      const key = nameKey(n.full_name);
      if (this.s.roster.some((r) => r.edition_id === editionId && r.name_key === key)) continue; // ON CONFLICT DO NOTHING
      this.s.roster.push({ id: nextId(this.s.roster), edition_id: editionId, name_key: key, ...n });
      added++;
    }
    return this.done(added);
  }

  private rosterRow(id: number) {
    const r = this.s.roster.find((x) => x.id === id);
    if (!r || !this.adminOf(r.edition_id)) fail("forbidden");
    return r!;
  }

  async updateRoster(id: number, patch: { full_name?: string; gender?: "m" | "f" | null }): Promise<void> {
    const r = this.rosterRow(id);
    const next = { ...r };
    if ("full_name" in patch) {
      next.full_name = cleanName(patch.full_name);
      next.name_key = nameKey(next.full_name);
      if (this.s.roster.some((x) => x.id !== id && x.edition_id === r.edition_id && x.name_key === next.name_key)) fail("roster_exists");
    }
    if ("gender" in patch) next.gender = cleanGender(patch.gender);
    Object.assign(r, next);
    this.done(null);
  }

  async deleteRoster(id: number): Promise<void> {
    this.rosterRow(id);
    this.s.roster = this.s.roster.filter((x) => x.id !== id);
    this.done(null);
  }

  // ------------------------------------------------------------- חדרים

  private week(editionId: number): Week {
    const w = this.s.engines.get(editionId)?.week;
    if (!w || !this.adminOf(editionId)) fail("forbidden");
    return w!;
  }

  private roomAt(id: number): { w: Week; room: Room } {
    for (const w of this.weeks()) {
      const room = w.rooms.find((r) => r.id === id);
      if (room) {
        if (!this.adminOf(w.edition.id)) break;
        return { w, room };
      }
    }
    return fail("forbidden");
  }

  async rooms(editionId: number): Promise<Room[]> {
    const w = this.s.engines.get(editionId)?.week;
    return structuredClone([...(w?.rooms ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id));
  }

  async addRoom(editionId: number, name: string): Promise<void> {
    const n = cleanName(name, 60);
    const w = this.week(editionId);
    if (w.rooms.some((r) => r.name === n)) fail("room_exists");
    w.rooms.push({ id: nextId(this.weeks().flatMap((x) => x.rooms)), name: n, sort: Math.max(0, ...w.rooms.map((r) => r.sort)) + 1, is_default: !w.rooms.some((r) => r.is_default) });
    this.done(null);
  }

  async renameRoom(id: number, name: string): Promise<void> {
    const n = cleanName(name, 60);
    const { w, room } = this.roomAt(id);
    if (w.rooms.some((r) => r.id !== id && r.name === n)) fail("room_exists");
    room.name = n;
    this.done(null);
  }

  async setDefaultRoom(id: number): Promise<void> {
    const { w } = this.roomAt(id);
    for (const r of w.rooms) r.is_default = r.id === id;
    this.done(null);
  }

  async reorderRooms(editionId: number, ids: number[]): Promise<void> {
    const w = this.week(editionId);
    for (const { id, sort } of resort(w.rooms, ids)) w.rooms.find((r) => r.id === id)!.sort = sort;
    this.done(null);
  }

  async deleteRoom(id: number): Promise<void> {
    const { w, room } = this.roomAt(id);
    if (room.is_default) fail("room_default");
    if (w.lessons.some((l) => l.room_id === id)) fail("room_in_use");
    w.rooms = w.rooms.filter((r) => r.id !== id);
    this.done(null);
  }

  // ------------------------------------------------------------- קטגוריות

  async categories(): Promise<Category[]> {
    return structuredClone([...this.s.categories].sort((a, b) => a.sort - b.sort || a.id - b.id));
  }

  private category(id: number): Category {
    const c = this.s.categories.find((x) => x.id === id);
    if (!c || !this.isGlobalAdmin()) fail("forbidden");
    return c!;
  }

  async addCategory(c: { name: string; color: string }): Promise<void> {
    const name = cleanName(c.name, 60);
    const color = cleanColor(c.color);
    if (!this.isGlobalAdmin()) fail("forbidden");
    if (this.s.categories.some((x) => x.name === name)) fail("category_exists");
    this.s.categories.push({ id: nextId(this.s.categories), name, color, sort: Math.max(0, ...this.s.categories.map((x) => x.sort)) + 1, active: true });
    this.done(null);
  }

  async updateCategory(id: number, patch: Partial<Pick<Category, "name" | "color" | "active">>): Promise<void> {
    const c = this.category(id);
    const next = { ...c, ...patch };
    if ("name" in patch) next.name = cleanName(patch.name, 60);
    if ("color" in patch) next.color = cleanColor(patch.color ?? "");
    if (this.s.categories.some((x) => x.id !== id && x.name === next.name)) fail("category_exists");
    Object.assign(c, next);
    this.done(null);
  }

  async reorderCategories(ids: number[]): Promise<void> {
    if (!this.isGlobalAdmin()) fail("forbidden");
    for (const { id, sort } of resort(this.s.categories, ids)) this.s.categories.find((c) => c.id === id)!.sort = sort;
    this.done(null);
  }

  async deleteCategory(id: number): Promise<void> {
    this.category(id);
    if (this.weeks().some((w) => w.lessons.some((l) => l.category_id === id))) fail("category_in_use");
    this.s.categories = this.s.categories.filter((c) => c.id !== id);
    this.done(null);
  }
}
