// After the week (milestone 6) in a real browser. Demo build, every width: the
// week's date set in the past, «איך עבר» written in the lesson panel's sixth
// section, the summary counting it (and its xlsx), the speaker sheet's past
// year; the purge — refused while the week is not over, the label typed, the
// report, the links revoked; the rollover checklist and its dry run, the
// option «להשבית…» on by default and labelled «הצעה». Mock build: a content
// member's review goes out by the parameter names tests/sql/after.test.ts pins;
// a logistics member never asks for a review — no section, no sheet's
// reviews, no summary. Synthetic people and words only.
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoWeek } from "../../src/data/demoWeek";
import { addDays, israelDate } from "../../src/domain/israelTime";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const card = (page: Page, speaker: string) => page.locator("[data-lesson-id]").filter({ hasText: speaker });

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

/** A section of the lesson panel, opened. */
async function section(panel: Locator, name: string): Promise<Locator> {
  const s = panel.getByRole("region", { name, exact: true });
  const toggle = s.getByRole("button", { name: new RegExp(`^${name}`) });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return s;
}

/** «הגדרות ← מחזור»: the demo week's opening date set (to a past Sunday: the week is over). */
async function setDemoDate(page: Page, info: TestInfo, date: string) {
  await nav(page).getByRole("link", { name: "הגדרות" }).click();
  await page.getByRole("tab", { name: "מחזור" }).click();
  const editions = page.getByRole(info.project.name === "desktop" ? "table" : "list", { name: "המחזורים" });
  await editions.getByRole("button", { name: "עריכת התאריכים של הדגמה" }).click();
  await editions.getByLabel("תאריך הפתיחה (יום ראשון)").fill(date);
  await editions.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(toast(page, "התאריכים נשמרו")).toBeVisible();
}

test.describe("demo build", () => {
  test("«איך עבר» after the week: written in the lesson panel, counted in the summary and its xlsx; the sheet shows a past year", async ({ page }, info) => {
    await page.goto(demoUrl());
    // before: the week's date is TBD — the section says when it opens, and the instructor (the demo's user) may write anyway
    let panel = await openLesson(page, info, "שני", "מרצה 12");
    let review = await section(panel, "איך עבר");
    await expect(review.getByRole("button", { name: /^איך עבר/ })).toContainText("נפתח אחרי השבוע");
    await expect(review).toContainText("המדריך/ה יכול/ה לכתוב בכל זמן");
    await panel.getByRole("button", { name: "סגירה" }).click();

    await setDemoDate(page, info, pastSunday(7));
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    panel = await openLesson(page, info, "שני", "מרצה 12");
    review = await section(panel, "איך עבר");
    await expect(review.getByRole("button", { name: /^איך עבר/ })).toContainText("עוד לא נכתב");
    const form = review.getByRole("form", { name: "איך עבר" });
    await expect(form.getByRole("button", { name: "שמירה" })).toBeDisabled(); // nothing said yet
    await form.getByLabel("מה עבד (לא חובה)").fill("נכתב בבדיקה: השיעור היה ברור");
    await form.getByRole("group", { name: "להזמין שוב?" }).getByRole("radio", { name: "כן" }).check();
    await form.getByRole("group", { name: "ציון (לא חובה)" }).getByRole("radio", { name: "4" }).check();
    await form.getByLabel("חרגה מהזמן").check(); // the speaker's gender
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "«איך עבר» נשמר")).toBeVisible();
    await expect(review.getByRole("button", { name: /^איך עבר/ })).toContainText("להזמין שוב: כן · ציון 4/5 · חרגה מהזמן");
    await expect(review).toContainText("נכתב ע״י");
    // the card's five dots are what they were: «איך עבר» is the panel's alone
    await expect(card(page, "מרצה 12").first().locator("[data-stage]")).toHaveCount(5);
    await panel.getByRole("button", { name: "סגירה" }).click();

    // the summary: four of the eighteen closed lessons reviewed, the new one on «להזמין שוב»
    await nav(page).getByRole("link", { name: "ידע" }).click();
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

    // a missing review opens its lesson in the week
    await page.getByRole("list", { name: "עוד לא נכתב" }).getByRole("button").first().click();
    await expect(page.getByRole("dialog", { name: "שיעור סגור" })).toBeVisible();
    await page.getByRole("dialog", { name: "שיעור סגור" }).getByRole("button", { name: "סגירה" }).click();

    // the speaker sheet: the past year's «איך עבר» (the demo's synthetic past edition)
    panel = await openLesson(page, info, "ראשון", "מרצה 01");
    await panel.getByRole("button", { name: "ד״ר מרצה 01" }).click();
    const sheet = page.getByRole("dialog", { name: "ד״ר מרצה 01" });
    const past = sheet.getByRole("region", { name: "איך עבר בשנים קודמות" });
    await expect(past).toContainText("מחזור קודם (לדוגמה)");
    await expect(past).toContainText("להזמין שוב: כן · ציון 5/5");
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
    await expect(purge.locator("[data-purged]")).toContainText("נמחק ב-");
    // the checklist's third step is done
    await expect(page.getByRole("list", { name: "מעבר לשנה הבאה" }).locator("[data-step='3']")).toHaveAttribute("data-done", "true");
    // again: nothing more
    await typed.fill("הדגמה");
    await button.click();
    await expect(report).toContainText("פרטי הסעה של 0 שיעורים נמחקו");
    await expect(report).toContainText("0 קישורים בוטלו");

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
    await expect(page.locator("[data-dry=deactivate]")).toContainText("1 חברי צוות (תוכן ולוגיסטיקה)");
    // the option off: nobody
    await page.getByRole("checkbox", { name: /להשבית את חברי הצוות/ }).first().uncheck();
    await page.getByRole("button", { name: "הרצה יבשה" }).click();
    await expect(page.locator("[data-dry=deactivate]")).toContainText("אף אחד (האפשרות כבויה)");
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  const who = (email: string, role: "content" | "logistics", member: number) => ({
    status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: "חבר/ת צוות לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role, member_id: member }],
  });

  test("a content member's review goes out as save_lesson_review by its parameter names, with the member's token", async ({ page }, info) => {
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
    await page.goto(mockUrl());
    // member 2 handles «מרצה 01» (Sunday 08:30)
    const panel = await openLesson(page, info, "ראשון", "מרצה 01");
    const review = await section(panel, "איך עבר");
    const form = review.getByRole("form", { name: "איך עבר" });
    await form.getByLabel("מה פחות (לא חובה)").fill("נכתב בבדיקה");
    await form.getByRole("group", { name: "להזמין שוב?" }).getByRole("radio", { name: "אולי" }).check();
    await form.getByRole("button", { name: "שמירה" }).click();
    const lesson = week.lessons.find((l) => l.day === 0 && l.start_min === 510 && l.state === "closed")!.id;
    await expect.poll(() => sb.rpc.get("save_lesson_review")).toEqual([
      { p_lesson: lesson, p_version: 0, p_went_well: null, p_issues: "נכתב בבדיקה", p_invite_again: "maybe", p_overran: false, p_rating: null },
    ]);
    expect(sb.rpc.get("load_reviews")?.[0]).toEqual({ p_edition: 7 });
    for (const fn of ["load_reviews", "save_lesson_review"]) for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
  });

  test("logistics never asks for «איך עבר»: no section in the panel, none in the speaker sheet, no summary", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const week = demoWeek();
    week.edition = { ...week.edition, id: 7, kind: "real", start_date: pastSunday(7) };
    const sb = new FakeSupabase({ status: 200, body: who("logistics@example.org", "logistics", 5) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    const session = await signIn(page, "logistics@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    const panel = await openLesson(page, info, "ראשון", "מרצה 01");
    await expect(panel.getByRole("region", { name: "תשלום/הסעה", exact: true })).toBeVisible();
    await expect(panel.getByRole("region", { name: "איך עבר", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "ד״ר מרצה 01" }).click();
    const sheet = page.getByRole("dialog", { name: "ד״ר מרצה 01" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("region", { name: "איך עבר בשנים קודמות" })).toHaveCount(0);
    await nav(page).getByRole("link", { name: "ידע" }).click();
    await expect(page.getByRole("heading", { name: "ידע ואבני דרך" })).toBeVisible();
    await expect(page.getByRole("link", { name: "סיכום המחזור" })).toHaveCount(0);
    for (const fn of ["load_reviews", "speaker_reviews", "edition_returning", "save_lesson_review"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });
});
