// The device's copy of the week: only the Week (by type and by its keys at run time), and shown only to the user it
// was saved for, of this schema version, in an edition they belong to.
import { describe, expect, it } from "vitest";
import { demoWeek } from "../data/demoWeek";
import type { Me } from "../data/types";
import type { Week } from "../domain/types";
import { emptyWeek } from "../testing/week";
import {
  assertWeekOnly,
  type DeepKeys,
  makeWeekSnapshot,
  offlineDecision,
  PERSONAL_KEYS,
  type PersonalKey,
  readWeekSnapshot,
  readWhoamiSnapshot,
  WEEK_KEYS,
  type WeekSnapshot,
  type WhoamiSnapshot,
} from "./snapshot";

// ---- by type: no property anywhere inside a Week is a contact or transport detail; a snapshot's week is a Week
type Leak = Extract<DeepKeys<Week>, PersonalKey>;
const noPersonalKeyInWeek: [Leak] extends [never] ? true : Leak = true;
const snapshotHoldsAWeek: WeekSnapshot["week"] extends Week ? (Week extends WeekSnapshot["week"] ? true : false) : false = true;
type SnapshotKeys = keyof WeekSnapshot;
const snapshotFields: [Exclude<SnapshotKeys, "userId" | "editionId" | "savedAt" | "schemaVersion" | "week">] extends [never] ? true : false = true;

const UID = "00000000-0000-4000-8000-0000000000aa";
const me = (patch: Partial<Me> = {}): Me => ({
  status: "ok",
  schema_version: 10,
  email: "member@example.org",
  display_name: "חבר/ת צוות לדוגמה",
  global_admin: false,
  memberships: [{ edition_id: 1, role: "content", member_id: 2 }],
  ...patch,
});
const snap = (patch: Partial<WeekSnapshot> = {}): WeekSnapshot => ({ userId: UID, editionId: 1, savedAt: "2027-02-14T08:00:00.000Z", schemaVersion: 10, week: emptyWeek(), ...patch });
const who = (patch: Partial<WhoamiSnapshot> = {}): WhoamiSnapshot => ({ userId: UID, savedAt: "2027-02-14T08:00:00.000Z", me: me(), ...patch });

describe("only the Week is kept", () => {
  it("by type: the Week has no contact or transport key, and a snapshot is the Week and four fields", () => {
    expect([noPersonalKeyInWeek, snapshotHoldsAWeek, snapshotFields]).toEqual([true, true, true]);
    expect(PERSONAL_KEYS).toEqual(expect.arrayContaining(["phone", "email", "pickup_address", "driver_phone", "driver_name", "contact_name", "relation"]));
  });

  it("the demo's whole week passes the runtime check, and keeps every key", () => {
    const w = demoWeek();
    expect(assertWeekOnly(w)).toBe(w);
    expect(Object.keys(w).sort()).toEqual([...WEEK_KEYS].sort());
  });

  it("the memorial times (v11) are kept as the team reads them: the plans and the fallen's names, never a family's contact", () => {
    const w = demoWeek();
    expect(w.memorialPlans.some((p) => p.lesson_id != null)).toBe(true);
    const back = readWeekSnapshot(JSON.parse(JSON.stringify(makeWeekSnapshot(UID, 1, w, new Date("2027-02-14T08:00:00Z"), 10))));
    expect(back?.week.memorialPlans).toEqual(w.memorialPlans);
    expect(back?.week.fallen).toEqual(w.fallen);
    expect(Object.keys(back!.week.fallen[0]).sort()).toEqual(["gender", "id", "name"]);
    // a family's contact person, wherever it would turn up, is never written to the device
    const family: [string, (w: Week) => void][] = [
      ["contact_name", (w) => w.fallen.push({ id: 9, name: "א", gender: null, contact_name: "x" } as never)],
      ["relation", (w) => w.memorialPlans.push({ ...demoWeek().memorialPlans[0], id: 9, relation: "x" } as never)],
      ["phone", (w) => w.memorialPlans.push({ ...demoWeek().memorialPlans[0], id: 9, contacts: { phone: "x" } } as never)],
      ["email", (w) => w.fallen.push({ id: 9, name: "א", gender: null, email: "x" } as never)],
    ];
    for (const [key, add] of family) {
      const x = demoWeek();
      add(x);
      expect(() => assertWeekOnly(x), key).toThrow(new RegExp(`personal data at .*${key}`));
    }
  });

  it("refuses a key that is not the Week's, a key missing, and a personal key anywhere inside", () => {
    expect(() => assertWeekOnly({ ...emptyWeek(), contacts: [] })).toThrow(/contacts/);
    const { roster: _gone, ...noRoster } = emptyWeek();
    expect(() => assertWeekOnly(noRoster)).toThrow(/roster/);
    const leaks: [string, (w: Week) => void][] = [
      ["phone", (w) => w.speakers.push({ ...demoWeek().speakers[0], phone: "x" } as never)],
      ["email", (w) => w.team.push({ id: 1, display_name: "א", gender: null, role: "admin", email: "x" } as never)],
      ["pickup_address", (w) => w.lessons.push({ ...demoWeek().lessons[0], pickup_address: "x" } as never)],
      ["driver_phone", (w) => ((w.edition.settings as Record<string, unknown>).transport = [{ driver_phone: "x" }])],
      ["secretary_note", (w) => w.roster.push({ id: 1, full_name: "א", gender: null, secretary_note: "x" } as never)],
    ];
    for (const [key, add] of leaks) {
      const w = emptyWeek();
      add(w);
      expect(() => assertWeekOnly(w), key).toThrow(new RegExp(`personal data at .*${key}`));
    }
    expect(() => assertWeekOnly(null)).toThrow();
    expect(() => assertWeekOnly([])).toThrow();
  });

  it("a snapshot is made only of a clean week", () => {
    const s = makeWeekSnapshot(UID, 7, emptyWeek(), new Date("2027-02-14T08:00:00Z"), 10);
    expect(s).toMatchObject({ userId: UID, editionId: 7, savedAt: "2027-02-14T08:00:00.000Z", schemaVersion: 10 });
    expect(() => makeWeekSnapshot(UID, 7, { ...emptyWeek(), extra: 1 } as Week, new Date(), 10)).toThrow();
  });

  it("reading back checks it all again: anything malformed reads as none", () => {
    const good = snap();
    expect(readWeekSnapshot(structuredClone(good))).toEqual(good);
    expect(readWeekSnapshot(null)).toBeNull();
    expect(readWeekSnapshot({ ...good, userId: "" })).toBeNull();
    expect(readWeekSnapshot({ ...good, savedAt: "yesterday" })).toBeNull();
    expect(readWeekSnapshot({ ...good, editionId: "1" })).toBeNull();
    expect(readWeekSnapshot({ ...good, week: { ...emptyWeek(), speakers: [{ phone: "x" }] } })).toBeNull();
    expect(readWhoamiSnapshot(who())).toEqual(who());
    expect(readWhoamiSnapshot({ ...who(), me: { status: "not_member", schema_version: 10 } })).toBeNull();
    expect(readWhoamiSnapshot({ ...who(), userId: 5 })).toBeNull();
  });
});

describe("offlineDecision: who may see the snapshot", () => {
  const decide = (o: Partial<Parameters<typeof offlineDecision>[0]>) =>
    offlineDecision({ deviceUserId: UID, snapshot: snap(), whoami: who(), expectedVersion: 10, ...o }).kind;

  it("the user it was saved for, with this schema, a member of its edition: shown", () => {
    const d = offlineDecision({ deviceUserId: UID, snapshot: snap(), whoami: who(), expectedVersion: 10 });
    expect(d).toEqual({ kind: "show", snapshot: snap(), me: me() });
    expect(decide({ whoami: who({ me: me({ memberships: [{ edition_id: null, role: "admin", member_id: 1 }] }) }) })).toBe("show");
    expect(decide({ whoami: who({ me: me({ global_admin: true, memberships: [] }) }) })).toBe("show");
  });

  it("nothing stored: nothing to show; half of it: nothing yet, and nothing deleted", () => {
    expect(decide({ snapshot: null, whoami: null })).toBe("none");
    expect(decide({ whoami: null })).toBe("none");
    expect(decide({ snapshot: null })).toBe("none");
  });

  it("nobody signed in on this device, or someone else: deleted, never shown", () => {
    expect(decide({ deviceUserId: null })).toBe("drop");
    expect(decide({ deviceUserId: "00000000-0000-4000-8000-0000000000bb" })).toBe("drop");
    expect(decide({ snapshot: snap({ userId: "00000000-0000-4000-8000-0000000000bb" }) })).toBe("drop");
    expect(decide({ whoami: who({ userId: "00000000-0000-4000-8000-0000000000bb" }) })).toBe("drop");
    expect(decide({ deviceUserId: null, whoami: null })).toBe("drop");
  });

  it("another schema version — the snapshot's or the cached whoami's: deleted", () => {
    expect(decide({ expectedVersion: 11 })).toBe("drop");
    expect(decide({ snapshot: snap({ schemaVersion: 9 }) })).toBe("drop");
    expect(decide({ whoami: who({ me: me({ schema_version: 9 }) }) })).toBe("drop");
  });

  it("an edition the member no longer belongs to (by the cached whoami): deleted", () => {
    expect(decide({ whoami: who({ me: me({ memberships: [{ edition_id: 2, role: "content", member_id: 2 }] }) }) })).toBe("drop");
  });
});
