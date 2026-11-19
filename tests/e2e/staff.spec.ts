// The staff's screens (the reset, phase 3) in a real browser, demo build (the instructor, a global admin), every width.
// «ימים» (/day/:d): the day owners set in «הגדרות ← צוות ← ימים» (the default demo has none), then any day as a wide
// page — a tab each, the pair named (or «אין עדיין זוג ליום» with the way to set it), the slots in time order each with
// its next step and handler, «חריגים» (handled outside the pair; nothing on a day with no pair), «ראיתי» only for an
// owner of the day; /day with no day is my first owned day; /myday and a bad day send staff to /day. The grid's
// «אחריות»: each day's header names its pair and a card handled outside it is «חריג» — the same lessons «ימים» lists;
// a day with no pair marks nothing. «התקדמות» is a lesson × step table in the grid's place (cards on a phone and a
// tablet): its rows, the six steps as links to the lesson page, its filters. The writing grid stays the staff's `/`: no
// pool, a closed lesson's panel with «לדף השיעור», a speaker's name to their page, «+ מרצה חדש/ה» to /speakers/new.
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import { noSidewaysScroll } from "./helpers";

const demoUrl = () => process.env.E2E_DEMO_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const slot = (page: Page, speaker: string) => page.locator("[data-slot-card]").filter({ hasText: speaker });
const dayTab = (page: Page, name: string) => page.getByRole("tablist", { name: "ימי השבוע" }).getByRole("tab", { name: new RegExp(`^${name}`) });

/** The demo's lessons by place (src/data/demoWeek.ts). */
const lessonAt = (day: number, start: number) => demoWeek().lessons.find((l) => l.day === day && l.start_min === start && l.kind === "lesson" && l.state === "closed")!.id;
const draftAt = (day: number, start: number) => demoWeek().lessons.find((l) => l.day === day && l.start_min === start && l.kind === "lesson" && l.state === "draft")!.id;

/** «הגדרות ← צוות ← ימים»: Sunday to חניך/ה א׳ and ב׳; Monday to the instructor (the demo's user) and חניך/ה ב׳. */
async function setDayOwners(page: Page) {
  await page.goto(`${demoUrl()}/settings/team`);
  for (const [day, a, b, name] of [
    [0, "2", "3", "ראשון"],
    [1, "1", "3", "שני"],
  ] as const) {
    await page.locator(`[data-day-owner-select="${day}:0"]`).selectOption(a);
    await page.locator(`[data-day-owner-select="${day}:1"]`).selectOption(b);
    await page.locator(`li[data-day-owners="${day}"]`).getByRole("button", { name: /שמירה/ }).click();
    await expect(toast(page, `נשמר: יום ${name}`)).toBeVisible();
  }
}

/** The lesson ids of a list's rows, as an attribute names them. */
const ids = (page: Page, selector: string, attr: string) => page.locator(selector).evaluateAll((els, a) => els.map((e) => Number(e.getAttribute(a))).sort((x, y) => x - y), attr);
const slotIds = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) => els.map((e) => Number((e.getAttribute("data-slot-card") ?? "").split(":")[1])).sort((x, y) => x - y));

test.describe("demo build — «ימים»", () => {
  test("any day as a wide page: the pair, the slots with their next steps, «חריגים», «ראיתי» only for an owner", async ({ page }) => {
    await setDayOwners(page);
    await nav(page).getByRole("link", { name: "ימים" }).click();
    // no day in the address: my first owned day (Monday)
    await expect(page).toHaveURL(/\/day$/);
    await expect(nav(page).getByRole("link", { name: "ימים" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-day-page]")).toHaveAttribute("data-day-page", "1");
    await expect(page.getByRole("tablist", { name: "ימי השבוע" }).getByRole("tab")).toHaveCount(5);
    await expect(dayTab(page, "שני")).toHaveAttribute("aria-selected", "true");
    await expect(dayTab(page, "שני")).toContainText("שלי");
    // the chip is a word of its own to a screen reader («שני (שלי)», never «שנישלי»); a day not mine is its name alone
    await expect(dayTab(page, "שני")).toHaveAccessibleName("שני (שלי)");
    await expect(dayTab(page, "שלישי")).toHaveAccessibleName("שלישי");
    await expect(page.locator("[data-day-pair]")).toHaveText("הזוג: מדריך/ה (הדגמה) ו-חניך/ה ב׳");
    await expect(page.locator("[data-day-balance]")).toBeVisible();

    // the slots in time order, each with its next step; a lesson someone else handles names them
    const starts = await page.locator("[data-slot-card]").evaluateAll((els) => els.map((e) => e.querySelector("bdi")?.textContent ?? ""));
    const minutes = starts.map((t) => {
      const [h, m] = t.split("–")[0].split(":").map(Number);
      return (h < 6 || (h === 6 && m < 30) ? 1440 : 0) + h * 60 + m;
    });
    expect(minutes.length).toBeGreaterThan(5);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    await expect(slot(page, "מרצה 04")).toContainText("תשלום/הסעה");
    await expect(slot(page, "מרצה 08")).toContainText("לעדכן את המרצה");
    await expect(slot(page, "מרצה 12")).toContainText("לשלוח סיכום");
    await expect(slot(page, "מרצה 12").locator("[data-slot-handler]")).toHaveCount(0); // mine
    await expect(slot(page, "מרצה 25").locator("[data-slot-handler]")).toHaveText("בטיפול חניך/ה א׳");
    await noSidewaysScroll(page);

    // «חריגים»: handled outside the pair — highlighted in the slots, listed below, «חדש» for an owner until «ראיתי»
    const others = page.getByRole("region", { name: "חריגים — בטיפול מי שאינו מהזוג" });
    expect(await ids(page, "[data-other-lesson]", "data-other-lesson")).toEqual([lessonAt(1, 600), lessonAt(1, 930), lessonAt(1, 1470)].sort((a, b) => a - b));
    expect(await slotIds(page, "[data-slot-card][data-exception]")).toEqual(await ids(page, "[data-other-lesson]", "data-other-lesson"));
    await expect(slot(page, "מרצה 25")).toContainText("חריג");
    await expect(others.locator("[data-fresh]")).toHaveCount(3);
    await others.getByRole("button", { name: "ראיתי" }).click();
    await expect(others.locator("[data-fresh]")).toHaveCount(0);
    await expect(others.getByRole("button", { name: "ראיתי" })).toHaveCount(0);
    await expect(page.locator("#day-others")).toBeFocused(); // the button went with the marks: the list keeps the focus
    await expect(others.locator("[data-other-lesson]")).toHaveCount(3); // still listed, no longer new

    // a slot's step opens its lesson page there
    await slot(page, "מרצה 12").getByRole("link", { name: "לשיעור" }).click();
    await expect(page).toHaveURL(new RegExp(`/lesson/${lessonAt(1, 1200)}\\?step=msg$`));
    await expect(page.locator('[data-page-step="msg"] h3 button')).toHaveAttribute("aria-expanded", "true");
    await page.goBack();

    // ← is the next day (right to left): Tuesday has no pair — nothing is an exception, and an admin is shown where to set it
    await dayTab(page, "שני").press("ArrowLeft");
    await expect(page).toHaveURL(/\/day\/2$/);
    await expect(dayTab(page, "שלישי")).toBeFocused();
    await expect(page.locator("[data-day-pair]")).toContainText("אין עדיין זוג ליום");
    const setIt = page.locator("[data-day-pair]").getByRole("link", { name: "קובעים ב«הגדרות ← צוות ← ימים»" });
    await expect(setIt).toHaveAttribute("href", "/settings/team");
    expect((await setIt.boundingBox())!.height).toBeGreaterThanOrEqual(44); // a finger's target, like every settings link
    await expect(page.locator("[data-slot-card][data-exception]")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "חריגים — בטיפול מי שאינו מהזוג" })).toHaveCount(0);
    await noSidewaysScroll(page);

    // Sunday is the other pair's: its exceptions, and no «ראיתי» or «חדש» for whoever does not own it
    await dayTab(page, "ראשון").click();
    await expect(page).toHaveURL(/\/day\/0$/);
    await expect(page.locator("[data-day-pair]")).toHaveText("הזוג: חניך/ה א׳ ו-חניך/ה ב׳");
    expect(await ids(page, "[data-other-lesson]", "data-other-lesson")).toEqual([lessonAt(0, 600), lessonAt(0, 870), draftAt(0, 960)].sort((a, b) => a - b));
    expect(await slotIds(page, "[data-slot-card][data-exception]")).toEqual(await ids(page, "[data-other-lesson]", "data-other-lesson"));
    await expect(page.getByRole("button", { name: "ראיתי" })).toHaveCount(0);
    await expect(page.locator("[data-fresh]")).toHaveCount(0);
    await noSidewaysScroll(page);

    // the grid's «אחריות» marks the same lessons, by the same rule
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await page.getByRole("radio", { name: "אחריות" }).click();
    const tab = page.getByRole("tablist", { name: "ימים" });
    if (await tab.isVisible()) await tab.getByRole("tab", { name: /ראשון/ }).click();
    expect(await ids(page, '[data-day="0"] [data-lesson-id][data-exception]', "data-lesson-id")).toEqual([lessonAt(0, 600), lessonAt(0, 870), draftAt(0, 960)].sort((a, b) => a - b));
  });

  test("/day without a pair anywhere opens Sunday; a day that is not one goes to /day; /myday is a trainee's — staff go to /day", async ({ page }) => {
    await page.goto(`${demoUrl()}/day`);
    await expect(page.locator("[data-day-page]")).toHaveAttribute("data-day-page", "0");
    await expect(page.locator("[data-day-pair]")).toContainText("אין עדיין זוג ליום");
    await expect(page.locator("[data-slot-card][data-exception]")).toHaveCount(0); // a day with no owners marks nothing
    await page.goto(`${demoUrl()}/day/9`);
    await expect(page).toHaveURL(/\/day$/);
    await page.goto(`${demoUrl()}/myday`);
    await expect(page).toHaveURL(/\/day$/);
    await expect(page.getByRole("heading", { name: "ימים", level: 2 })).toBeVisible();
  });
});

test.describe("demo build — the grid's lenses", () => {
  test("«אחריות»: each day's header names its pair, a card handled outside it is «חריג», a day with no pair marks nothing", async ({ page }, info) => {
    const wide = info.project.name === "desktop";
    await setDayOwners(page);
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await expect(page.locator("[data-day-pair]")).toHaveCount(0); // only under «אחריות»
    await page.getByRole("radio", { name: "אחריות" }).click();
    await expect(page.locator("[data-owner-note]")).toHaveText("חריג: שיעור שמטופל על ידי מי שאינו מהזוג של היום.");
    const day = async (name: string) => {
      if (!wide) await page.getByRole("tablist", { name: "ימים" }).getByRole("tab", { name: new RegExp(name) }).click();
    };
    await day("ראשון");
    await expect(page.locator('[data-day-header="0"] [data-day-pair]').first()).toHaveText("הזוג: חניך/ה א׳ ו-חניך/ה ב׳");
    const sunday = page.locator('[data-day="0"] [data-lesson-id][data-exception]');
    await expect(sunday).toHaveCount(3);
    await expect(sunday.first()).toContainText("חריג");
    await expect(page.locator(`[data-lesson-id="${lessonAt(0, 600)}"]`)).toHaveAttribute("aria-label", /, חריג: בטיפול מי שאינו מהזוג של היום$/);
    await expect(page.locator(`[data-lesson-id="${lessonAt(0, 510)}"]`)).not.toHaveAttribute("data-exception"); // the pair's own
    await day("שני");
    await expect(page.locator('[data-day-header="1"] [data-day-pair]').first()).toHaveText("הזוג: מדריך/ה (הדגמה) ו-חניך/ה ב׳");
    await expect(page.locator('[data-day="1"] [data-lesson-id][data-exception]')).toHaveCount(3);
    await day("שלישי");
    await expect(page.locator('[data-day-header="2"] [data-day-pair]').first()).toHaveText("אין זוג ליום");
    await expect(page.locator('[data-day="2"] [data-lesson-id][data-exception]')).toHaveCount(0);
    if (wide) await expect(page.locator("[data-day-header] [data-day-pair]")).toHaveCount(5);
    // «רק של X» stays: the others fade, the marks stay
    await page.getByRole("group", { name: "מקרא האחריות" }).getByRole("button", { name: "חניך/ה ג׳" }).click();
    await expect(page.getByRole("group", { name: "מקרא האחריות" }).getByRole("button", { name: "רק של חניך/ה ג׳" })).toHaveAttribute("aria-pressed", "true");
    await day("ראשון");
    await expect(page.locator(`[data-lesson-id="${lessonAt(0, 510)}"]`)).toHaveClass(/opacity-30/);
    await expect(page.locator(`[data-lesson-id="${lessonAt(0, 600)}"]`)).not.toHaveClass(/opacity-30/);
    await noSidewaysScroll(page);
  });

  test("«התקדמות» is a lesson × step table in the grid's place: the rows, the six steps as links, the filters", async ({ page }, info) => {
    const table = info.project.name === "desktop"; // from 1024px; a card per lesson below
    await page.goto(demoUrl());
    await page.getByRole("radio", { name: "התקדמות" }).click();
    await expect(page.locator("[data-progress-table]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "התקדמות לפי שיעור" })).toBeVisible();
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "ימים" })).toHaveCount(0);
    // the closed lessons and the drafts someone is pitched in, six steps each
    const closed = demoWeek().lessons.filter((l) => l.kind === "lesson" && l.state === "closed").length;
    const rows = page.locator("[data-progress-row]");
    await expect(rows).toHaveCount(closed + 3);
    await expect(page.locator("[data-progress-row][data-draft]")).toHaveCount(3);
    await expect(page.locator("[data-step-cell]")).toHaveCount((closed + 3) * 6);
    await expect(page.getByRole("list", { name: "מקרא הנקודות" })).toBeVisible();
    if (table) {
      const t = page.getByRole("table", { name: "התקדמות לפי שיעור" });
      await expect(t.getByRole("columnheader")).toHaveText(["שעה", "שיעור", "בטיפול", "שיבוץ", "סגירה", "תשלום והסעה", "הודעת סיכום", "מקורות ומצגת", "מלווה"]);
      await expect(t.locator('th[scope="colgroup"]')).toHaveCount(5); // a heading row per day
    } else {
      await expect(page.getByRole("table", { name: "התקדמות לפי שיעור" })).toHaveCount(0);
      // a card's six dots: a finger's 44px each
      for (const h of await rows.first().locator("[data-step-cell] a").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
    }
    // a step's cell says its state in words to a screen reader, and opens the lesson page at that step
    const msg = page.locator(`[data-progress-row="${lessonAt(1, 1200)}"] [data-step-cell="msg"]`);
    await expect(msg).toHaveAttribute("data-state", "open");
    await expect(msg.getByRole("link")).toHaveAttribute("href", `/lesson/${lessonAt(1, 1200)}?step=msg`);
    await expect(msg.getByRole("link")).toHaveAccessibleName(/^הודעת סיכום: /);
    await expect(page.locator(`[data-progress-row="${lessonAt(1, 510)}"] [data-step-cell="pay"]`)).toHaveAttribute("data-state", "waiting");
    await noSidewaysScroll(page);

    // the filters: a day; «רק מה שחסר»; who handles it
    await page.getByLabel("יום", { exact: true }).selectOption({ label: "יום שני" });
    const monday = demoWeek().lessons.filter((l) => l.kind === "lesson" && l.state === "closed" && l.day === 1).length;
    await expect(rows).toHaveCount(monday);
    await expect(page.locator("[data-progress-filters]")).toContainText(`${monday} מתוך ${closed + 3} שיעורים`);
    await page.getByLabel("יום", { exact: true }).selectOption({ label: "כל הימים" });
    await page.getByRole("checkbox", { name: "רק מה שחסר" }).check();
    await expect.poll(() => rows.count()).toBeLessThan(closed + 3);
    for (const r of await rows.all()) await expect(r.locator('[data-step-cell][data-state="open"], [data-step-cell][data-state="waiting"], [data-step-cell][data-state="problem"]').first()).toBeAttached();
    await page.getByRole("checkbox", { name: "רק מה שחסר" }).uncheck();
    await page.getByLabel("בטיפול", { exact: true }).selectOption({ label: "חניך/ה א׳" });
    await expect.poll(() => rows.count()).toBeGreaterThan(0);
    for (const r of await rows.all()) await expect(r).toContainText("חניך/ה א׳");
    await page.getByLabel("בטיפול", { exact: true }).selectOption({ label: "בלי אחראי/ת" });
    await expect(page.getByText("אין שיעורים שמתאימים לסינון.")).toBeVisible();
    await page.getByLabel("בטיפול", { exact: true }).selectOption({ label: "כולם" });
    await noSidewaysScroll(page);

    await msg.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/lesson/${lessonAt(1, 1200)}\\?step=msg$`));
    await expect(page.locator('[data-page-step="msg"] h3 button')).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("demo build — the writing grid stays the staff's overview", () => {
  async function openClosed(page: Page, info: TestInfo, day: string, speaker: string) {
    if (info.project.name !== "desktop") await page.getByRole("tablist", { name: "ימים" }).getByRole("tab", { name: day }).click();
    await page.locator("[data-lesson-id]").filter({ hasText: speaker }).first().click();
    const panel = page.getByRole("dialog", { name: "שיעור סגור" });
    await expect(panel).toBeVisible();
    return panel;
  }

  test("no pool; a closed lesson's panel leads to its page; a speaker's name to theirs; «+ מרצה חדש/ה» to /speakers/new", async ({ page }, info) => {
    await page.goto(demoUrl());
    await expect(page.getByRole("radiogroup", { name: "עדשה" })).toBeVisible();
    await expect(page.getByRole("region", { name: "מאגר המרצים" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "מאגר" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "מאגר" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "שבץ" })).toHaveCount(0);
    await noSidewaysScroll(page);

    let panel = await openClosed(page, info, "שני", "מרצה 12");
    await panel.locator("[data-lesson-page]").click();
    await expect(page).toHaveURL(new RegExp(`/lesson/${lessonAt(1, 1200)}$`));
    await expect(page.locator("[data-lesson-header]")).toContainText("פרופ׳ מרצה 12");
    await page.goBack();

    panel = await openClosed(page, info, "שני", "מרצה 04");
    await panel.getByRole("button", { name: "פרופ׳ מרצה 04" }).click();
    await expect(page).toHaveURL(/\/speakers\/4$/);
    await expect(page.getByRole("heading", { level: 2, name: "פרופ׳ מרצה 04", exact: true })).toBeVisible();
    await expect(page.locator("#call")).toBeVisible();
    await page.goBack();

    await page.getByRole("link", { name: "+ מרצה חדש/ה" }).click();
    await expect(page).toHaveURL(/\/speakers\/new$/);
  });
});
