// Milestone 5ב-2, without internet, in a real browser — service workers on here only (playwright.config.ts blocks
// them elsewhere). The production builds register /sw.js; a member's week loaded once online opens offline from the
// device's snapshot: the day view, read-only, with the banner, at 390/820/1440 — and is live again when the connection
// returns. The caches hold the shell and nothing sent to Supabase; sign-out empties IndexedDB; another user's session
// or another schema never sees the snapshot; an expired token offline is not a sign-out. A changed /sw.js waits behind
// «גרסה חדשה של האתר זמינה» and takes over only on «רענון»; the kill switch's worker clears the caches and leaves.
// A link's page offline says plainly that it needs a connection, and keeps its token off the device. The memorial
// times (5ב-2's other half) travel in the snapshot as the team reads them — the yellow card and its plan, never a
// family's contact — and «זמני זיכרון» or «לוגיסטיקה» asked for offline say they need a connection. Synthetic data.
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import type { ScheduleView } from "../../src/data/publicPort";
import { fmtRange, LRM } from "../../src/domain/time";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { NAVIGATE_TIMEOUT_MS } from "../../src/offline/config";
import { OFFLINE_DB, OFFLINE_STORE } from "../../src/offline/store";
import { MOCK_URL, SLOW_NET_MS } from "./global-setup";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, fakeSession } from "./mock";

test.use({ serviceWorkers: "allow" });

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;
const SESSION_KEY = `sb-${new URL(MOCK_URL).hostname.split(".")[0]}-auth-token`;
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const TOKEN = "Tk9fUkVBTF9UT0tFTl9YWQ"; // the same synthetic token as tests/e2e/links.spec.ts (.gitleaks.toml)

const member = {
  status: "ok",
  schema_version: EXPECTED_SCHEMA_VERSION,
  email: "member@example.org",
  display_name: "נועה בדיקה",
  global_admin: false,
  memberships: [{ edition_id: 7, role: "content", member_id: 2 }],
};

const scheduleView: ScheduleView = {
  edition: { label: "מחזור לדוגמה", start_date: null },
  rows: [{ kind: "lesson", day: 0, date: null, start_min: 510, end_min: 585, speaker: "ד״ר מרצה לדוגמה", title: "כותרת לדוגמה", category: "קטגוריה לדוגמה", room: "חדר לדוגמה", parallel: false }],
};

const offlineBanner = (page: Page) => page.getByRole("status").filter({ hasText: "אין חיבור לאינטרנט — מוצג המצב מ" });
const lens = (page: Page) => page.getByRole("radiogroup", { name: "עדשה" });

/**
 * A member signed in on the mock build, the week the demo's (edition 7). Which session the page starts with is chosen
 * per load through sessionStorage — «other» another user's, «expired» this user's past its expiry — so a reload can
 * change it. `offline.on` makes every request to the fake Supabase fail as with no connection, whatever page.route does.
 */
async function signedIn(context: BrowserContext, page: Page) {
  const week = demoWeek();
  week.edition.id = 7;
  week.edition.kind = "real";
  const sb = new FakeSupabase({ status: 200, body: member });
  sb.answers.set("editions", [week.edition]);
  sb.answers.set("load_week", week);
  await sb.attach(context);
  const offline = { on: false };
  await context.route(`${MOCK_URL}/**`, (route) => (offline.on ? route.abort("internetdisconnected") : route.fallback()));
  const mine = fakeSession();
  const other = { ...fakeSession("other@example.org"), user: { ...fakeSession("other@example.org").user, id: OTHER_USER } };
  const expired = { ...mine, expires_at: Math.floor(Date.now() / 1000) - 3600 };
  await page.addInitScript(
    ([k, a, b, c]) => {
      const which = sessionStorage.getItem("e2e-session");
      if (which === "none") return;
      localStorage.setItem(k, which === "other" ? b : which === "expired" ? c : a);
    },
    [SESSION_KEY, JSON.stringify(mine), JSON.stringify(other), JSON.stringify(expired)] as const,
  );
  return { sb, week, offline };
}

/**
 * No connection — for the page AND its service worker. context.setOffline alone does not reach the worker's own
 * fetches in this Chromium (they are still answered), so the test server also drops every connection of this context
 * (the cookie `e2e-net=down`, tests/e2e/global-setup.ts): the worker's navigation really fails, and the cached shell
 * is what opens. Cookies ignore the port: the one cookie covers both builds' servers.
 */
async function noConnection(context: BrowserContext, on: boolean) {
  if (on) {
    await context.addCookies([{ name: "e2e-net", value: "down", url: process.env.E2E_MOCK_URL! }]);
    await context.setOffline(true);
  } else {
    await context.clearCookies({ name: "e2e-net" });
    await context.setOffline(false);
  }
}

/** The worker is active, and the snapshot of edition 7 is on the device. */
async function readyOffline(page: Page) {
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 15_000 }).toBe("activated");
  await expect.poll(() => stored(page)).toMatchObject({ week: { editionId: 7 }, whoami: { me: { email: "member@example.org" } } });
}

/** What IndexedDB holds for the offline copy. */
function stored(page: Page): Promise<{ week?: { editionId: number; userId: string; week: Record<string, unknown> }; whoami?: { userId: string; me: { email: string } }; count: number }> {
  return page.evaluate(
    ([db, store]) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(db, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(store);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction(store, "readonly");
          const s = tx.objectStore(store);
          const out: Record<string, unknown> = {};
          const w = s.get("week");
          const m = s.get("whoami");
          const n = s.count();
          tx.oncomplete = () => {
            req.result.close();
            if (w.result) out.week = w.result;
            if (m.result) out.whoami = m.result;
            out.count = n.result;
            resolve(out as never);
          };
        };
      }),
    [OFFLINE_DB, OFFLINE_STORE] as const,
  );
}

/** What a newer build of the site would have saved: the same copy, its schema version (and whoami's) one ahead. */
function bumpStored(page: Page): Promise<void> {
  return page.evaluate(
    ([db, store]) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(db, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction(store, "readwrite");
          const s = tx.objectStore(store);
          const w = s.get("week");
          const m = s.get("whoami");
          w.onsuccess = () => s.put({ ...w.result, schemaVersion: w.result.schemaVersion + 1 }, "week");
          m.onsuccess = () => s.put({ ...m.result, me: { ...m.result.me, schema_version: m.result.me.schema_version + 1 } }, "whoami");
          tx.oncomplete = () => {
            req.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [OFFLINE_DB, OFFLINE_STORE] as const,
  );
}

/** Every cache's name and every URL in it. */
function cached(page: Page): Promise<{ name: string; urls: string[] }[]> {
  return page.evaluate(async () => {
    const out: { name: string; urls: string[] }[] = [];
    for (const name of await caches.keys()) out.push({ name, urls: (await (await caches.open(name)).keys()).map((r) => r.url) });
    return out;
  });
}

test.describe("mock build", () => {
  test("the production build registers /sw.js and keeps the shell — nothing sent to Supabase, nothing with a key", async ({ context, page }) => {
    const { sb } = await signedIn(context, page);
    await page.goto(mockUrl());
    await expect(lens(page)).toBeVisible();
    await readyOffline(page);
    const reg = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL);
    expect(reg).toBe(`${mockUrl()}/sw.js`);
    expect(sb.count("/rest/v1/rpc/load_week")).toBeGreaterThan(0);

    const all = await cached(page);
    const shell = all.filter((c) => c.name.startsWith("volozhin-shell-"));
    expect(shell).toHaveLength(1);
    expect(shell[0].urls).toContain(`${mockUrl()}/`);
    expect(shell[0].urls.some((u) => /\/assets\/index-[^/]+\.js$/.test(u))).toBe(true);
    expect(shell[0].urls.some((u) => /\/assets\/worker-[^/]+\.js$/.test(u))).toBe(true); // the reader's worker, a lazy file
    // 5ב-2's lazy screens are in the shell too: «זמני זיכרון» and «לוגיסטיקה»
    expect(shell[0].urls.some((u) => /\/assets\/MemorialScreen-[^/]+\.js$/.test(u))).toBe(true);
    expect(shell[0].urls.some((u) => /\/assets\/LogisticsScreen-[^/]+\.js$/.test(u))).toBe(true);
    for (const c of all) {
      expect(c.name.startsWith("volozhin-")).toBe(true);
      for (const u of c.urls) {
        expect(u).not.toContain(new URL(MOCK_URL).host);
        expect(u).not.toMatch(/supabase|\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\//);
      }
    }

    // another build's file (a tab left on the old version): the SPA fallback answers its name with index.html —
    // passed on, never kept under that name (kept, it would answer the chunk with HTML even after a rollback)
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    expect(await page.evaluate(async () => (await fetch("/assets/OldScreen-0ld0ld00.js")).headers.get("content-type"))).toContain("text/html");
    const htmlUnderAssets = await page.evaluate(async () => {
      const out: string[] = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const r of await c.keys()) {
          if (new URL(r.url).pathname.startsWith("/assets/") && ((await c.match(r))?.headers.get("content-type") ?? "").includes("text/html")) out.push(r.url);
        }
      }
      return out;
    });
    expect(htmlUnderAssets).toEqual([]);
  });

  test("loaded once online, the week opens offline from the snapshot: the day view, read-only, with the banner — and live again when the connection returns", async ({ context, page }, info) => {
    const { sb, offline } = await signedIn(context, page);
    await page.goto(mockUrl());
    await expect(lens(page)).toBeVisible();
    await readyOffline(page);
    const saved = await stored(page);
    expect(saved.week!.userId).toBe(fakeSession().user.id);
    // only the Week is kept: its own keys, and no contact or transport detail anywhere in it
    expect(Object.keys(saved.week!.week).sort()).toEqual(
      ["approaches", "availability", "categories", "edition", "escortTicks", "fallen", "lessonSpeakers", "lessons", "memorialPlans", "pitches", "roster", "rooms", "rows", "sourceFiles", "speakers", "team"].sort(),
    );
    expect(JSON.stringify(saved.week!.week)).not.toMatch(/"(phone|email|pickup_address|driver_phone|driver_name|secretary_note|contact_name|relation)"/);

    offline.on = true;
    await noConnection(context, true);
    await page.reload();
    await expect(offlineBanner(page)).toBeVisible();
    await expect(offlineBanner(page)).toContainText(/מוצג המצב מיום \S+ \d{1,2}\.\d{1,2} בשעה \d{2}:\d{2}/);
    await expect(page.getByRole("tablist", { name: "ימים" })).toBeVisible();
    await expect(page.getByRole("banner").getByText(/נועה בדיקה/)).toBeVisible(); // the cached whoami
    // read-only: no lens, no pool, no navigation to the other screens, no free cell to propose into, nothing to drag
    await expect(lens(page)).toHaveCount(0);
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "אזורי המערכת" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(שבץ|מאגר|אזהרות|מאגר המרצים)/ })).toHaveCount(0);
    await expect(page.locator("button[data-drop^='cell:']")).toHaveCount(0);
    for (const d of ["ראשון", "שני", "שלישי", "רביעי", "חמישי"]) {
      await page.getByRole("tab", { name: d }).click();
      await expect(page.locator("button[data-drop^='cell:']")).toHaveCount(0);
    }
    expect(await page.locator("[data-free-cell]").count()).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "ראשון" }).click();
    // a card opens to read, and holds nothing to press but «סגירה»
    await page.locator("[data-lesson-id]").filter({ hasText: "מרצה" }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("לצפייה בלבד");
    await expect(sheet).toContainText("חדר");
    await expect(sheet.getByRole("button")).toHaveCount(1);
    await expect(sheet.getByRole("button", { name: "סגירה" })).toBeVisible();
    await expect(sheet.locator("input, select, textarea")).toHaveCount(0);
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה" }).click();
    if (info.project.name !== "phone") await expect(page.getByRole("tablist", { name: "ימים" })).toBeVisible();

    // back online: live again by itself, no reload
    await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));
    const whoamis = sb.count("/rest/v1/rpc/whoami");
    offline.on = false;
    await noConnection(context, false);
    await expect(lens(page)).toBeVisible({ timeout: 10_000 });
    await expect(offlineBanner(page)).toHaveCount(0);
    expect(sb.count("/rest/v1/rpc/whoami")).toBeGreaterThan(whoamis);
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBe(1);
  });

  test("memorial times offline: the yellow card and its plan from the snapshot, never a family's contact — «זמני זיכרון» and «לוגיסטיקה» say they need a connection", async ({ context, page }) => {
    const { week, offline } = await signedIn(context, page);
    const placed = week.memorialPlans.find((p) => p.lesson_id != null)!;
    const name = week.fallen.find((f) => f.id === placed.fallen_id)!.name;
    const slot = week.lessons.find((l) => l.id === placed.lesson_id)!;
    const liaison = week.roster.find((r) => r.id === slot.escort_roster_id)!.full_name;
    // a second slot in the same memorial row, in another room and with no plan yet (5ב-2: any part of the row, any room)
    const second = { ...slot, id: Math.max(...week.lessons.map((l) => l.id)) + 1, room_id: week.rooms.find((r) => r.id !== slot.room_id)!.id, escort_roster_id: null, version: 1 };
    week.lessons.push(second);
    await page.goto(mockUrl());
    await expect(lens(page)).toBeVisible();
    await readyOffline(page);
    const saved = (await stored(page)).week!.week;
    expect(saved.memorialPlans).toEqual(week.memorialPlans);
    expect(saved.fallen).toEqual(week.fallen);

    offline.on = true;
    await noConnection(context, true);
    await page.goto(`${mockUrl()}/memorial`);
    await expect(offlineBanner(page)).toBeVisible();
    await expect(offlineBanner(page)).toContainText("«זמני זיכרון» צריך חיבור לאינטרנט");
    await expect(page.locator("[data-memorial-plan]")).toHaveCount(0);
    await page.getByRole("tab", { name: "ראשון" }).click();
    const card = page.locator(`[data-memorial-card="${placed.id}"]`);
    await expect(card.locator("[data-memorial-name]")).toHaveText(name); // the name first; the title stays its accessible name
    await expect(card).toHaveAttribute("aria-label", new RegExp(`^זמן זיכרון – ${name}, `));
    // the day view shows every slot of the row, each its own yellow card — with its own time and room, told apart
    await expect(page.locator(`[data-memorial-card][aria-label*="${fmtRange(slot.start_min, slot.end_min)}"]`).filter({ visible: true })).toHaveCount(2);
    await expect(page.locator(`[data-lesson-id="${second.id}"]`)).toContainText("עוד לא שובץ/ה חלל/ה");
    const roomOf = (id: number) => week.rooms.find((r) => r.id === id)!.name;
    await expect(card.locator("[data-memorial-where]")).toHaveText(`${fmtRange(slot.start_min, slot.end_min)} · ${roomOf(slot.room_id)}`);
    await expect(page.locator(`[data-lesson-id="${second.id}"] [data-memorial-where]`)).toHaveText(`${fmtRange(slot.start_min, slot.end_min)} · ${roomOf(second.room_id)}`);
    await card.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("לצפייה בלבד");
    await expect(sheet).toContainText(`זמן זיכרון – ${name}`);
    await expect(sheet).toContainText(`ראשון · ${LRM}${fmtRange(slot.start_min, slot.end_min)}`); // the range left to right after the Hebrew day
    await expect(sheet).toContainText("המשפחה אישרה");
    await expect(sheet).toContainText("בלי חריגה");
    await expect(sheet).toContainText(liaison);
    await expect(sheet.getByRole("button")).toHaveCount(1);
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה" }).click();

    await page.goto(`${mockUrl()}/logistics/transports`);
    await expect(offlineBanner(page)).toContainText("«לוגיסטיקה» צריך חיבור לאינטרנט");
    await page.goto(`${mockUrl()}/`);
    await expect(offlineBanner(page)).toBeVisible();
    await expect(page.locator("[data-offline-elsewhere]")).toHaveCount(0);

    // back online on «זמני זיכרון»: the screen itself, by itself
    await page.goto(`${mockUrl()}/memorial`);
    await expect(offlineBanner(page)).toBeVisible();
    offline.on = false;
    await noConnection(context, false);
    await expect(page.locator("[data-memorial-plan]").first()).toBeVisible({ timeout: 10_000 });
    await expect(offlineBanner(page)).toHaveCount(0);
  });

  test("an expired token offline is not a sign-out: the snapshot shows; another user's session, or another schema, never sees it — and it is deleted", async ({ context, page }, info) => {
    test.skip(info.project.name !== "desktop", "the session's rules are the same at every width");
    const { offline } = await signedIn(context, page);
    await page.goto(mockUrl());
    await readyOffline(page);
    offline.on = true;
    await noConnection(context, true);

    await page.evaluate(() => sessionStorage.setItem("e2e-session", "expired"));
    await page.reload();
    await expect(offlineBanner(page)).toBeVisible();

    await page.evaluate(() => sessionStorage.setItem("e2e-session", "other"));
    await page.reload();
    await expect(page.getByRole("heading", { name: "אין חיבור לאינטרנט" })).toBeVisible();
    await expect(offlineBanner(page)).toHaveCount(0);
    await expect(page.locator("[data-lesson-id]")).toHaveCount(0);
    expect((await stored(page)).count).toBe(0);

    // a schema of another version: saved again online by this user, then stamped with another version
    await page.evaluate(() => sessionStorage.setItem("e2e-session", "mine"));
    offline.on = false;
    await noConnection(context, false);
    await page.reload();
    await readyOffline(page);
    await page.evaluate(
      ([db, store]) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.open(db, 1);
          req.onsuccess = () => {
            const tx = req.result.transaction(store, "readwrite");
            const s = tx.objectStore(store);
            const g = s.get("week");
            g.onsuccess = () => s.put({ ...g.result, schemaVersion: -1 }, "week");
            tx.oncomplete = () => {
              req.result.close();
              resolve();
            };
          };
        }),
      [OFFLINE_DB, OFFLINE_STORE] as const,
    );
    offline.on = true;
    await noConnection(context, true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "אין חיבור לאינטרנט" })).toBeVisible();
    expect((await stored(page)).count).toBe(0);
  });

  test("the week's load failing for want of a connection shows the snapshot; a refusal never does — and a refused whoami deletes it", async ({ context, page }, info) => {
    test.skip(info.project.name !== "desktop", "the gate's rules are the same at every width");
    const { sb } = await signedIn(context, page);
    await page.goto(mockUrl());
    await readyOffline(page);

    // whoami answers, the week does not: no connection by then
    await page.route(`${MOCK_URL}/rest/v1/rpc/load_week`, (route) => route.abort("internetdisconnected"));
    await page.reload();
    await expect(offlineBanner(page)).toBeVisible();
    await page.unroute(`${MOCK_URL}/rest/v1/rpc/load_week`);

    // the server refuses the week: an answer, not a lost connection — the error, never the snapshot
    await page.route(`${MOCK_URL}/rest/v1/rpc/load_week`, (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "not_member" }) }),
    );
    await page.reload();
    await expect(page.getByText("לא הצלחנו לטעון את השבוע")).toBeVisible();
    await expect(offlineBanner(page)).toHaveCount(0);
    await page.unroute(`${MOCK_URL}/rest/v1/rpc/load_week`);

    // whoami says «not a member» now: nothing stays on the device
    expect((await stored(page)).count).toBe(2);
    await page.route(`${MOCK_URL}/rest/v1/rpc/whoami`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "not_member", schema_version: EXPECTED_SCHEMA_VERSION }) }),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "הכתובת עדיין לא ברשימת הצוות" })).toBeVisible();
    await expect.poll(async () => (await stored(page)).count).toBe(0);
    void sb;
  });

  test("a network that takes requests and never answers — the page itself too: the shell after a few seconds, the snapshot after a few more — and the late answer still decides", async ({ context, page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await signedIn(context, page);
    await page.goto(mockUrl());
    await readyOffline(page);
    let answer!: () => void;
    const held = new Promise<void>((r) => (answer = r));
    await page.route(`${MOCK_URL}/rest/v1/rpc/whoami`, async (route) => {
      await held;
      await route.fallback();
    });
    // the site's own server takes the page's request and stays silent (global-setup.ts): the worker's navigation waits
    // a few seconds for it (NAVIGATE_TIMEOUT_MS), then answers with the cached shell — else nothing would ever show
    await context.addCookies([{ name: "e2e-net", value: "hang", url: mockUrl() }]);
    const started = Date.now();
    await page.reload({ timeout: 15_000 });
    expect(Date.now() - started).toBeLessThan(10_000);
    await expect(page.getByText("טוען…")).toBeVisible();
    await expect(offlineBanner(page)).toBeVisible({ timeout: 15_000 });
    answer();
    await expect(lens(page)).toBeVisible();
    await expect(offlineBanner(page)).toHaveCount(0);
    await context.clearCookies({ name: "e2e-net" });
  });

  test("sign-out empties IndexedDB — online, and offline from the day view", async ({ context, page }, info) => {
    test.skip(info.project.name === "tablet", "a phone and a desktop are enough");
    const { offline } = await signedIn(context, page);
    await page.goto(mockUrl());
    await readyOffline(page);
    await page.getByRole("button", { name: "התנתקות" }).click();
    await expect(page.getByRole("button", { name: "כניסה עם Google" })).toBeVisible();
    expect(await stored(page)).toEqual({ count: 0 });

    // again, signed out from the offline day view, its token expired by then: the session goes too, at once
    await page.evaluate(() => sessionStorage.removeItem("e2e-session"));
    await page.reload();
    await readyOffline(page);
    offline.on = true;
    await noConnection(context, true);
    await page.evaluate(() => sessionStorage.setItem("e2e-session", "expired"));
    await page.reload();
    await expect(offlineBanner(page)).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem("e2e-session", "none")); // a later load finds what sign-out left
    await page.getByRole("button", { name: "התנתקות" }).click();
    await expect(page.getByRole("button", { name: "כניסה עם Google" })).toBeVisible();
    expect(await stored(page)).toEqual({ count: 0 });
    expect(await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)).toBeNull();
    await page.reload();
    await expect(page.getByRole("button", { name: "כניסה עם Google" })).toBeVisible();
    await expect(offlineBanner(page)).toHaveCount(0);
  });

  test("a new version waits behind «גרסה חדשה של האתר זמינה» and takes over only on «רענון»", async ({ context, page }, info) => {
    test.skip(info.project.name === "tablet", "a phone and a desktop are enough");
    await signedIn(context, page);
    await page.goto(mockUrl());
    await readyOffline(page);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const before = (await cached(page)).find((c) => c.name.startsWith("volozhin-shell-"))!.name;
    await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));

    await context.addCookies([{ name: "e2e-sw", value: "next", url: mockUrl() }]);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    const banner = page.getByRole("status").filter({ hasText: "גרסה חדשה של האתר זמינה" });
    await expect(banner).toBeVisible();
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
    // it waits: the page was not reloaded, the old worker still answers, both caches exist
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBe(1);
    expect((await cached(page)).map((c) => c.name)).toEqual(expect.arrayContaining([before, `${before}-next`]));
    await noSidewaysScroll(page);

    const reloaded = page.waitForEvent("load");
    await banner.getByRole("button", { name: "רענון" }).click();
    await reloaded;
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay ?? "reloaded")).toBe("reloaded");
    await expect(lens(page)).toBeVisible();
    await expect(banner).toHaveCount(0);
    // the new worker took over and deleted the old version's cache
    await expect.poll(async () => (await cached(page)).map((c) => c.name).filter((n) => n.startsWith("volozhin-shell-"))).toEqual([`${before}-next`]);
  });

  for (const reloadedFirst of [false, true]) {
    test(`two tabs: B's «רענון» lets the new version in, and A's «רענון» then reloads A onto it (A ${reloadedFirst ? "reloaded after the install" : "installed the first worker"})`, async ({ context, page }, info) => {
      test.skip(info.project.name !== "desktop", "one width is enough for two tabs");
      await signedIn(context, page);
      await page.goto(mockUrl()); // tab A
      await readyOffline(page);
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      if (reloadedFirst) {
        await page.reload();
        await expect(lens(page)).toBeVisible();
      }
      const b = await context.newPage(); // tab B, the same browser
      await b.goto(mockUrl());
      await expect(lens(b)).toBeVisible();
      const before = (await cached(page)).find((c) => c.name.startsWith("volozhin-shell-"))!.name;
      await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));

      await context.addCookies([{ name: "e2e-sw", value: "next", url: mockUrl() }]);
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
      const banner = (p: Page) => p.getByRole("status").filter({ hasText: "גרסה חדשה של האתר זמינה" });
      await expect(banner(page)).toBeVisible();
      await expect(banner(b)).toBeVisible();

      // B first: B reloads onto the new worker
      const bReloaded = b.waitForEvent("load");
      await banner(b).getByRole("button", { name: "רענון" }).click();
      await bReloaded;
      await expect(banner(b)).toHaveCount(0);
      await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe("activated");
      expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBe(1); // A was not reloaded by itself
      await expect(banner(page)).toBeVisible();

      // then A: its «רענון» is not dead — A reloads, controlled by the new worker, the old version's cache gone
      const aReloaded = page.waitForEvent("load", { timeout: 10_000 });
      await banner(page).getByRole("button", { name: "רענון" }).click();
      await aReloaded;
      expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay ?? "reloaded")).toBe("reloaded");
      await expect(lens(page)).toBeVisible();
      await expect(banner(page)).toHaveCount(0);
      await expect.poll(() => page.evaluate(async () => navigator.serviceWorker.controller === (await navigator.serviceWorker.getRegistration())?.active)).toBe(true);
      await expect.poll(async () => (await cached(page)).map((c) => c.name).filter((n) => n.startsWith("volozhin-shell-"))).toEqual([`${before}-next`]);
      await b.close();
    });
  }

  test("offline, a newer build's copy on the device: the notice says so and offers the waiting worker's «רענון» — and that «התנתקות» deletes it", async ({ context, page }, info) => {
    test.skip(info.project.name === "tablet", "a phone and a desktop are enough");
    const { offline } = await signedIn(context, page);
    await page.goto(mockUrl());
    await readyOffline(page);
    // the next build waits (its worker installed while online), and a page of it already saved its copy (a plain reload)
    await context.addCookies([{ name: "e2e-sw", value: "next", url: mockUrl() }]);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
    await bumpStored(page);

    await noConnection(context, true);
    offline.on = true;
    await page.reload();
    const notice = page.locator("[data-newer-copy]");
    await expect(notice).toContainText("במכשיר יש עותק מגרסה חדשה יותר של האתר — «רענון» מציג אותו.");
    await expect(notice).toContainText("«התנתקות» מוחקת גם את העותק הזה מהמכשיר.");
    await expect(page.getByText("ובמכשיר הזה עוד אין עותק של השבוע")).toHaveCount(0); // never untrue: the copy is here
    expect(await stored(page)).toMatchObject({ count: 2, week: { schemaVersion: EXPECTED_SCHEMA_VERSION + 1 } }); // kept
    await noSidewaysScroll(page);

    // the notice's own «רענון»: the waiting worker takes over and the page reloads (offline, from the new worker's cache)
    await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));
    const reloaded = page.waitForEvent("load");
    await page.getByRole("main").getByRole("button", { name: "רענון" }).click();
    await reloaded;
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay ?? "reloaded")).toBe("reloaded");
    await expect.poll(() => page.evaluate(async () => navigator.serviceWorker.controller === (await navigator.serviceWorker.getRegistration())?.active)).toBe(true);
    expect(await stored(page)).toMatchObject({ count: 2 }); // still kept
  });

  test("the kill switch: its /sw.js deletes the caches and unregisters, without reloading anyone's page", async ({ context, page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    await signedIn(context, page);
    await page.goto(mockUrl());
    await readyOffline(page);
    expect((await cached(page)).length).toBeGreaterThan(0);
    await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));

    await context.addCookies([{ name: "e2e-sw", value: "kill", url: mockUrl() }]);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await expect.poll(async () => (await cached(page)).length).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBe(1);
    await expect(lens(page)).toBeVisible(); // the page keeps working, on the network

    // the next visit is the plain site: the app registers again only if the build still ships a shell — this one does,
    // so the kill switch's real use is a build with OFFLINE_SHELL_ENABLED = false (src/offline/config.ts)
  });

  test("a link's page never installs the shell: no worker, no cache", async ({ context, page }, info) => {
    test.skip(info.project.name !== "phone", "one width is enough");
    const sb = new FakeSupabase();
    sb.answers.set("schedule_view", scheduleView);
    await sb.attach(context);
    await page.goto(`${mockUrl()}/s#${TOKEN}`);
    await expect(page.locator("[data-schedule-row]")).toHaveCount(1);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    expect(await cached(page)).toEqual([]);
  });

  test("back to live by the half-minute retry alone, when the browser never says the connection is back", async ({ context, page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough");
    const { offline } = await signedIn(context, page);
    await page.clock.install();
    await page.goto(mockUrl());
    await readyOffline(page);
    offline.on = true; // the requests fail; the browser still believes it is online, so no «online» event will come
    await page.reload();
    await expect(offlineBanner(page)).toBeVisible();
    offline.on = false;
    await page.clock.fastForward(29_000);
    await expect(offlineBanner(page)).toBeVisible();
    await page.clock.fastForward(2_000);
    await expect(lens(page)).toBeVisible();
    await expect(offlineBanner(page)).toHaveCount(0);
  });

  test("a link's page offline says plainly that it needs a connection, keeps its token off the device, and loads when the connection returns", async ({ context, page }, info) => {
    const { sb, offline } = await signedIn(context, page);
    sb.answers.set("schedule_view", scheduleView);
    await page.goto(mockUrl());
    await readyOffline(page);

    offline.on = true;
    await noConnection(context, true);
    await page.goto("about:blank");
    await page.goto(`${mockUrl()}/s#${TOKEN}`);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("הקישור הזה צריך חיבור לאינטרנט.");
    await expect(alert.getByRole("button", { name: "לנסות שוב" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "מוצג המצב" })).toHaveCount(0); // never the team's snapshot
    await noSidewaysScroll(page);
    // the token is in memory only: not in the address bar, no cache, no storage
    expect(new URL(page.url()).hash).toBe("");
    const everything = JSON.stringify({ caches: await cached(page), idb: await stored(page), ls: await page.evaluate(() => ({ ...localStorage })), ss: await page.evaluate(() => ({ ...sessionStorage })) });
    expect(everything).not.toContain(TOKEN);

    offline.on = false;
    await noConnection(context, false);
    await expect(page.locator("[data-schedule-row]")).toHaveCount(1);
    void info;
  });
});

test.describe("demo build", () => {
  test("the shell opens offline: the demo's own data, in memory", async ({ context, page }) => {
    await page.goto(demoUrl());
    await expect(lens(page)).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 15_000 }).toBe("activated");
    await noConnection(context, true);
    await page.reload();
    await expect(page.getByRole("status").first()).toContainText("מצב הדגמה");
    await expect(lens(page)).toBeVisible(); // the demo needs no server: the week as always
    await expect(offlineBanner(page)).toHaveCount(0);
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain(OFFLINE_DB); // no snapshot in a demo
    await noSidewaysScroll(page);
  });

  test("the privacy page, as Cloudflare Pages serves it (/privacy.html a 308 to /privacy), is never answered with the app shell: online the page; on a network slower than the worker waits, the page, late; offline after a visit, the browser's own «no connection» — never the week", async ({ context, page }, info) => {
    test.skip(info.project.name === "tablet", "a phone and a desktop are enough");
    test.setTimeout(90_000);
    expect(SLOW_NET_MS).toBeGreaterThan(NAVIGATE_TIMEOUT_MS + 1000); // the slow network is slower than the worker waits
    const thePage = async (p: Page) => {
      await expect(p.getByRole("heading", { level: 1 })).toHaveText("מדיניות פרטיות");
      expect(new URL(p.url()).pathname).toBe("/privacy"); // where Cloudflare's 308 leads
      await expect(lens(p)).toHaveCount(0);
      await expect(p.getByRole("banner")).toHaveCount(0); // the app did not load
    };
    const week = async () => {
      await page.goto(demoUrl());
      await expect(lens(page)).toBeVisible();
    };
    await week();
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state), { timeout: 15_000 }).toBe("activated");
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    // online, under the worker: the link's address (a 308), and the address it leads to
    for (const address of ["/privacy.html", "/privacy"]) {
      await week();
      await page.goto(`${demoUrl()}${address}`);
      await thePage(page);
    }

    // a slow network: every answer SLOW_NET_MS late, past the worker's NAVIGATE_TIMEOUT_MS — the page comes, late
    for (const address of ["/privacy.html", "/privacy"]) {
      await week();
      await context.addCookies([{ name: "e2e-net", value: "slow", url: demoUrl() }]);
      await page.goto(`${demoUrl()}${address}`, { timeout: 30_000 });
      await thePage(page);
      await context.clearCookies({ name: "e2e-net" });
    }

    // offline after those visits — the 308 kept by the browser's own cache, so the hop to /privacy happens offline too
    await week();
    await noConnection(context, true);
    for (const address of ["/privacy.html", "/privacy"]) {
      const tab = await context.newPage(); // a new tab of this site, the worker in charge of it
      const failed = await tab.goto(`${demoUrl()}${address}`).then(() => null, (e: Error) => e.message);
      expect(failed, address).toMatch(/net::ERR_/); // the network's answer: none — not the cached shell
      await expect(lens(tab)).toHaveCount(0);
      await expect(tab.getByRole("banner")).toHaveCount(0);
      await tab.close();
    }
    await noConnection(context, false);
  });
});
