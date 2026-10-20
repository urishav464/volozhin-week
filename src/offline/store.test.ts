// OfflineCopy — the app's one door to the device's copy — on an in-memory store (IndexedDB itself is driven in
// tests/e2e/offline.spec.ts): saved only for the user signed in here, shown only to them, emptied by a clear even
// when a save was on its way, and never a thrown error from storage that cannot be used.
import { describe, expect, it, vi } from "vitest";
import type { Me } from "../data/types";
import type { Week } from "../domain/types";
import { emptyWeek } from "../testing/week";
import { type KeyValue, memoryKeyValue, OfflineCopy } from "./store";

const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000bb";
const me: Me = { status: "ok", schema_version: 10, email: "member@example.org", display_name: null, global_admin: false, memberships: [{ edition_id: 1, role: "content", member_id: 2 }] };
const at = new Date("2027-02-15T09:30:00Z");

function setup(user: string | null = A) {
  const kv = memoryKeyValue();
  const device = { user };
  const copy = new OfflineCopy(kv, () => device.user, 10, () => at);
  return { kv, device, copy };
}

describe("OfflineCopy", () => {
  it("saves the week and whoami for the user signed in here, and shows them to that user", async () => {
    const { kv, copy } = setup();
    expect(await copy.saveWeek(1, emptyWeek())).toBe(true);
    expect(await copy.saveWhoami(me)).toBe(true);
    expect(kv.data.get("week")).toMatchObject({ userId: A, editionId: 1, savedAt: at.toISOString(), schemaVersion: 10 });
    expect(kv.data.get("whoami")).toMatchObject({ userId: A, me });
    const d = await copy.decide();
    expect(d.kind).toBe("show");
    expect(d.kind === "show" && d.snapshot.week).toEqual(emptyWeek());
  });

  it("nobody signed in here: nothing is saved", async () => {
    const { kv, copy } = setup(null);
    expect(await copy.saveWeek(1, emptyWeek())).toBe(false);
    expect(await copy.saveWhoami(me)).toBe(false);
    expect(kv.data.size).toBe(0);
  });

  it("another user signed in on this device: not shown, and deleted", async () => {
    const { kv, device, copy } = setup();
    await copy.saveWeek(1, emptyWeek());
    await copy.saveWhoami(me);
    device.user = B;
    expect(await copy.decide()).toEqual({ kind: "drop" });
    expect(kv.data.size).toBe(0);
  });

  it("another user signs in here: what the device kept for the one before goes with their first save", async () => {
    const { kv, device, copy } = setup();
    await copy.saveWeek(1, emptyWeek());
    await copy.saveWhoami(me);
    device.user = B;
    expect(await copy.saveWhoami({ ...me, email: "other@example.org" })).toBe(true);
    expect(kv.data.has("week")).toBe(false); // A's week is gone before B's week has loaded
    expect(kv.data.get("whoami")).toMatchObject({ userId: B });
  });

  it("a build of another schema version: not shown, and deleted", async () => {
    const { kv, copy } = setup();
    await copy.saveWeek(1, emptyWeek());
    await copy.saveWhoami(me);
    const next = new OfflineCopy(kv, () => A, 11);
    expect(await next.decide()).toEqual({ kind: "drop" });
    expect(kv.data.size).toBe(0);
  });

  it("a week with a personal key anywhere is not saved", async () => {
    const { kv, copy } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const w = emptyWeek();
    (w.speakers as unknown[]).push({ id: 1, phone: "x" });
    expect(await copy.saveWeek(1, w)).toBe(false);
    expect(kv.data.has("week")).toBe(false);
    warn.mockRestore();
  });

  it("clear empties it all; a save that was on its way when the device was cleared is undone after it lands", async () => {
    const { kv, copy } = setup();
    await copy.saveWeek(1, emptyWeek());
    await copy.saveWhoami(me);
    await copy.clear();
    expect(kv.data.size).toBe(0);

    // the put is slow (a load's save in flight) and a sign-out clears meanwhile
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: KeyValue = { get: kv.get, clear: kv.clear, put: async (k, v) => (await gate, kv.put(k, v)) };
    const racing = new OfflineCopy(slow, () => A, 10, () => at);
    const saving = racing.saveWeek(1, emptyWeek() as Week);
    await racing.clear();
    release();
    expect(await saving).toBe(false);
    expect(kv.data.size).toBe(0);
  });

  it("a save that lands after the device's user changed (signed out meanwhile) is undone", async () => {
    const { kv, device } = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: KeyValue = { get: kv.get, clear: kv.clear, put: async (k, v) => (await gate, kv.put(k, v)) };
    const copy = new OfflineCopy(slow, () => device.user, 10, () => at);
    const saving = copy.saveWhoami(me);
    device.user = null;
    release();
    expect(await saving).toBe(false);
    expect(kv.data.size).toBe(0);
  });

  it("storage that cannot be used never throws: no copy, and nothing to show", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken: KeyValue = {
      get: () => Promise.reject(new Error("blocked")),
      put: () => Promise.reject(new Error("quota")),
      clear: () => Promise.reject(new Error("blocked")),
    };
    const copy = new OfflineCopy(broken, () => A, 10);
    expect(await copy.saveWeek(1, emptyWeek())).toBe(false);
    expect(await copy.saveWhoami(me)).toBe(false);
    expect(await copy.decide()).toEqual({ kind: "none" });
    await expect(copy.clear()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
