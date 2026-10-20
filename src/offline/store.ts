// Where a device keeps its snapshot: IndexedDB in the browser (one database, one object store, two keys), an
// in-memory map in the unit tests. `OfflineCopy` is the app's one door to it — saving after a load, deciding at
// start-up, clearing at sign-out — and checks every rule of src/offline/snapshot.ts on the way in and out.
import type { Me } from "../data/types";
import type { Week } from "../domain/types";
import { makeWeekSnapshot, type OfflineDecision, offlineDecision, readWeekSnapshot, readWhoamiSnapshot, type WeekSnapshot, type WhoamiSnapshot } from "./snapshot";

/** The IndexedDB database and store names (the e2e test reads them). */
export const OFFLINE_DB = "volozhin-offline";
export const OFFLINE_STORE = "snapshot";
const WEEK = "week";
const WHOAMI = "whoami";

/** Raw storage: what was put, under a key. */
export interface KeyValue {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

export function memoryKeyValue(): KeyValue & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return structuredClone(data.get(key));
    },
    async put(key, value) {
      data.set(key, structuredClone(value));
    },
    async clear() {
      data.clear();
    },
  };
}

/** IndexedDB; every call opens, does one thing in one transaction, and closes (no connection held to block a clear). */
export function indexedDbKeyValue(): KeyValue {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(OFFLINE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(OFFLINE_STORE)) req.result.createObjectStore(OFFLINE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexedDB blocked"));
    });
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, mode);
        const req = fn(tx.objectStore(OFFLINE_STORE));
        let result: T;
        req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
      });
    } finally {
      db.close();
    }
  };
  return {
    get: (key) => run("readonly", (s) => s.get(key)),
    put: async (key, value) => void (await run("readwrite", (s) => s.put(value, key))),
    clear: async () => void (await run("readwrite", (s) => s.clear())),
  };
}

/**
 * The device's copy of the week. Never throws: storage that cannot be used (a private window, a full disk, a browser
 * without IndexedDB) means no copy, never a broken app — and a week that fails the personal-data check is not saved.
 */
export class OfflineCopy {
  /** Bumped by every clear: a save that was already on its way when the device was cleared is cleared after it. */
  private generation = 0;

  constructor(
    private readonly kv: KeyValue,
    /** The user of the Supabase session stored on this device, read without the network. */
    private readonly deviceUserId: () => string | null,
    private readonly expectedVersion: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** After a successful load of the edition's Week. */
  async saveWeek(editionId: number, week: Week): Promise<boolean> {
    const uid = this.deviceUserId();
    if (!uid) return false;
    const g = this.generation;
    try {
      const snapshot = makeWeekSnapshot(uid, editionId, week, this.now(), this.expectedVersion);
      await this.dropOthers(uid);
      await this.kv.put(WEEK, snapshot);
      return await this.settled(g, uid);
    } catch (e) {
      console.warn("offline copy: the week was not saved", e);
      return false;
    }
  }

  /** After whoami answered «ok» — the name and roles the read-only day view shows. */
  async saveWhoami(me: Me): Promise<boolean> {
    const uid = this.deviceUserId();
    if (!uid) return false;
    try {
      const g = this.generation;
      const w: WhoamiSnapshot = { userId: uid, savedAt: this.now().toISOString(), me };
      await this.dropOthers(uid);
      await this.kv.put(WHOAMI, w);
      return await this.settled(g, uid);
    } catch (e) {
      console.warn("offline copy: whoami was not saved", e);
      return false;
    }
  }

  /** Started without a connection: what may be shown. A copy that is not this user's, or of another schema, is deleted. */
  async decide(): Promise<OfflineDecision> {
    let snapshot: WeekSnapshot | null = null;
    let whoami: WhoamiSnapshot | null = null;
    try {
      snapshot = readWeekSnapshot(await this.kv.get(WEEK));
      whoami = readWhoamiSnapshot(await this.kv.get(WHOAMI));
    } catch {
      return { kind: "none" };
    }
    const d = offlineDecision({ deviceUserId: this.deviceUserId(), snapshot, whoami, expectedVersion: this.expectedVersion });
    if (d.kind === "drop") await this.clear();
    return d;
  }

  /** Another user signed in here: what the device kept for the one before goes at once, not at their next load. */
  private async dropOthers(uid: string): Promise<void> {
    const week = (await this.kv.get(WEEK)) as { userId?: unknown } | undefined;
    const whoami = (await this.kv.get(WHOAMI)) as { userId?: unknown } | undefined;
    if ((week && week.userId !== uid) || (whoami && whoami.userId !== uid)) await this.kv.clear();
  }

  /** A save that landed after a clear (a sign-out while a load was on its way), or for a user no longer here, is undone. */
  private async settled(g: number, uid: string): Promise<boolean> {
    if (this.generation === g && this.deviceUserId() === uid) return true;
    await this.kv.clear();
    return false;
  }

  /** Sign-out, a refusal, another schema: nothing stays on the device. */
  async clear(): Promise<void> {
    this.generation++;
    try {
      await this.kv.clear();
    } catch (e) {
      console.warn("offline copy: could not clear", e);
    }
  }
}
