import { TEMPLATE_2026 } from "../domain/template2026";
import type { Category, Edition, Room, Week } from "../domain/types";
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema";
import type { CellTarget, EscortPatch, LessonPatch, PaymentItem, ReshapeOp, SourcesPatch, WeekCommands } from "./commands";
import { DemoKnowledge, type DemoKnowledgeStore, demoKnowledge, type DemoMilestone, DemoOutputs } from "./demoOutputs";
import { DemoSettings, type DemoStore } from "./demoSettings";
import { type DemoPool, DemoSpeakers } from "./demoSpeakers";
import { DemoKk, type DemoLinkStore, DemoLinks, DemoPublic, demoToken, seedDemoLinks } from "./demoLinks";
import { DEMO_FALLEN, demoContacts, demoFallenContacts, demoHistory, demoLog, demoPastReviews, demoReviews, demoTransport, demoWeek, seedDemoSources } from "./demoWeek";
import { DemoReviews } from "./demoReviews";
import type { SpeakerReview } from "./reviews";
import { DemoMemorial } from "./demoMemorial";
import { DemoImports, type DemoImportStore } from "./demoImports";
import type { Sample } from "./demoFiles";
import { DemoSources, type DemoSourceStore } from "./demoSources";
import { type Actor, emptyKk, Engine, type PoolShared } from "./engine";
import type { Note } from "./knowledge";
import type { ExportSnapshot } from "./outputs";
import type { DataPort } from "./port";
import type { HistoryLesson } from "./speakers";
import type { MemberRow, RosterEntry } from "./settings";
import { nameKey } from "../domain/nameKey";
import type { WhoAmI } from "./types";

const DEMO_EMAIL = "demo@example.org";

// Synthetic data only — never a real name, phone or address. The grid's
// commands run on the same engine the parity tests hold against the SQL, so
// the demo behaves like production; nothing leaves the browser tab. Each
// edition has its own engine (a new one opens from «הגדרות»); the pool (its
// speakers, contacts and log), the categories and the team are shared, as in
// the database. The demo user is the global admin (member 1).
export class DemoPort implements DataPort, DemoStore, DemoPool, DemoKnowledgeStore, DemoLinkStore, DemoSourceStore, DemoImportStore {
  readonly mode = "demo" as const;
  readonly myEmail = DEMO_EMAIL;
  readonly engines = new Map<number, Engine>();
  readonly settings: DemoSettings;
  readonly speakers: DemoSpeakers;
  readonly outputs: DemoOutputs;
  readonly knowledge: DemoKnowledge;
  /** The edition's links (v9) — the demo's tokens are synthetic (src/data/demoLinks.ts). */
  readonly links: DemoLinks;
  /** מכריכה לכריכה. */
  readonly kk: DemoKk;
  /** What a link's public page reads: the anon functions on the engine. */
  readonly public: DemoPublic;
  /** The sources' files (v10): the engine's bucket, the bytes in this tab. */
  readonly sources: DemoSources;
  /** The fallen and their families' contacts (v11), cross-year, on the engine. */
  readonly memorial: DemoMemorial;
  /** The import of 5786 (v12), on the engine: an archive becomes one more edition here. */
  readonly imports: DemoImports;
  /** «איך עבר» (v12), on the engine; across the years with the synthetic past edition. */
  readonly reviews: DemoReviews;
  readonly blobs = new Map<string, Blob>();
  readonly samples = new Map<string, Sample>();
  readonly shared: PoolShared;
  /** While the constructor seeds the demo's links, their tokens are the fixed ones (demoToken(…, true)). */
  private seeding = false;
  readonly history: Record<number, HistoryLesson[]> = demoHistory();
  readonly pastReviews: Record<number, SpeakerReview[]> = demoPastReviews();
  members: MemberRow[];
  roster: (RosterEntry & { edition_id: number })[] = [];
  categories: Category[];
  /** The knowledge base and the milestones (synthetic, «לדוגמה»), and the designer exports' snapshots. */
  notes: Note[];
  milestones: DemoMilestone[];
  snapshots: (ExportSnapshot & { edition_id: number })[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly actor: Actor = { memberId: 1, role: "admin", global: true }) {
    const week = demoWeek();
    const seeded = seedDemoSources(week);
    for (const [path, sample] of Object.entries(seeded.samples)) this.samples.set(path, sample);
    this.shared = {
      contacts: demoContacts(), log: demoLog(week), transport: demoTransport(week), links: [], linkHits: {}, kk: emptyKk(), objects: seeded.objects,
      fallen: structuredClone(DEMO_FALLEN), fallenContacts: demoFallenContacts(), reviews: demoReviews(week),
      importNotes: {},
    };
    this.engines.set(week.edition.id, this.newEngine(week));
    this.roster = week.roster.map((r) => ({ ...r, name_key: nameKey(r.full_name), edition_id: week.edition.id }));
    this.categories = structuredClone(week.categories);
    // The demo team, with placeholder addresses (example.org never delivers).
    this.members = week.team.map((t, i) => ({
      ...t,
      email: i === 0 ? DEMO_EMAIL : `team.${String.fromCharCode(96 + i)}@example.org`,
      edition_id: t.role === "admin" ? null : week.edition.id,
      active: true,
    }));
    ({ notes: this.notes, milestones: this.milestones } = demoKnowledge(week.edition.id));
    this.settings = new DemoSettings(this);
    this.speakers = new DemoSpeakers(this);
    this.outputs = new DemoOutputs(this);
    this.knowledge = new DemoKnowledge(this);
    this.links = new DemoLinks(this);
    this.kk = new DemoKk(this);
    this.public = new DemoPublic(this);
    this.sources = new DemoSources(this);
    this.memorial = new DemoMemorial(this);
    this.imports = new DemoImports(this);
    this.reviews = new DemoReviews(this);
    // seeded as the demo's instructor (member 1), whoever the demo user is
    this.seeding = true;
    seedDemoLinks(this.newEngine(this.engine(week.edition.id).week, { memberId: 1, role: "admin", global: true }));
    this.seeding = false;
  }

  private newEngine(week: Week, actor: Actor = this.actor): Engine {
    const editionId = week.edition.id;
    return new Engine(week, actor, undefined, this.shared, () => [...this.engines.values()].map((e) => e.week), (scope, subject) =>
      demoToken(scope, editionId, subject, this.seeding),
    );
  }

  notify(): void {
    this.listeners.forEach((l) => l());
  }

  addEngine(edition: Edition, room: Room): void {
    const first = [...this.engines.values()][0].week;
    const week: Week = {
      edition,
      rows: structuredClone(TEMPLATE_2026),
      rooms: [room],
      categories: structuredClone(this.categories),
      speakers: first.speakers, // one pool across the years
      approaches: [],
      availability: [],
      lessons: [],
      lessonSpeakers: [],
      pitches: [],
      team: [],
      roster: [],
      escortTicks: [],
      sourceFiles: [],
      memorialPlans: [],
      fallen: [],
    };
    this.engines.set(edition.id, this.newEngine(week));
    this.syncTeams();
  }

  /** The import's archive edition: one more engine (the shared pool), or the one of that label with its week replaced. */
  installWeek(week: Week): void {
    const e = this.engines.get(week.edition.id);
    if (e) Object.assign(e.week, week);
    else this.engines.set(week.edition.id, this.newEngine(week));
    this.syncTeams();
  }

  /**
   * Each engine's team — the active members of its edition and the all-editions ones (public.team), which
   * hand-overs check — and its roster (names only), which escorts check.
   */
  private syncTeams(): void {
    for (const e of this.engines.values()) {
      e.week.team = this.members
        .filter((m) => m.active && (m.edition_id == null || m.edition_id === e.week.edition.id))
        .map(({ id, display_name, gender, role }) => ({ id, display_name, gender, role }));
      e.week.roster = this.rosterOf(e.week.edition.id);
    }
  }

  private rosterOf(editionId: number) {
    return this.roster
      .filter((r) => r.edition_id === editionId)
      .map(({ id, full_name, gender }) => ({ id, full_name, gender }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "he") || a.id - b.id);
  }

  changed(): void {
    for (const e of this.engines.values()) e.week.categories = structuredClone(this.categories);
    this.syncTeams();
    this.listeners.forEach((l) => l());
  }

  poolChanged(from: Engine): void {
    for (const e of this.engines.values()) if (e !== from) e.week.speakers = from.week.speakers;
    this.listeners.forEach((l) => l());
  }

  engine(editionId: number): Engine {
    return this.engines.get(editionId) ?? [...this.engines.values()][0];
  }

  canSee(editionId: number): boolean {
    return this.members.some((m) => m.active && m.email === DEMO_EMAIL && (m.edition_id == null || m.edition_id === editionId));
  }

  private mine() {
    return this.members.filter((m) => m.active && m.email === DEMO_EMAIL);
  }

  isMember(): boolean {
    return this.mine().length > 0;
  }

  isGlobalAdmin(): boolean {
    return this.mine().some((m) => m.role === "admin" && m.edition_id == null);
  }

  /** app.my_role(edition) = 'admin'. */
  adminOf(editionId: number): boolean {
    return this.isGlobalAdmin() || this.mine().some((m) => m.role === "admin" && m.edition_id === editionId);
  }

  /** app.my_member_id: the edition's own row first. */
  memberIdFor(editionId: number | null): number | null {
    const mine = this.mine().filter((m) => m.edition_id == null || m.edition_id === editionId);
    return (mine.find((m) => m.edition_id != null) ?? mine[0])?.id ?? null;
  }

  /** The knowledge base, the snapshots and «איך עבר» (v12) in app.member_has_history. */
  authored(memberId: number): boolean {
    return (
      this.notes.some((n) => n.created_by === memberId || n.updated_by === memberId) ||
      this.milestones.some((m) => m.created_by === memberId || m.done_by === memberId) ||
      this.snapshots.some((x) => x.created_by === memberId) ||
      this.shared.reviews.some((r) => r.written_by === memberId)
    );
  }

  async sessionEmail(): Promise<string | null> {
    return DEMO_EMAIL;
  }

  /** The demo keeps no snapshot (its data is in memory, and so works offline as it is); this is never stored. */
  deviceUserId(): string | null {
    return "demo";
  }

  async whoami(): Promise<WhoAmI> {
    const mine = this.members.filter((m) => m.active && m.email === DEMO_EMAIL);
    return {
      status: "ok",
      schema_version: EXPECTED_SCHEMA_VERSION,
      email: DEMO_EMAIL,
      display_name: mine.find((m) => m.role === "admin")?.display_name ?? mine[0]?.display_name ?? null,
      global_admin: mine.some((m) => m.role === "admin" && m.edition_id == null),
      memberships: mine.map((m) => ({ edition_id: m.edition_id, role: m.role, member_id: m.id })),
    };
  }

  async signInWithGoogle(): Promise<void> {}
  async signOut(): Promise<void> {}
  onAuthChange(): () => void {
    return () => {};
  }
  async authError(): Promise<string | null> {
    return null;
  }

  async editions(): Promise<Edition[]> {
    return [...this.engines.values()].map((e) => structuredClone(e.week.edition)).sort((a, b) => b.id - a.id);
  }

  async loadWeek(editionId: number): Promise<Week> {
    this.engine(editionId).syncFallen(); // a name rewritten from another edition's screen
    const week = structuredClone(this.engine(editionId).week);
    week.categories = structuredClone(this.categories);
    week.team = this.members
      .filter((m) => m.active && (m.edition_id == null || m.edition_id === week.edition.id))
      .map(({ id, display_name, gender, role }) => ({ id, display_name, gender, role }));
    week.roster = this.rosterOf(week.edition.id);
    return week;
  }


  commands(editionId: number): WeekCommands {
    const run = async <T>(fn: () => T): Promise<T> => {
      const out = fn();
      this.listeners.forEach((l) => l());
      return out;
    };
    const e = this.engine(editionId);
    return {
      propose: (speakerId: number, target: CellTarget, mode?: "self" | "offer") => run(() => e.propose(speakerId, target, mode)),
      unpropose: (pitchId: number) => run(() => e.unpropose(pitchId)),
      setPitch: (pitchId, state) => run(() => e.setPitch(pitchId, state)),
      closeLesson: (pitchId: number) => run(() => e.closeLesson(pitchId)),
      reopenLesson: (lessonId: number) => run(() => e.reopenLesson(lessonId)),
      moveLesson: (lessonId, to) => run(() => e.moveLesson(lessonId, to)),
      reshape: (day, rowStart, op: ReshapeOp) => run(() => e.reshape(day, rowStart, op)),
      updateLesson: (lessonId: number, version: number, patch: LessonPatch) => run(() => e.updateLesson(lessonId, version, patch)),
      // milestone 3 — the same engine, so a preview refuses what production refuses
      setPayment: (lessonId, version, amount, transport) => run(() => e.setPayment(lessonId, version, amount, transport)),
      decidePayments: (items: PaymentItem[], decision, note) => run(() => e.decidePayments(items, decision, note ?? null)),
      markConfirmSent: (lessonId, version) => run(() => e.markConfirmSent(lessonId, version)),
      setEscort: (lessonId, version, x: EscortPatch) => run(() => e.setEscort(lessonId, version, x)),
      setSources: (lessonId, version, x: SourcesPatch) => run(() => e.setSources(lessonId, version, x)),
      setPaid: (lessonId, paid) => run(() => e.setPaid(lessonId, paid)),
      transport: async (lessonId) => structuredClone(e.transportOf(lessonId)),
      importNote: async (lessonId) => e.importNoteOf(lessonId),
      setTransport: (lessonId, d) => run(() => e.setTransport(lessonId, d)),
      // milestone 5ב-2
      transports: async () => structuredClone(e.transportsOf()),
      addMemorialSlot: (day, start, end, roomId) => run(() => e.addMemorialSlot(day, start, end, roomId)),
      removeMemorialSlot: (lessonId) => run(() => e.removeMemorialSlot(lessonId)),
      addMemorialPlan: (fallenId) => run(() => e.addMemorialPlan(fallenId)),
      updateMemorialPlan: (planId, version, patch) => run(() => e.updateMemorialPlan(planId, version, patch)),
      placeMemorialPlan: (planId, version, lessonId) => run(() => e.placeMemorialPlan(planId, version, lessonId)),
      deleteMemorialPlan: (planId) => run(() => e.deleteMemorialPlan(planId)),
      setMemorialPolicy: (policy) => run(() => e.setMemorialPolicy(policy)),
      setGridRules: (rules) => run(() => e.setGridRules(rules)),
    };
  }

  subscribe(_editionId: number, onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }
}
