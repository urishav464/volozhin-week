// The links, מכריכה לכריכה and the public pages in demo mode: the same rules on
// the engine as production's functions (tests/parity holds them equal), in
// memory. The demo's tokens are synthetic and say what they open —
// `demo-<e|k|s>-<edition>-<trainee or 0>-<random>` — so a demo link opened in a
// new tab (a fresh demo, which never saw it issued) still opens: there it is
// taken as a live link of that trainee. Nothing in a demo token is secret, and
// a link revoked in one tab is unknown to another. The demo's books, groups,
// leaders and window are synthetic and say «לדוגמה».
import type { Day } from "../domain/time";
import type { TickItem } from "../domain/types";
import { CommandError } from "./commands";
import type { DemoLink, Engine, PoolShared } from "./engine";
import type { KkData, KkGroupFields, KkPort } from "./kk";
import { type IssuedLink, linkExpiry, type LinkScope, type LinksPort, randomToken, type ShareLink } from "./links";
import type { EscortTicks, EscortView, KkForm, PublicPort, ScheduleView } from "./publicPort";

const fail = (code: string): never => {
  throw new CommandError(code);
};

/** What DemoPort shares with its links, its מכריכה לכריכה and its public pages. */
export interface DemoLinkStore {
  readonly shared: PoolShared;
  readonly engines: Map<number, Engine>;
  engine(editionId: number): Engine;
  canSee(editionId: number): boolean;
  /** Tells the open screens something changed. */
  notify(): void;
}

const SCOPE_LETTER: Record<LinkScope, string> = { escort: "e", kk_signup: "k", schedule: "s" };
const LETTER_SCOPE: Record<string, LinkScope> = { e: "escort", k: "kk_signup", s: "schedule" };
const DEMO_TOKEN = /^demo-([eks])-(\d+)-(\d+)-[A-Za-z0-9_-]{6,}$/;

/** A demo token: it says what it opens (never a secret). The seeded ones end in «dugma00000». */
export function demoToken(scope: LinkScope, editionId: number, subjectId: number | null, seed = false): string {
  return `demo-${SCOPE_LETTER[scope]}-${editionId}-${subjectId ?? 0}-${seed ? "dugma00000" : randomToken().slice(0, 10)}`;
}

export class DemoLinks implements LinksPort {
  constructor(private readonly s: DemoLinkStore) {}

  async list(editionId: number): Promise<ShareLink[]> {
    if (!this.s.canSee(editionId)) return [];
    return structuredClone(this.s.engine(editionId).links());
  }

  async issue(editionId: number, scope: LinkScope, subjectId: number | null = null): Promise<IssuedLink> {
    const out = this.s.engine(editionId).issueLink(scope, subjectId);
    this.s.notify();
    return out;
  }

  async revoke(linkId: number): Promise<void> {
    const l = this.s.shared.links.find((x) => x.id === linkId) ?? fail("stale");
    this.s.engine(l.edition_id).revokeLink(linkId);
    this.s.notify();
  }
}

export class DemoKk implements KkPort {
  constructor(private readonly s: DemoLinkStore) {}

  private run<T>(fn: () => T): T {
    const out = fn();
    this.s.notify();
    return out;
  }

  private groupEdition(groupId: number): number {
    return this.s.shared.kk.groups.find((g) => g.id === groupId)?.edition_id ?? fail("stale");
  }

  async load(editionId: number): Promise<KkData> {
    if (!this.s.canSee(editionId)) return { tracks: [], groups: [], leaders: [], signups: [], orders: [] };
    return this.s.engine(editionId).loadKk();
  }

  async addGroup(editionId: number, day: Day, startMin: number, fields: KkGroupFields): Promise<number> {
    return this.run(() => this.s.engine(editionId).kkAddGroup(day, startMin, fields));
  }

  async updateGroup(groupId: number, patch: KkGroupFields): Promise<void> {
    this.run(() => this.s.engine(this.groupEdition(groupId)).kkUpdateGroup(groupId, patch));
  }

  async deleteGroup(groupId: number): Promise<void> {
    this.run(() => this.s.engine(this.groupEdition(groupId)).kkDeleteGroup(groupId));
  }

  async place(groupId: number, rosterId: number): Promise<void> {
    this.run(() => this.s.engine(this.groupEdition(groupId)).kkPlace(groupId, rosterId));
  }

  async unplace(trackId: number, rosterId: number): Promise<void> {
    const ed = this.s.shared.kk.tracks.find((t) => t.id === trackId)?.edition_id ?? fail("stale");
    this.run(() => this.s.engine(ed).kkUnplace(trackId, rosterId));
  }

  async setWindow(editionId: number, opensAt: string | null, closesAt: string | null): Promise<void> {
    this.run(() => this.s.engine(editionId).kkSetWindow(opensAt, closesAt));
  }

  async setBookOrder(groupId: number, copies: number | null, ordered: boolean): Promise<void> {
    this.run(() => this.s.engine(this.groupEdition(groupId)).setBookOrder(groupId, copies, ordered));
  }
}

export class DemoPublic implements PublicPort {
  readonly mode = "demo" as const;

  constructor(private readonly s: DemoLinkStore) {}

  /** A demo token this tab never issued (opened in a new tab): taken as a live link of what it says, once. */
  private adopt(token: string): void {
    if (this.s.shared.links.some((l) => l.token === token)) return;
    const m = DEMO_TOKEN.exec(token);
    if (!m) return;
    const scope = LETTER_SCOPE[m[1]];
    const [editionId, subject] = [Number(m[2]), Number(m[3])];
    const week = this.s.engines.get(editionId)?.week;
    if (!week) return;
    const subjectId = scope === "escort" ? subject : null;
    if (scope === "escort" ? !week.roster.some((r) => r.id === subject) : subject !== 0) return;
    const now = new Date().toISOString();
    const link: DemoLink = {
      id: Math.max(0, ...this.s.shared.links.map((l) => l.id)) + 1, edition_id: editionId, scope, subject_id: subjectId, token,
      created_by: null, created_at: now, expires_at: linkExpiry(week.edition, scope, now), revoked_at: null,
    };
    this.s.shared.links.push(link);
  }

  /** The engine of the link's edition (an unknown token: any engine — it refuses with `link_invalid`). */
  private engineFor(token: string): Engine {
    if (typeof token === "string") this.adopt(token);
    const l = this.s.shared.links.find((x) => x.token === token);
    return l ? this.s.engine(l.edition_id) : [...this.s.engines.values()][0];
  }

  async escortView(token: string): Promise<EscortView> {
    return structuredClone(this.engineFor(token).escortView(token));
  }

  async escortTick(token: string, lessonId: number, item: TickItem, on: boolean): Promise<EscortTicks> {
    const out = this.engineFor(token).escortTick(token, lessonId, item, on);
    this.s.notify();
    return out;
  }

  async escortPickup(token: string, lessonId: number, address: string): Promise<void> {
    this.engineFor(token).escortPickup(token, lessonId, address);
    this.s.notify();
  }

  async kkForm(token: string): Promise<KkForm> {
    return structuredClone(this.engineFor(token).kkForm(token));
  }

  async kkSignup(token: string, rosterId: number, groupId: number): Promise<void> {
    this.engineFor(token).kkSignup(token, rosterId, groupId);
    this.s.notify();
  }

  async scheduleView(token: string): Promise<ScheduleView> {
    return structuredClone(this.engineFor(token).scheduleView(token));
  }
}

/**
 * The demo edition's links and מכריכה לכריכה, all synthetic: an escort's link for every trainee who escorts, the
 * sign-up and schedule links (seeded tokens, `demoToken(…, true)`), a window open from yesterday for two weeks, three
 * groups of books «לדוגמה» — one not offered yet (no capacity) — two sign-ups through the link, one placed by the
 * staff, and a book order.
 */
export function seedDemoLinks(e: Engine, now = Date.now()): void {
  const day = 86_400_000;
  e.kkSetWindow(new Date(now - day).toISOString(), new Date(now + 14 * day).toISOString());
  const escorts = [...new Set(e.week.lessons.filter((l) => l.state === "closed" && l.escort_roster_id != null).map((l) => l.escort_roster_id!))].sort((a, b) => a - b);
  for (const r of escorts) e.issueLink("escort", r);
  const kk = e.issueLink("kk_signup").token;
  e.issueLink("schedule");
  const roster = e.week.roster.map((r) => r.id);
  const a = e.kkAddGroup(0, 1290, {
    title: "ספר לדוגמה א׳", author: "מחבר/ת לדוגמה", room_id: e.week.rooms[0]?.id ?? null, capacity: 6,
    leaders: [{ kind: "trainee", roster_id: roster[4] }, { kind: "staff", label: "מוביל/ה מהצוות (לדוגמה)" }],
  });
  const b = e.kkAddGroup(0, 1290, {
    title: "ספר לדוגמה ב׳", author: "מחבר/ת לדוגמה", room_id: e.week.rooms[1]?.id ?? null, capacity: 4,
    leaders: [{ kind: "ein_prat", label: "מוביל/ה מעין פרת (לדוגמה)" }],
  });
  e.kkAddGroup(1, 1740, { title: "ספר לדוגמה ג׳ (עוד בלי תפוסה)", author: null });
  e.kkSignup(kk, roster[0], a);
  e.kkSignup(kk, roster[1], b);
  e.kkPlace(a, roster[2]);
  e.setBookOrder(a, 6, false);
}
