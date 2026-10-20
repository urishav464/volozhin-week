// The links, מכריכה לכריכה and the public pages against the real database
// (supabase/schema.sql «Milestone 5a»).
//
// SupabaseLinks and SupabaseKk run as the signed-in member: issuing and
// revoking are functions, the list a read of share_links' columns — every one
// but the token's hash, which no browser role may read — and every kk write a
// function; load_kk reads under RLS.
//
// SupabasePublic is the public pages' path, and deliberately not supabase-js:
// a plain POST to /rest/v1/rpc/<function> carrying the publishable key in the
// `apikey` header and NO Authorization header — no session is read, none is
// refreshed, nothing in localStorage is touched, so a team member's own session
// in the same browser never rides along, and PostgREST runs the call as `anon`.
// The token goes in the body, never in the URL. It calls the six anon functions
// and nothing else.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Day } from "../domain/time";
import type { TickItem } from "../domain/types";
import { CommandError } from "./commands";
import type { KkData, KkGroupFields, KkPort } from "./kk";
import type { IssuedLink, LinkScope, LinksPort, ShareLink } from "./links";
import type { EscortTicks, EscortView, KkForm, PublicPort, ScheduleView } from "./publicPort";
import { callRpc } from "./supabaseCommands";
import { refusal } from "./supabaseSettings";
import { PortError } from "./types";

const LINK_COLUMNS = "id,scope,subject_id,created_by,created_at,expires_at,revoked_at";
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export class SupabaseLinks implements LinksPort {
  constructor(private readonly sb: SupabaseClient) {}

  async list(editionId: number): Promise<ShareLink[]> {
    const { data, error } = await this.sb.from("share_links").select(LINK_COLUMNS).eq("edition_id", editionId).order("id", { ascending: false });
    if (error) throw refusal(error);
    return ((data ?? []) as ShareLink[]).map((l) => ({ ...l, id: num(l.id), subject_id: numOrNull(l.subject_id), created_by: numOrNull(l.created_by) }));
  }

  async issue(editionId: number, scope: LinkScope, subjectId: number | null = null): Promise<IssuedLink> {
    const r = (await callRpc(this.sb, "issue_link", { p_edition: editionId, p_scope: scope, p_subject: subjectId })) as IssuedLink;
    return { link_id: num(r.link_id), token: String(r.token), expires_at: String(r.expires_at) };
  }

  async revoke(linkId: number): Promise<void> {
    await callRpc(this.sb, "revoke_link", { p_link: linkId });
  }
}

export class SupabaseKk implements KkPort {
  constructor(private readonly sb: SupabaseClient) {}

  async load(editionId: number): Promise<KkData> {
    const d = (await callRpc(this.sb, "load_kk", { p_edition: editionId })) as KkData | null;
    return d ?? { tracks: [], groups: [], leaders: [], signups: [], orders: [] };
  }

  async addGroup(editionId: number, day: Day, startMin: number, fields: KkGroupFields): Promise<number> {
    return num(await callRpc(this.sb, "kk_add_group", { p_edition: editionId, p_day: day, p_start: startMin, p_fields: fields }));
  }

  async updateGroup(groupId: number, patch: KkGroupFields): Promise<void> {
    await callRpc(this.sb, "kk_update_group", { p_group: groupId, p_patch: patch });
  }

  async deleteGroup(groupId: number): Promise<void> {
    await callRpc(this.sb, "kk_delete_group", { p_group: groupId });
  }

  async place(groupId: number, rosterId: number): Promise<void> {
    await callRpc(this.sb, "kk_place", { p_group: groupId, p_roster: rosterId });
  }

  async unplace(trackId: number, rosterId: number): Promise<void> {
    await callRpc(this.sb, "kk_unplace", { p_track: trackId, p_roster: rosterId });
  }

  async setWindow(editionId: number, opensAt: string | null, closesAt: string | null): Promise<void> {
    await callRpc(this.sb, "kk_set_window", { p_edition: editionId, p_opens: opensAt, p_closes: closesAt });
  }

  async setBookOrder(groupId: number, copies: number | null, ordered: boolean): Promise<void> {
    await callRpc(this.sb, "set_book_order", { p_group: groupId, p_copies: copies, p_ordered: ordered });
  }
}

/** The anon functions — the only ones a public page may call. */
export const PUBLIC_FUNCTIONS = ["escort_view", "escort_tick", "escort_pickup", "kk_form", "kk_signup", "schedule_view"] as const;
type PublicFunction = (typeof PUBLIC_FUNCTIONS)[number];

export class SupabasePublic implements PublicPort {
  readonly mode = "live" as const;

  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  /** One anon function: the publishable key, no Authorization, the token in the body. A refusal is its code. */
  private async call(fn: PublicFunction, args: Record<string, unknown>): Promise<unknown> {
    const res = await this.fetchFn(`${this.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null; // a gateway's HTML page, not PostgREST's answer
    }
    if (!res.ok) {
      const e = (body ?? {}) as { code?: string; message?: string };
      if (e.code === "P0001" && e.message) throw new CommandError(e.message);
      throw new PortError(e.code ?? String(res.status), e.message ?? res.statusText);
    }
    return body;
  }

  async escortView(token: string): Promise<EscortView> {
    return (await this.call("escort_view", { p_token: token })) as EscortView;
  }

  async escortTick(token: string, lessonId: number, item: TickItem, on: boolean): Promise<EscortTicks> {
    return (await this.call("escort_tick", { p_token: token, p_lesson: lessonId, p_item: item, p_on: on })) as EscortTicks;
  }

  async escortPickup(token: string, lessonId: number, address: string): Promise<void> {
    await this.call("escort_pickup", { p_token: token, p_lesson: lessonId, p_address: address });
  }

  async kkForm(token: string): Promise<KkForm> {
    return (await this.call("kk_form", { p_token: token })) as KkForm;
  }

  async kkSignup(token: string, rosterId: number, groupId: number): Promise<void> {
    await this.call("kk_signup", { p_token: token, p_roster: rosterId, p_group: groupId });
  }

  async scheduleView(token: string): Promise<ScheduleView> {
    return (await this.call("schedule_view", { p_token: token })) as ScheduleView;
  }
}
