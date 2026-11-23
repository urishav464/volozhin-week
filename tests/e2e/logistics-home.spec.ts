// «לוגיסטיקה ← בית» — the reset, phase 4 — in a real browser. Demo build `?as=logistics` (the demo edition made real,
// its week three weeks ahead — demoLogisticsStart —, a cohort that can drive and one that does not help, two shopping
// items), every width: `/` lands on the home; its three groups, always all there, «קרוב לשבוע» saying how far the
// week is; every task one line, its state, and its title the link to the page that does it — each lands there; the
// strip «בית» first and «הסעות וצוות» at /logistics/transports; an unknown tab, `/`, /myday, /after and /day/2 go
// home; «השבוע» reads the week with «לבית»; the board lists the cohorts whose staff can drive, those on campus that day
// first; a page's change shows on the home when it is opened again. Mock build: opening the home reads load_rota,
// load_kk and get_transports_for ONCE each and writes nothing; a failed load_kk turns «ספרים» alone «לא נטען» (the
// other tasks as they were) and «לנסות שוב» asks for it alone; a member who may not decide here (a practice week) asks
// for no transports and reads «לא זמין במחזור הזה». Every task's title and «לבית» are 44px targets both ways; the focus
// never falls to the page — «לנסות שוב» (the home stays while it asks) and «ביטול הסימון» on the reader. Synthetic data
// only («לדוגמה»).
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import type { LessonTransport } from "../../src/data/commands";
import { demoLogisticsStart, demoWeek } from "../../src/data/demoWeek";
import type { KkData } from "../../src/data/kk";
import type { RotaData } from "../../src/data/rota";
import { daysToWeek } from "../../src/domain/israelTime";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { weekLine } from "../../src/screens/logistics/tasks";
import { expectSections, INLINE_SECTIONS, LOGISTICS_SECTIONS, noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const strip = (page: Page) => page.getByRole("navigation", { name: "לוגיסטיקה" });
const home = (page: Page) => page.locator("[data-logistics-home]");
const task = (page: Page, key: string) => page.locator(`[data-task="${key}"]`);
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
/** What holds the focus: a control's accessible words, a marked region's hook, or «BODY» when it fell to the page. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || !a.isConnected) return "BODY";
    if (a.hasAttribute("data-logistics-home")) return "[data-logistics-home]";
    return (a.getAttribute("aria-label") ?? a.textContent ?? a.tagName).trim();
  });

/** The three groups, their tasks in order: what the home always shows. */
const GROUPS: [string, string, string[]][] = [
  ["start", "בהתחלה", ["presence", "assign"]],
  ["content", "כשהתוכן מוכן", ["requests", "books", "prints"]],
  ["near", "קרוב לשבוע", ["drivers", "payments", "reader", "prep"]],
];

/** Each task's title (the link), where it leads, and what that page shows once it is there. */
const LANDS: Record<string, [string, string, (page: Page) => Locator]> = {
  presence: ["נוכחות המכינות", "/logistics/rota/setup", (page) => page.getByRole("region", { name: "המכינות" })],
  assign: ["שיבוץ התורנויות", "/logistics/rota", (page) => page.getByRole("button", { name: "הצעה הוגנת" })],
  requests: ["בקשות שממתינות", "/approvals", (page) => page.getByRole("region", { name: "בקשות תשלום והסעה" })],
  books: ["ספרים", "/logistics/books", (page) => page.locator("[data-book-row]").first()],
  prints: ["הדפסות", "/logistics/prints", (page) => page.getByRole("region", { name: "להדפיס מראש" })],
  drivers: ["נהגים", "/logistics/transports", (page) => page.locator("[data-board-counts]")],
  payments: ["תשלומים", "/logistics/payments", (page) => page.locator("[data-payment-row]").first()],
  reader: ["המקראה לדפוס", "/reader", (page) => page.locator("[data-reader-sent]")],
  prep: ["מוצ״ש", "/logistics/rota/prep", (page) => page.locator('[data-prep-list="item"]')],
};

/** Every task's state and line, by key. */
async function states(page: Page): Promise<Record<string, [string, string]>> {
  const rows = await page.locator("[data-task]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-task")!, e.getAttribute("data-state")!, e.querySelector("p")?.textContent ?? ""] as const));
  return Object.fromEntries(rows.map(([k, s, l]) => [k, [s, l]]));
}

async function homeShape(page: Page) {
  await expect(page.locator("[data-task-group]")).toHaveCount(3);
  expect(await page.locator("[data-task-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task-group")))).toEqual(GROUPS.map(([k]) => k));
  for (const [key, title, tasks] of GROUPS) {
    const g = page.locator(`[data-task-group="${key}"]`);
    await expect(g.getByRole("heading", { level: 3 })).toHaveText(title);
    expect(await g.locator("[data-task]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task")))).toEqual(tasks);
    for (const t of tasks) await expect(g.locator(`[data-task="${t}"]`).getByRole("link")).toHaveText(LANDS[t][0]);
  }
  // the week's line only on «קרוב לשבוע»
  await expect(page.locator("[data-week-line]")).toHaveCount(1);
  await expect(page.locator('[data-task-group="near"] [data-week-line]')).toHaveCount(1);
}

test.describe("demo build — `?as=logistics`", () => {
  test("`/` is the home: three groups always, the week's distance, every task's state — and each title lands on its page", async ({ page }) => {
    await page.goto(`${demoUrl()}/?as=logistics`);
    await expect(page).toHaveURL(new RegExp(`${demoUrl()}/logistics$`));
    await expect(home(page)).toBeVisible();
    await expectSections(page, LOGISTICS_SECTIONS, INLINE_SECTIONS); // «מצגות» since the reset's phase 5; below 1024px the row's four and «עוד»
    await expect(nav(page).getByRole("link", { name: "בית", exact: true })).toHaveAttribute("aria-current", "page");
    await homeShape(page);
    // the demo's week opens on the first Sunday three weeks or more ahead (that mode only): «בעוד N ימים»
    const now = new Date().toISOString();
    const days = daysToWeek(demoLogisticsStart(now), now)!;
    expect(days).toBeGreaterThanOrEqual(21);
    await expect(page.locator("[data-week-line]")).toHaveText(weekLine(days));
    await expect(page.locator("[data-week-line]")).toHaveText(`בעוד ${days} ימים`);
    // the demo's state, task by task — the pages' own rules (nothing here is decided by the home)
    expect(await states(page)).toEqual({
      presence: ["done", "3 מכינות · עוזרות בתורנויות: 2 · יכולות להסיע: 1"],
      assign: ["open", "12 משמרות בלי אחראי/ת · חסרות קבוצות ב-14 משמרות"], // no assignment yet; a lead on Sunday's and Wednesday's mornings
      requests: ["open", "בקשה אחת ממתינה"],
      books: ["open", "3 ספרים עוד לא הוזמנו · ההרשמה עדיין פתוחה"],
      prints: ["open", "שיעור אחד עוד בלי קבצים"],
      drivers: ["open", "הסעה אחת עוד בלי נהג/ת"],
      payments: ["open", "תשלום אחד עוד לא שולם"],
      reader: ["open", "עוד לא נשלחה לדפוס"],
      prep: ["open", "0/4 משימות בוצעו · 0/2 פריטים נקנו"],
    });
    // each chip says its state in words, after the link's name
    await expect(task(page, "presence")).toContainText("הושלם");
    await expect(task(page, "reader")).toContainText("לטיפול");
    // every title is a target of 44px or more each way — the short ones («נהגים», «ספרים», «מוצ״ש») too
    for (const l of await page.locator("[data-task] a").all()) {
      const box = (await l.boundingBox())!;
      expect(box.height, await l.textContent() ?? "").toBeGreaterThanOrEqual(44);
      expect(box.width, await l.textContent() ?? "").toBeGreaterThanOrEqual(44);
    }
    await noSidewaysScroll(page);

    // every title is the way to its page; «בית» in the header brings the home back
    for (const [, , tasks] of GROUPS) {
      for (const key of tasks) {
        const [title, to, landed] = LANDS[key];
        const link = task(page, key).getByRole("link", { name: title, exact: true });
        await expect(link).toHaveAttribute("href", to);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`${demoUrl()}${to.replace(/\//g, "\\/")}$`));
        await expect(landed(page)).toBeVisible();
        await nav(page).getByRole("link", { name: "בית", exact: true }).click();
        await expect(home(page)).toBeVisible();
      }
    }
  });

  test("the strip: «בית» first, «הסעות וצוות» the board with the cohorts whose staff can drive — on campus that day first; an unknown tab, `/`, /myday, /after and /day/2 go home; «השבוע» has «לבית»", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics?as=logistics`);
    await expect(strip(page).getByRole("link")).toHaveText(["בית", "הסעות וצוות", "תשלומים", "ספרים", "הדפסות", "תורנויות"]);
    await expect(strip(page).locator("[aria-current]")).toHaveCount(1);
    await expect(strip(page).getByRole("link", { name: "בית" })).toHaveAttribute("aria-current", "page");
    for (const h of await strip(page).getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);

    // a cohort's staff that can drive, and its day away from campus: «א» can drive too, and is not on campus on Sunday
    await strip(page).getByRole("link", { name: "תורנויות" }).click();
    await page.getByRole("navigation", { name: "תורנויות" }).getByRole("link", { name: "קבוצות ומכינות" }).click();
    const cohorts = page.getByRole("region", { name: "המכינות" });
    await expect(cohorts.locator('[data-rota-cohort="ב"]')).toHaveAttribute("data-can-drive", "y");
    await expect(cohorts.locator('[data-rota-cohort="נ"]')).toHaveAttribute("data-helps-rota", "-");
    await expect(cohorts.locator('[data-rota-cohort="נ"]')).toContainText("לא עוזרת בתורנויות");
    await cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה א" }).click();
    const form = cohorts.getByRole("form", { name: "עריכת המכינה: מכינה לדוגמה א" });
    await form.getByRole("checkbox", { name: "הצוות שלה יכול להסיע" }).check();
    // saved by the keyboard: the form leaves, and «עריכה» of the line it stood for takes the focus back
    await form.getByRole("button", { name: "שמירה" }).focus();
    await page.keyboard.press("Enter");
    await expect(toast(page, "המכינה נשמרה")).toBeVisible();
    await expect(cohorts.locator('[data-rota-cohort="א"]')).toHaveAttribute("data-can-drive", "y");
    await expect(cohorts.getByRole("button", { name: "עריכה: מכינה לדוגמה א" })).toBeFocused();
    const sunday = page.getByRole("region", { name: "מתי בקמפוס" }).getByRole("button", { name: "כל היום: ראשון · מכינה לדוגמה א" });
    await expect(sunday).toHaveAttribute("aria-pressed", "true");
    await sunday.click();
    await expect(sunday).toHaveAttribute("aria-pressed", "false");

    // the board: Sunday — «ב» on campus first, then «א» (first by its order, but away that day); Monday both, by order
    await strip(page).getByRole("link", { name: "הסעות וצוות" }).click();
    await expect(page).toHaveURL(/\/logistics\/transports$/);
    await expect(strip(page).getByRole("link", { name: "הסעות וצוות" })).toHaveAttribute("aria-current", "page");
    await expect(strip(page).locator("[aria-current]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "יום ראשון: הסעה אחת" })).toHaveAttribute("aria-pressed", "true");
    const drive = page.locator("[data-drive-cohorts]");
    await expect(drive.getByRole("heading")).toHaveText("מכינות שהצוות שלהן יכול להסיע");
    const rows = drive.locator("[data-drive-cohort]");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("מכינה לדוגמה ב");
    await expect(rows.nth(0)).toHaveAttribute("data-present", "y");
    await expect(rows.nth(0)).toContainText("בקמפוס ביום הזה");
    await expect(rows.nth(1)).toContainText("מכינה לדוגמה א");
    await expect(rows.nth(1)).toHaveAttribute("data-present", "-");
    await expect(rows.nth(1)).toContainText("לא בקמפוס ביום הזה");
    await expect(drive).not.toContainText("מכינה לדוגמה נ"); // its staff does not drive
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "יום שני: הסעה אחת" }).click();
    await expect(rows.nth(0)).toContainText("מכינה לדוגמה א");
    await expect(rows.nth(1)).toContainText("מכינה לדוגמה ב");
    expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-present")))).toEqual(["y", "y"]);

    // the home's first task says so: two cohorts can drive now
    await strip(page).getByRole("link", { name: "בית" }).click();
    await expect(task(page, "presence")).toContainText("3 מכינות · עוזרות בתורנויות: 2 · יכולות להסיע: 2");

    // «השבוע» reads the week, its way back «לבית»
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await expect(page).toHaveURL(/\/week$/);
    const back = page.getByRole("link", { name: "לבית" });
    const backBox = (await back.boundingBox())!;
    expect(backBox.width).toBeGreaterThanOrEqual(44); // a word that short is still a 44px target
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    await back.click();
    await expect(page).toHaveURL(/\/logistics$/);
    await expect(home(page)).toBeVisible();

    // addresses that are not logistics': home (each a fresh load — the persona stays with the tab)
    for (const path of ["/logistics/nothing", "/", "/myday", "/after", "/day/2", "/day", "/no-such-page"]) {
      await page.goto(`${demoUrl()}${path}`);
      await expect(page, path).toHaveURL(new RegExp(`${demoUrl()}/logistics$`));
      await expect(home(page)).toBeVisible();
    }
    await noSidewaysScroll(page);
  });

  test("a page's change shows on the home opened again: an item bought, the reader marked «נשלח לדפוס»", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics?as=logistics`);
    await expect(task(page, "prep")).toHaveAttribute("data-state", "open");
    await task(page, "prep").getByRole("link", { name: "מוצ״ש" }).click();
    const items = page.locator('[data-prep-list="item"]');
    await expect(items.locator("[data-prep-item]")).toHaveCount(2);
    await expect(items.locator('[data-prep-item="1"] [data-qty]')).toHaveAttribute("data-qty", "2 (לדוגמה)");
    await items.getByRole("checkbox", { name: "נקנה: פריט 1" }).check();
    await expect(items.locator("[data-prep-count]")).toHaveText("נקנו 1 מתוך 2");
    await nav(page).getByRole("link", { name: "בית", exact: true }).click();
    await expect(task(page, "prep")).toContainText("0/4 משימות בוצעו · 1/2 פריטים נקנו");

    await task(page, "reader").getByRole("link", { name: "המקראה לדפוס" }).click();
    const sent = page.locator("[data-reader-sent]");
    await expect(sent).toHaveAttribute("data-sent", "-");
    await sent.getByRole("button", { name: "סימון שנשלחה לדפוס" }).click();
    await expect(toast(page, "סומן שהמקראה נשלחה לדפוס")).toBeVisible();
    await expect(sent).toHaveAttribute("data-sent", "y");
    await expect(sent).toContainText("סימן/ה: לוגיסטיקה (הדגמה).");
    // by the keyboard: «ביטול הסימון» leaves with the mark — the focus goes to the button that stays, never the page;
    // sending again keeps it there
    await sent.getByRole("button", { name: "ביטול הסימון" }).focus();
    await page.keyboard.press("Enter");
    await expect(toast(page, "הסימון בוטל")).toBeVisible();
    await expect(sent).toHaveAttribute("data-sent", "-");
    await expect(sent.getByRole("button", { name: "ביטול הסימון" })).toHaveCount(0);
    await expect(sent.getByRole("button", { name: "סימון שנשלחה לדפוס" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sent).toHaveAttribute("data-sent", "y");
    await expect(sent.getByRole("button", { name: "שליחה מחדש" })).toBeFocused();
    await nav(page).getByRole("link", { name: "בית", exact: true }).click();
    await expect(task(page, "reader")).toHaveAttribute("data-state", "done");
    await expect(task(page, "reader").locator("p")).toHaveText(/^נשלחה לדפוס ב-\d{1,2}\.\d{1,2}\.\d{4}$/);
    await expect(task(page, "reader")).toContainText("הושלם");
    await noSidewaysScroll(page);
  });
});

// ------------------------------------------------------------------ mock build

/** The demo's week as edition 7 (real unless asked otherwise); two requests wait: Sunday 14:30's payment, Monday 08:30's. */
function weekOf(kind: "real" | "practice" = "real") {
  const week = demoWeek();
  week.edition.id = 7;
  week.edition.kind = kind;
  const at = (day: number, start: number) => week.lessons.find((l) => l.day === day && l.start_min === start && l.kind === "lesson" && l.state === "closed")!;
  Object.assign(at(0, 870), { pay_amount: 150, approval: "pending" });
  return { week, at };
}

/** A small rota: one cohort marked on campus, one group with its size and head, one duty — every shift short of it. */
function rotaOf(): RotaData {
  return {
    cohorts: [{ id: 1, edition_id: 7, letter: "א", name: "מכינה לדוגמה א", diets: [], sort: 1, helps_rota: true, can_drive: true }],
    presence: [{ cohort_id: 1, day: 0, shift: 0 }],
    groups: [{ id: 11, edition_id: 7, cohort_id: 1, number: 1, size: 8, head_name: "ראש/ת קבוצה לדוגמה 1" }],
    duties: [],
    assignments: [],
    staff: [],
    prep: [{ id: 51, edition_id: 7, text: "משימת הכנה לדוגמה", group_id: null, done: true, sort: 1, kind: "task", qty: null }],
  };
}

const kkOf = (): KkData => ({
  groups: [
    { id: 21, title: "ספר לדוגמה", author: null, place: null, capacity: 5, open: true },
    { id: 22, title: "ספר לדוגמה ב", author: null, place: null, capacity: 5, open: true },
  ],
  leaders: [],
  signups: [],
  orders: [{ group_id: 21, copies: 3, ordered_at: "2026-11-01T10:00:00.000Z" }],
});

async function signedIn(page: Page, opts: { kind?: "real" | "practice"; role?: "logistics" | "content" } = {}) {
  const { week, at } = weekOf(opts.kind);
  const role = opts.role ?? "logistics";
  const email = `${role}@example.org`;
  const sb = new FakeSupabase({
    status: 200,
    body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: "חבר/ת צוות לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role, member_id: 5 }] },
  });
  const transports: LessonTransport[] = [
    { lesson_id: at(0, 510).id, pickup_address: "כתובת לדוגמה", pickup_time: "07:15", driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: true, approval: "approved", pickup_min: 435 },
    { lesson_id: at(3, 600).id, pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false, approval: "approved", pickup_min: null },
  ];
  sb.answers.set("editions", [week.edition]);
  sb.answers.set("load_week", week);
  sb.answers.set("load_rota", rotaOf());
  sb.answers.set("load_kk", kkOf());
  sb.answers.set("get_transports_for", transports);
  await sb.attach(page);
  const session = await signIn(page, email);
  sb.token = session.access_token;
  return { sb, session, week };
}

/** The calls the home makes, by function, once the network is quiet. */
async function settled(page: Page) {
  await expect(home(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const desktopOnly = (info: TestInfo) => test.skip(info.project.name !== "desktop", "one width is enough for the wire");

test.describe("mock build", () => {
  test("opening the home reads load_rota, load_kk and get_transports_for ONCE each, with the member's token — and writes nothing", async ({ page }, info) => {
    desktopOnly(info);
    const { sb, session } = await signedIn(page);
    await page.goto(mockUrl());
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/logistics$`));
    await settled(page);
    expect(sb.rpc.get("load_rota")).toEqual([{ p_edition: 7 }]);
    expect(sb.rpc.get("load_kk")).toEqual([{ p_edition: 7 }]);
    expect(sb.rpc.get("get_transports_for")).toEqual([{ p_edition: 7 }]);
    for (const fn of ["load_rota", "load_kk", "get_transports_for", "load_week"]) {
      const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
      expect(calls.length, fn).toBeGreaterThan(0);
      for (const c of calls) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
    // nothing else asked for, nothing written
    expect([...sb.rpc.keys()].sort()).toEqual(["get_transports_for", "load_kk", "load_rota", "load_week"]);
    expect(sb.writes).toEqual([]);
    expect(sb.calls.filter((c) => c.method !== "GET" && c.method !== "POST")).toEqual([]);

    // what the reads say, task by task
    expect(await states(page)).toMatchObject({
      presence: ["done", "מכינה אחת · עוזרות בתורנויות: 1 · יכולות להסיע: 1"],
      assign: ["empty", "עוד אין תורנויות"],
      requests: ["open", "2 בקשות ממתינות"],
      books: ["open", "ספר אחד עוד לא הוזמן"],
      drivers: ["open", "הסעה אחת עוד בלי נהג/ת"],
      prep: ["done", "1/1 משימות בוצעו"],
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("[data-week-line]")).toHaveText("תאריך השבוע עוד לא נקבע");
    // «בית» again (the same address): nothing read again
    await strip(page).getByRole("link", { name: "בית" }).click();
    await expect(home(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    for (const fn of ["load_rota", "load_kk", "get_transports_for"]) expect(sb.rpc.get(fn), fn).toHaveLength(1);
  });

  test("a failed load_kk: «ספרים» alone «לא נטען», the other tasks as they were; «לנסות שוב» asks for it alone", async ({ page }, info) => {
    desktopOnly(info);
    // first with every read answered: what each task says
    const { sb } = await signedIn(page);
    await page.goto(mockUrl());
    await settled(page);
    const good = await states(page);
    expect(good.books).toEqual(["open", "ספר אחד עוד לא הוזמן"]);
    const asked = (fn: string) => sb.rpc.get(fn)?.length ?? 0;
    const before = { kk: asked("load_kk"), rota: asked("load_rota"), transports: asked("get_transports_for") };

    sb.answers.delete("load_kk"); // the fake answers 404: the read is refused
    await page.reload();
    await settled(page);
    const now = await states(page);
    expect(now.books).toEqual(["unknown", "לא נטען"]);
    await expect(task(page, "books")).toContainText("לא ידוע");
    const { books: _b, ...others } = now;
    const { books: _g, ...expected } = good;
    expect(others).toEqual(expected);
    expect(Object.values(others).some(([, line]) => line === "לא נטען")).toBe(false);
    // said once, above the groups — not on every task
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText(/^לא הצלחנו לטעון חלק מהנתונים\./);
    await expect(alert).not.toContainText("לא נטען");
    await noSidewaysScroll(page);

    // «לנסות שוב» by the keyboard, the read held: the home stays (never «טוען…» in its place) and the busy button keeps
    // the focus; failed again — the same button, still focused
    const held: (() => void)[] = [];
    await page.route("**/rest/v1/rpc/load_kk", (route) => new Promise<void>((done) => held.push(() => void route.fallback().then(done))));
    const retry = alert.getByRole("button", { name: "לנסות שוב" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => held.length).toBe(1);
    await expect(alert.getByRole("button", { name: "טוען…" })).toHaveAttribute("aria-busy", "true");
    expect(await focused(page)).toBe("טוען…");
    await expect(home(page)).toBeVisible();
    await expect(task(page, "books")).toHaveAttribute("data-state", "unknown");
    held.shift()!();
    await expect(alert.getByRole("button", { name: "לנסות שוב" })).toBeVisible();
    await expect(task(page, "books")).toHaveAttribute("data-state", "unknown");
    expect(await focused(page)).toBe("לנסות שוב");
    // answered this time: the alert and its button leave — the focus goes to the home, not the page
    sb.answers.set("load_kk", kkOf());
    await page.keyboard.press("Enter");
    await expect.poll(() => held.length).toBe(1);
    // the request leaves before React draws the busy label: wait for the drawing, as above, then ask where the focus is
    await expect(alert.getByRole("button", { name: "טוען…" })).toHaveAttribute("aria-busy", "true");
    expect(await focused(page)).toBe("טוען…");
    held.shift()!();
    await expect(task(page, "books")).toHaveAttribute("data-state", "open");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe("[data-logistics-home]");
    expect(await states(page)).toEqual(good);
    expect(asked("load_kk")).toBe(before.kk + 3); // the failed read, and «לנסות שוב» twice
    expect(asked("load_rota")).toBe(before.rota + 1); // the reads that answered are not asked again
    expect(asked("get_transports_for")).toBe(before.transports + 1);
    expect(sb.writes).toEqual([]);
  });

  test("a failed load_rota: its three tasks «לא נטען» — the books and the transports keep theirs", async ({ page }, info) => {
    desktopOnly(info);
    const { sb } = await signedIn(page);
    sb.answers.delete("load_rota");
    await page.goto(mockUrl());
    await settled(page);
    const now = await states(page);
    for (const k of ["presence", "assign", "prep"]) expect(now[k], k).toEqual(["unknown", "לא נטען"]);
    expect(now.books).toEqual(["open", "ספר אחד עוד לא הוזמן"]);
    expect(now.drivers).toEqual(["open", "הסעה אחת עוד בלי נהג/ת"]);
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("a member who may not decide here (a practice week): no get_transports_for, «לא זמין במחזור הזה» — never a false «הושלם»", async ({ page }, info) => {
    desktopOnly(info);
    const { sb } = await signedIn(page, { kind: "practice" });
    await page.goto(mockUrl());
    await settled(page);
    expect(sb.rpc.get("get_transports_for")).toBeUndefined();
    expect(sb.calls.some((c) => c.path === "/rest/v1/rpc/get_transports_for" || c.path === "/rest/v1/transport_details")).toBe(false);
    expect(sb.rpc.get("load_rota")).toEqual([{ p_edition: 7 }]);
    expect(sb.rpc.get("load_kk")).toEqual([{ p_edition: 7 }]);
    const now = await states(page);
    expect(now.requests).toEqual(["unknown", "לא זמין במחזור הזה"]);
    expect(now.drivers).toEqual(["unknown", "לא זמין במחזור הזה"]);
    await expect(task(page, "drivers")).toContainText("לא ידוע");
    await expect(page.getByRole("alert")).toHaveCount(0); // nothing failed: the rule answers nothing here
    expect(sb.writes).toEqual([]);
  });
});
