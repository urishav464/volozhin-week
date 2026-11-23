// After the week (milestone 6) in a real browser. Demo build, every width: the
// week's date set in the past, «איך עבר» written on «אחרי השבוע» (since the
// reset's phase 5 the grid's panel is a summary: no section of its own), the
// summary counting it (and its xlsx) — a missing one opens on «אחרי השבוע» — the
// speaker page's past year; «אחרי השבוע» (/after, the reset, phase 3) for the
// staff: my closed lessons and their windows, «כל השיעורים» with the counts, a
// review written there; a trainee before the week's date is known reads one
// line; the purge — refused while the week is not over, the label typed, the
// report, the links revoked; the rollover checklist and its dry run, the option
// «להשבית…» on by default and labelled «הצעה». Mock build: a content member's
// review goes out by the parameter names tests/sql/after.test.ts pins — from
// «אחרי השבוע», where a lesson whose day has not passed reads only and its window
// says when; before the first day has passed the page is one line and the header
// hides it; a logistics member never asks for a review — `/grid` sends them to
// «השבוע», the lesson page has no «איך עבר», nor the speaker page's reviews, no
// summary, no «אחרי השבוע». Synthetic people and words only.
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoWeek } from "../../src/data/demoWeek";
import { addDays, israelDate } from "../../src/domain/israelTime";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { goSection, noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const card = (page: Page, speaker: string) => page.locator("[data-lesson-id]").filter({ hasText: speaker });

/** «15.2.2027» — an Israel date as the site writes it (ReviewStage.tsx dateText). */
const dateText = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
};

/** A Sunday at least `days` days before today in Israel — a week that has passed. */
function pastSunday(days: number): string {
  let d = addDays(israelDate(new Date().toISOString()), -days);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) d = addDays(d, -1);
  return d;
}

async function openLesson(page: Page, info: TestInfo, day: string, speaker: string): Promise<Locator> {
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  await card(page, speaker).first().click();
  const panel = page.getByRole("dialog", { name: "שיעור סגור" });
  await expect(panel).toBeVisible();
  return panel;
}

/** «הגדרות ← מחזור»: the demo week's opening date set (to a past Sunday: the week is over). */
async function setDemoDate(page: Page, info: TestInfo, date: string) {
  await goSection(page, "הגדרות");
  await page.getByRole("tab", { name: "מחזור" }).click();
  const editions = page.getByRole(info.project.name === "desktop" ? "table" : "list", { name: "המחזורים" });
  await editions.getByRole("button", { name: "עריכת התאריכים של הדגמה" }).click();
  await editions.getByLabel("תאריך הפתיחה (יום ראשון)").fill(date);
  await editions.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(toast(page, "התאריכים נשמרו")).toBeVisible();
}

test.describe("demo build", () => {
  test("«איך עבר» after the week: written on «אחרי השבוע», counted in the summary and its xlsx; the sheet shows a past year", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/after`);
    // before: the week's date is TBD — the row says so, and the instructor (the demo's user) may write anyway
    let twelve = page.locator("[data-after-row]").filter({ hasText: "מרצה 12" });
    await expect(twelve).toHaveAttribute("data-window", "tbd");
    await twelve.getByRole("button", { name: "כתיבה" }).click();
    await expect(twelve).toContainText("המדריך/ה יכול/ה לכתוב בכל זמן");
    await twelve.getByRole("button", { name: "סגירה" }).click();
    await expect(twelve.getByRole("form", { name: "איך עבר" })).toHaveCount(0);

    // the week in the past: «סיכום המחזור» → «לכתיבת "איך עבר"», every lesson's window open
    await setDemoDate(page, info, pastSunday(7));
    await goSection(page, "ידע");
    await page.getByRole("navigation", { name: "ידע" }).getByRole("link", { name: "סיכום המחזור" }).click();
    await page.getByRole("link", { name: 'לכתיבת "איך עבר"' }).click();
    await expect(page).toHaveURL(/\/after\?all=1$/);
    twelve = page.locator("[data-after-row]").filter({ hasText: "מרצה 12" });
    await expect(twelve).toHaveAttribute("data-window", "open");
    await expect(twelve).toContainText("עוד לא נכתב");
    await twelve.getByRole("button", { name: "כתיבה" }).click();
    const form = twelve.getByRole("form", { name: "איך עבר" });
    await expect(form.getByRole("button", { name: "שמירה" })).toBeDisabled(); // nothing said yet
    await form.getByLabel("מה עבד (לא חובה)").fill("נכתב בבדיקה: השיעור היה ברור");
    await form.getByRole("group", { name: "להזמין שוב?" }).getByRole("radio", { name: "כן" }).check();
    await form.getByRole("group", { name: "ציון (לא חובה)" }).getByRole("radio", { name: "4" }).check();
    await form.getByLabel("חרגה מהזמן").check(); // the speaker's gender
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "«איך עבר» נשמר")).toBeVisible();
    await expect(twelve).toHaveAttribute("data-written", "yes");
    await expect(twelve).toContainText("להזמין שוב: כן · ציון 4/5 · חרגה מהזמן");
    await expect(twelve).toContainText("נכתב ע״י"); // the form stays open, as saved

    // the card's five dots are what they were: «איך עבר» is no stage
    await goSection(page, "השבוע");
    if (info.project.name !== "desktop") await page.getByRole("tab", { name: "שני" }).click();
    await expect(card(page, "מרצה 12").first().locator("[data-stage]")).toHaveCount(5);

    // the summary: four of the eighteen closed lessons reviewed, the new one on «להזמין שוב»
    await goSection(page, "ידע");
    await page.getByRole("navigation", { name: "ידע" }).getByRole("link", { name: "סיכום המחזור" }).click();
    await expect(page).toHaveURL(/\/knowledge\/summary$/);
    const held = demoWeek().lessons.filter((l) => l.kind === "lesson" && l.state === "closed").length;
    await expect(page.locator("[data-summary=reviews]")).toHaveText(`4 מתוך ${held}`);
    await expect(page.getByRole("list", { name: "להזמין שוב" })).toContainText("פרופ׳ מרצה 12");
    await expect(page.getByRole("list", { name: "עוד לא נכתב" }).getByRole("listitem")).toHaveCount(held - 4);
    await expect(page.locator("[data-day]")).toHaveCount(5);
    await noSidewaysScroll(page);
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "הורדה כ-xlsx" }).click()]);
    expect(d.suggestedFilename()).toMatch(/^volozhin-summary-edition-1-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const xml = Object.entries(unzipSync(readFileSync((await d.path())!)))
      .filter(([n]) => n.startsWith("xl/worksheets/"))
      .map(([, b]) => strFromU8(b))
      .join("");
    expect(xml).toContain("נכתב בבדיקה: השיעור היה ברור");
    expect(xml).toContain(`4 מתוך ${held}`);

    // a missing review opens on «אחרי השבוע» (the reset, phase 3): every lesson, that one open and in focus
    const missing = page.getByRole("list", { name: "עוד לא נכתב" }).getByRole("button").first();
    await missing.click();
    await expect(page).toHaveURL(/\/after\?all=1&lesson=\d+$/);
    const id = Number(/lesson=(\d+)/.exec(page.url())![1]);
    const row = page.locator(`[data-after-row="${id}"]`);
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute("data-written", "no");
    await expect(row.getByRole("form", { name: "איך עבר" })).toBeVisible();
    await expect(page.getByRole("group", { name: "אילו שיעורים" }).getByRole("button", { name: "כל השיעורים" })).toHaveAttribute("aria-pressed", "true");

    // the speaker page: the past year's «איך עבר» (the demo's synthetic past edition), from the grid panel's heading
    await goSection(page, "השבוע");
    const panel = await openLesson(page, info, "ראשון", "מרצה 01");
    await panel.getByRole("button", { name: "ד״ר מרצה 01" }).click();
    await expect(page).toHaveURL(/\/speakers\/1$/);
    const past = page.getByRole("region", { name: "איך עבר בשנים קודמות" });
    await expect(past).toContainText("מחזור קודם (לדוגמה)");
    await expect(past).toContainText("להזמין שוב: כן · ציון 5/5");
    await noSidewaysScroll(page);
  });

  test("«אחרי השבוע» for the staff: my closed lessons and their windows, «כל השיעורים» with the counts, a review written there", async ({ page }, info) => {
    // the week's date is TBD: an admin may still write — each of my rows says why the window is not open
    await page.goto(`${demoUrl()}/after`);
    const rows = page.locator("[data-after-row]");
    await expect(rows).toHaveCount(6); // the demo user's six closed lessons
    for (const r of await rows.all()) await expect(r).toHaveAttribute("data-window", "tbd");
    await expect(rows.first()).toContainText("התאריך עוד לא נקבע");
    await expect(rows.first().getByRole("button", { name: /^(כתיבה|עריכה)$/ })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "אחרי השבוע", includeHidden: true })).toHaveCount(0); // the staff reach it from «סיכום המחזור»

    // the week in the past: from «סיכום המחזור», «לכתיבת "איך עבר"» — every lesson, each window open
    await setDemoDate(page, info, pastSunday(7));
    await goSection(page, "ידע");
    await page.getByRole("navigation", { name: "ידע" }).getByRole("link", { name: "סיכום המחזור" }).click();
    await page.getByRole("link", { name: 'לכתיבת "איך עבר"' }).click();
    await expect(page).toHaveURL(/\/after\?all=1$/);
    const held = demoWeek().lessons.filter((l) => l.kind === "lesson" && l.state === "closed").length;
    await expect(rows).toHaveCount(held);
    await expect(page.locator("[data-after-counts]")).toHaveText(`נכתב: 3 · עוד לא נכתב: ${held - 3}`);
    for (const r of await rows.all()) await expect(r).toHaveAttribute("data-window", "open");
    await expect(rows.locator("text=בטיפול:").first()).toBeVisible(); // «כל השיעורים» names who handles each
    await noSidewaysScroll(page);

    // «השיעורים שלי»: mine only; one written here — the counts follow
    await page.getByRole("group", { name: "אילו שיעורים" }).getByRole("button", { name: "השיעורים שלי" }).click();
    await expect(page).toHaveURL(/\/after$/);
    await expect(rows).toHaveCount(6);
    const [written, missing] = (await page.locator("[data-after-counts]").innerText()).match(/\d+/g)!.map(Number);
    const twelve = rows.filter({ hasText: "מרצה 12" });
    await expect(twelve).toHaveAttribute("data-written", "no");
    await twelve.getByRole("button", { name: "כתיבה" }).click();
    await expect(page).toHaveURL(/\/after\?lesson=\d+$/); // the open row is in the address
    const form = twelve.getByRole("form", { name: "איך עבר" });
    await form.getByLabel("מה עבד (לא חובה)").fill("נכתב בבדיקה: מאחרי השבוע");
    await form.getByRole("group", { name: "להזמין שוב?" }).getByRole("radio", { name: "כן" }).check();
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "«איך עבר» נשמר")).toBeVisible();
    await expect(twelve).toHaveAttribute("data-written", "yes");
    await expect(twelve).toContainText("להזמין שוב: כן");
    await expect(page.locator("[data-after-counts]")).toHaveText(`נכתב: ${written + 1} · עוד לא נכתב: ${missing - 1}`);
    await expect.poll(() => page.evaluate(() => document.activeElement != null && document.activeElement !== document.body)).toBe(true);
  });

  test("a trainee while the week's date is TBD: «אחרי השבוע» is one calm line, and not in the header", async ({ page }) => {
    await page.goto(`${demoUrl()}/after?as=trainee`);
    await expect(page.locator("[data-after-closed]")).toHaveText("אפשר לכתוב «איך עבר» אחרי השבוע, כשהתאריך שלו ידוע.");
    await expect(page.locator("[data-after-row]")).toHaveCount(0);
    await expect(nav(page).getByRole("link")).toHaveText(["היום שלי", "מרצים", "השבוע", "עזרה"]);
    await noSidewaysScroll(page);
  });

  test("the purge: refused while the week is not over; the label typed; the report; the links revoked; idempotent", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/settings/edition`);
    const purge = page.locator("#purge-panel");
    await expect(purge).toContainText("אפשר למחוק רק אחרי שהשבוע נגמר (תאריך השבוע עוד TBD)");
    await expect(purge.getByRole("button", { name: /^מחיקת המידע האישי/ })).toHaveCount(0);

    await setDemoDate(page, info, pastSunday(7));
    await expect(purge).toContainText("קודם מייצאים את הארכיון");
    const typed = purge.getByLabel(/כדי למחוק, מקלידים את שם המחזור/);
    const button = purge.getByRole("button", { name: "מחיקת המידע האישי של הדגמה" });
    await typed.fill("הדגמ");
    await expect(button).toBeDisabled();
    await typed.fill("הדגמה");
    await noSidewaysScroll(page);
    await button.click();
    const report = purge.locator("[data-purge-report]");
    await expect(report).toContainText("נמחק המידע האישי של הדגמה");
    await expect(report).toContainText(/פרטי הסעה של [1-9]\d* שיעורים נמחקו/);
    await expect(report).toContainText(/[1-9]\d* קישורים בוטלו/);
    await expect(report).toContainText("17 טלפונים של ראשי קבוצות נמחקו"); // v16: the demo's group heads
    await expect(purge.locator("[data-purged]")).toContainText("נמחק ב-");
    await expect(purge.locator("[data-export-first]")).toHaveCount(0); // the «export first» warning is for before — not over the report
    // the checklist's third step is done
    await expect(page.getByRole("list", { name: "מעבר לשנה הבאה" }).locator("[data-step='3']")).toHaveAttribute("data-done", "true");
    // again: nothing more
    await typed.fill("הדגמה");
    await button.click();
    await expect(report).toContainText("פרטי הסעה של 0 שיעורים נמחקו");
    await expect(report).toContainText("0 קישורים בוטלו");
    await expect(report).toContainText("0 טלפונים של ראשי קבוצות נמחקו");

    // «קישורים»: every link of the edition revoked
    await page.getByRole("tab", { name: "קישורים" }).click();
    await expect(page.getByText("בתוקף עד")).toHaveCount(0);
    await expect(page.getByText("בוטל").first()).toBeVisible();
  });

  test("moving to next year: the checklist, the archive ticking its first step, the dry run, the option on by default — «הצעה»", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/edition`);
    const list = page.getByRole("list", { name: "מעבר לשנה הבאה" });
    await expect(list.locator("[data-step]")).toHaveCount(5);
    await expect(list.locator("[data-step='5']")).toContainText("מאגר המרצים");
    // v19: Saturday night's two lists go on — the tasks and the shopping list with its quantities, nothing done or bought
    await list.locator("[data-step='5']").getByText("מה עובר לשנה הבאה").click();
    await expect(list.locator("[data-step='5']")).toContainText("רשימת ההכנות של מוצ״ש — המשימות ורשימת הקניות עם הכמויות (בלי קבוצה ובלי «בוצע»/«נקנה»)");
    await expect(list.locator("[data-step='2']")).toContainText(/נכתבו 3 מתוך \d+/);
    await expect(list.locator("[data-step='1']")).toHaveAttribute("data-done", "false");

    // the archive, downloaded here, ticks the first step
    await list.locator("[data-step='1']").getByRole("button", { name: "לייצוא הארכיון" }).click();
    await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^הורדת הארכיון/ }).click()]);
    await expect(list.locator("[data-step='1']")).toHaveAttribute("data-done", "true");

    // the dry run: a demo week is no real edition — nothing to archive yet
    const dry = page.getByRole("button", { name: "הרצה יבשה" });
    await dry.click();
    await expect(page.locator("[data-dry=archive]")).toHaveText("אף מחזור (אין מחזור אמיתי פעיל)");
    await expect(page.locator("[data-dry=stays]")).toContainText(/\d+ מרצים · \d+ קטגוריות · 9 חללים/);
    // v16: no real edition to carry «תורנויות» from — nothing, and last year's shifts
    await expect(page.locator("[data-dry=copy]")).toContainText("0 תורנויות · 0 משימות הכנה למוצ״ש · בלי שעות משמרות שנקבעו (נשארות של אשתקד) · בלי רשימת תארים משלו (נשארת הרשימה הקבועה)");

    // a real edition, with a content member: the dry run would archive it and deactivate one
    await page.getByLabel("שם המחזור").fill("מחזור לדוגמה");
    await page.getByRole("button", { name: "פתיחת המחזור", exact: true }).click();
    await expect(toast(page, "המחזור מחזור לדוגמה נפתח")).toBeVisible();
    await page.getByRole("link", { name: "להוספת הצוות" }).click();
    await page.getByLabel("כתובת Gmail").fill("content.next@example.org");
    await page.getByLabel("שם", { exact: true }).fill("חבר/ת צוות לדוגמה");
    await page.getByRole("button", { name: "הוספה לצוות" }).click();
    await expect(toast(page, "חבר/ת צוות לדוגמה")).toBeVisible();
    await page.getByRole("tab", { name: "מחזור" }).click();
    await expect(page.getByRole("list", { name: "מעבר לשנה הבאה" })).toBeVisible();
    const option = page.locator("#start-panel");
    await option.getByRole("button", { name: "לפתיחת מחזור חדש" }).click();
    const box = option.getByRole("checkbox", { name: /להשבית את חברי הצוות של המחזור הקודם \(מלבד אדמינים\)/ });
    await expect(box).toBeChecked();
    await expect(option).toContainText("הצעה");
    await page.getByRole("button", { name: "הרצה יבשה" }).click();
    await expect(page.locator("[data-dry=archive]")).toHaveText("מחזור לדוגמה");
    await expect(page.locator("[data-dry=deactivate]")).toContainText("חבר/ת צוות אחד/ת (תוכן או לוגיסטיקה)");
    // the form says what the option does — never «the team can only view it» beside «they will not log in»
    const warning = option.locator("[data-start-warning]");
    await expect(warning).toContainText("חברי התוכן והלוגיסטיקה שלו לא ייכנסו עוד (האדמינים נשארים)");
    await expect(warning).not.toContainText("יוכל רק לצפות");
    // the confirm: a danger one — what will happen, with the dry run's count; its focus on «ביטול», so Enter opens nothing
    await option.getByLabel("שם המחזור").fill("מחזור הבא לבדיקה");
    await option.getByRole("button", { name: "פתיחת המחזור", exact: true }).click();
    const confirm = option.getByRole("group", { name: "אישור" });
    await expect(confirm).toContainText("מחזור לדוגמה עובר לארכיון");
    await expect(confirm.locator("[data-deactivate-count]")).toHaveText("חבר/ת צוות אחד/ת שלו (תוכן או לוגיסטיקה) יושבת/ת — לא ייכנס/תיכנס עוד.");
    await expect(confirm).toContainText("אין ביטול");
    await expect(confirm.getByRole("button", { name: "ביטול" })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "כן, לפתוח ולהעביר לארכיון" })).toHaveClass(/bg-bad/);
    await noSidewaysScroll(page);
    await page.keyboard.press("Enter");
    await expect(confirm).toHaveCount(0);
    await expect(toast(page, "המחזור מחזור הבא לבדיקה נפתח")).toHaveCount(0);
    await expect(option.getByRole("button", { name: "פתיחת המחזור", exact: true })).toBeVisible(); // nothing opened
    // the confirm cancelled: the focus back at «פתיחת המחזור», never on the page
    await expect(option.getByRole("button", { name: "פתיחת המחזור", exact: true })).toBeFocused();
    // the option off: nobody — and the form says the team stays, able to view
    await page.getByRole("checkbox", { name: /להשבית את חברי הצוות/ }).first().uncheck();
    await expect(warning).toContainText("הצוות שלו יוכל רק לצפות בו");
    // its confirm (no dry run): «ביטול» by the keyboard, and the focus back at «פתיחת המחזור»
    await option.getByRole("button", { name: "פתיחת המחזור", exact: true }).click();
    await expect(confirm.locator("[data-deactivate-count]")).toHaveText("הצוות שלו יישאר פעיל ויוכל לצפות בו.");
    await confirm.getByRole("button", { name: "ביטול" }).press("Enter");
    await expect(confirm).toHaveCount(0);
    await expect(option.getByRole("button", { name: "פתיחת המחזור", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "הרצה יבשה" }).click();
    await expect(page.locator("[data-dry=deactivate]")).toContainText("אף אחד (האפשרות כבויה)");
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  const who = (email: string, role: "content" | "logistics", member: number) => ({
    status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: "חבר/ת צוות לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role, member_id: member }],
  });

  test("a content member's review goes out as save_lesson_review by its parameter names, with the member's token; `/grid` is not theirs", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const week = demoWeek();
    week.edition = { ...week.edition, id: 7, kind: "real", start_date: pastSunday(7) };
    const sb = new FakeSupabase({ status: 200, body: who("content@example.org", "content", 2) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("load_reviews", []);
    sb.answers.set("save_lesson_review", 1);
    await sb.attach(page);
    const session = await signIn(page, "content@example.org");
    sb.token = session.access_token;
    // the writing grid is the staff's (the reset, phase 5): a trainee's `/grid` is «השבוע» to read
    await page.goto(`${mockUrl()}/grid`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/week$`));
    // «איך עבר» is written on «אחרי השבוע»: member 2 handles «מרצה 01» (Sunday 08:30)
    await goSection(page, "אחרי השבוע");
    const lesson = week.lessons.find((l) => l.day === 0 && l.start_min === 510 && l.state === "closed")!.id;
    const row = page.locator(`[data-after-row="${lesson}"]`);
    await expect(row).toHaveAttribute("data-window", "open");
    await row.getByRole("button", { name: "כתיבה" }).click();
    const form = row.getByRole("form", { name: "איך עבר" });
    await form.getByLabel("מה פחות (לא חובה)").fill("נכתב בבדיקה");
    await form.getByRole("group", { name: "להזמין שוב?" }).getByRole("radio", { name: "אולי" }).check();
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("save_lesson_review")).toEqual([
      { p_lesson: lesson, p_version: 0, p_went_well: null, p_issues: "נכתב בבדיקה", p_invite_again: "maybe", p_overran: false, p_rating: null },
    ]);
    expect(sb.rpc.get("load_reviews")?.[0]).toEqual({ p_edition: 7 });
    for (const fn of ["load_reviews", "save_lesson_review"]) for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
  });

  test("«אחרי השבוע» for a trainee: my closed lessons by time; one whose day has passed written there (save_lesson_review), one whose day has not reads only — ONE load_reviews, again after the save", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    // the week began yesterday (Israel): Sunday's lessons are open, Monday's opens tomorrow
    const today = israelDate(new Date().toISOString());
    const week = demoWeek();
    week.edition = { ...week.edition, id: 7, kind: "real", start_date: addDays(today, -1) };
    const sb = new FakeSupabase({ status: 200, body: who("content@example.org", "content", 2) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("load_reviews", []);
    sb.answers.set("save_lesson_review", 1);
    await sb.attach(page);
    const session = await signIn(page, "content@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    await expect(nav(page).getByRole("link")).toHaveText(["היום שלי", "מרצים", "השבוע", "אחרי השבוע", "עזרה"]);
    await nav(page).getByRole("link", { name: "אחרי השבוע" }).click();
    await expect(page).toHaveURL(/\/after$/);
    // member 2's six closed lessons, by time; no toggle — that is an admin's
    // by their lead speakers (Tuesday 16:00 holds two parallel lessons: member 2's is «מרצה 17»'s)
    const ledBy = (speaker: number) => week.lessonSpeakers.find((x) => x.speaker_id === speaker && x.role === "lead")!.lesson_id;
    const ids = [1, 5, 25, 29, 21, 17].map(ledBy); // Sunday 08:30, 11:30; Monday 10:00, the night; Tuesday 08:30, 16:00
    await expect(page.locator("[data-after-row]")).toHaveCount(6);
    expect(await page.locator("[data-after-row]").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-after-row"))))).toEqual(ids);
    await expect(page.getByRole("group", { name: "אילו שיעורים" })).toHaveCount(0);
    const sunday = page.locator(`[data-after-row="${ids[0]}"]`);
    const monday = page.locator(`[data-after-row="${ids[2]}"]`);
    await expect(sunday).toHaveAttribute("data-window", "open");
    await expect(sunday).toContainText("פתוח לכתיבה");
    await expect(monday).toHaveAttribute("data-window", "before");
    await expect(monday).toContainText(`נפתח ב-${dateText(addDays(today, 1))}`);

    // before its day has passed: read only, and it says from when
    await monday.getByRole("button", { name: "קריאה" }).click();
    await expect(monday.getByRole("form", { name: "איך עבר" })).toHaveCount(0);
    await expect(monday).toContainText(`אפשר לכתוב מ-${dateText(addDays(today, 1))}`);
    await monday.getByRole("button", { name: "סגירה" }).click();

    await sunday.getByRole("button", { name: "כתיבה" }).click();
    const form = sunday.getByRole("form", { name: "איך עבר" });
    await form.getByLabel("מה עבד (לא חובה)").fill("נכתב בבדיקה");
    await form.getByRole("group", { name: "ציון (לא חובה)" }).getByRole("radio", { name: "5" }).check();
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("save_lesson_review")).toEqual([
      { p_lesson: ids[0], p_version: 0, p_went_well: "נכתב בבדיקה", p_issues: null, p_invite_again: null, p_overran: false, p_rating: 5 },
    ]);
    // the page reads the edition's reviews once, and once more after the save — never one per lesson
    await expect.poll(() => sb.rpc.get("load_reviews")?.length ?? 0).toBe(2);
    expect(sb.rpc.get("load_reviews")).toEqual([{ p_edition: 7 }, { p_edition: 7 }]);
    for (const fn of ["load_reviews", "save_lesson_review"]) for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);

    // «סיכום המחזור» by its address (not in a trainee's header): my own missing review opens on «אחרי השבוע» at its row;
    // a lesson another member handles opens its lesson page — a trainee's «אחרי השבוע» lists their own lessons only
    sb.answers.set("edition_returning", []);
    await page.goto(`${mockUrl()}/knowledge/summary`);
    const missing = page.getByRole("list", { name: "עוד לא נכתב" });
    await missing.getByRole("button").filter({ hasText: "מרצה 01 ·" }).click();
    await expect(page).toHaveURL(new RegExp(`/after\\?lesson=${ids[0]}$`));
    await expect(page.locator(`[data-after-row="${ids[0]}"]`)).toBeFocused();
    await page.goBack();
    await missing.getByRole("button").filter({ hasText: "מרצה 04 ·" }).click();
    await expect(page).toHaveURL(new RegExp(`/lesson/${ledBy(4)}(\\?|$)`));
  });

  test("before the week's first day has passed: «אחרי השבוע» is not in a trainee's header, its page is one line, and nothing is read", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const today = israelDate(new Date().toISOString());
    const week = demoWeek();
    week.edition = { ...week.edition, id: 7, kind: "real", start_date: addDays(today, 3) };
    const sb = new FakeSupabase({ status: 200, body: who("content@example.org", "content", 2) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("load_reviews", []);
    await sb.attach(page);
    sb.token = (await signIn(page, "content@example.org")).access_token;
    await page.goto(`${mockUrl()}/after`);
    await expect(page.locator("[data-after-closed]")).toHaveText(`אפשר לכתוב «איך עבר» מ-${dateText(addDays(today, 4))}, היום שאחרי השיעור הראשון.`);
    await expect(page.locator("[data-after-row]")).toHaveCount(0);
    await expect(nav(page).getByRole("link")).toHaveText(["היום שלי", "מרצים", "השבוע", "עזרה"]);
    expect(sb.rpc.get("load_reviews")).toBeUndefined();
  });

  test("logistics never asks for «איך עבר»: `/grid` is «השבוע» to read, none on the lesson page or the speaker page, no summary, no «אחרי השבוע»", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const week = demoWeek();
    week.edition = { ...week.edition, id: 7, kind: "real", start_date: pastSunday(7) };
    const sb = new FakeSupabase({ status: 200, body: who("logistics@example.org", "logistics", 5) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    const session = await signIn(page, "logistics@example.org");
    sb.token = session.access_token;
    // the writing grid is the staff's (the reset, phase 5): logistics' `/grid` is «השבוע» to read
    await page.goto(`${mockUrl()}/grid`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/week$`));
    // a card opens the lesson page: the payment and the transport — never «איך עבר»
    await card(page, "מרצה 01").first().click();
    await expect(page).toHaveURL(/\/lesson\/\d+$/);
    await expect(page.locator('[data-page-step="pay"]')).toBeVisible();
    await expect(page.getByText("איך עבר")).toHaveCount(0);
    await page.locator("[data-lesson-header]").getByRole("link", { name: "ד״ר מרצה 01" }).click();
    await expect(page).toHaveURL(/\/speakers\/1$/);
    await expect(page.getByRole("region", { name: "שיעורים במחזורים" })).toBeVisible();
    await expect(page.getByRole("region", { name: "איך עבר בשנים קודמות" })).toHaveCount(0);
    // «אחרי השבוע» is not logistics': not in the header, and its address lands on their home
    await expect(nav(page).getByRole("link", { name: "אחרי השבוע", includeHidden: true })).toHaveCount(0);
    await page.goto(`${mockUrl()}/after`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/logistics$`));
    await goSection(page, "ידע");
    await expect(page.getByRole("heading", { name: "ידע ואבני דרך" })).toBeVisible();
    await expect(page.getByRole("link", { name: "סיכום המחזור" })).toHaveCount(0);
    for (const fn of ["load_reviews", "speaker_reviews", "edition_returning", "save_lesson_review"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });
});
