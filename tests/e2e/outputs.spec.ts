// The outputs (milestone 4) in a real browser, at every width. Demo build: the
// tracking table (rows in grid order, the colours, the filters, phones only
// behind the toggle, a CSV and an xlsx downloaded and read back, the print
// view — A4 landscape, the header row repeated), the escorts' list (grouped,
// gendered, the instructor's phrases, a page per escort in print), the
// designer's export (no contact, no amount; the snapshot; «שינויים מאז הייצוא
// הקודם» after a title changes in the week, the field highlighted; the
// formula guard in the file), the archive (personal data in its own file
// only), «ידע» (a note in markdown-lite, never HTML; a milestone and its
// toggle) and «עזרה». Mock build: every new call goes out by its contract —
// get_contacts_for, the snapshot's insert, the notes' and milestones' writes,
// the archive's reads — with the member's token; a logistics member is offered
// no phones and no designer export; «כולל טלפונים» is off again in another
// edition (none in a practice week, no call); a snapshot that is not kept says
// so. Synthetic data only.
import { readFileSync } from "node:fs";
import { expect, type Download, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoWeek } from "../../src/data/demoWeek";
import { trackingRows } from "../../src/exports/tracking";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const outputsNav = (page: Page) => page.getByRole("navigation", { name: "תוצרים" });
const rows = (page: Page) => page.locator("[data-lesson-row]:visible");

async function downloaded(page: Page, click: () => Promise<void>): Promise<{ d: Download; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  return { d, bytes: readFileSync((await d.path())!) };
}

/** A closed lesson's panel: on a phone or a tablet, its day first. */
async function openLesson(page: Page, info: TestInfo, day: string, speaker: string): Promise<Locator> {
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  await page.locator("[data-lesson-id]").filter({ hasText: speaker }).first().click();
  const panel = page.getByRole("dialog", { name: "שיעור סגור" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("demo build", () => {
  test("the tracking table: grid order, the colours, the filters, phones only when asked, CSV and xlsx, print", async ({ page }, info) => {
    const week = demoWeek();
    const all = trackingRows(week);
    await page.goto(`${demoUrl()}/tracking`);
    await expect(page.getByRole("heading", { name: "טבלת מעקב" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "תוצרים" })).toHaveAttribute("aria-current", "page");
    await expect(rows(page)).toHaveCount(all.length);
    await expect(rows(page).first()).toHaveAttribute("data-tone", "received"); // Sunday 08:30: sources received — light blue
    await expect(page.locator(`[data-lesson-row="${all.find((r) => r.tone === "memorial")!.lesson.id}"]:visible`)).toHaveAttribute("data-tone", "memorial");
    await expect(page.getByRole("list", { name: "מקרא הצבעים" })).toContainText("תכלת: מקורות התקבלו");
    // no phones until asked
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await noSidewaysScroll(page);
    if (info.project.name === "desktop") {
      // one fixed layout: every day's columns line up
      const sunday = page.getByRole("table", { name: "טבלת מעקב, יום ראשון" });
      const monday = page.getByRole("table", { name: "טבלת מעקב, יום שני" });
      expect(await sunday.evaluate((e) => getComputedStyle(e).tableLayout)).toBe("fixed");
      const xs = async (t: Locator) => t.locator("th").evaluateAll((ths) => ths.map((th) => Math.round(th.getBoundingClientRect().x)));
      expect(await xs(monday)).toEqual(await xs(sunday));
    }

    // filters: a day, what is missing, «שלי»
    await page.getByLabel("יום", { exact: true }).selectOption({ label: "שני" });
    await expect(rows(page)).toHaveCount(all.filter((r) => r.day === 1).length);
    await page.getByLabel("מה חסר").selectOption({ label: "חסר מלווה" });
    await expect(rows(page)).toHaveCount(all.filter((r) => r.day === 1 && r.stage === "escort").length);
    await page.getByLabel("יום", { exact: true }).selectOption({ label: "כל הימים" });
    await page.getByLabel("מה חסר").selectOption({ label: "הכול" });
    await page.getByRole("checkbox", { name: "שלי" }).check();
    await expect(rows(page)).toHaveCount(all.filter((r) => r.handlers.includes(1)).length);
    await page.getByRole("checkbox", { name: "שלי" }).uncheck();
    await expect(rows(page)).toHaveCount(all.length);

    // CSV: UTF-8 with a BOM, CRLF, last year's columns
    const csv = await downloaded(page, () => page.getByRole("button", { name: "הורדת CSV" }).click());
    expect(csv.d.suggestedFilename()).toMatch(/^volozhin-tracking-edition-1-\d{4}-\d{2}-\d{2}\.csv$/);
    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = csv.bytes.toString("utf8").slice(1);
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("מרצה,יום ושעה,כותרת,נושא,מקורות,הסעה/תשלום,מלווה,קיבל הודעת סיכום מ");
    expect(lines).toHaveLength(all.length + 2); // header, rows, and the final CRLF
    expect(text).toContain("פתיחת השבוע (לדוגמה)");
    expect(text).not.toContain("טלפון לדוגמה");
    await expect(toast(page, "הקובץ ירד.")).toBeVisible();

    // xlsx: right to left, the header frozen, the stage colours
    const xlsx = await downloaded(page, () => page.getByRole("button", { name: "הורדת xlsx" }).click());
    expect(xlsx.d.suggestedFilename()).toMatch(/\.xlsx$/);
    const parts = unzipSync(new Uint8Array(xlsx.bytes));
    const sheet = strFromU8(parts["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain("פתיחת השבוע (לדוגמה)");
    expect(strFromU8(parts["xl/styles.xml"])).toContain('rgb="FFCFFAFE"');

    // «כולל טלפונים»: the demo's user is the instructor — every phone on file; then the files carry them, and say so
    await page.getByRole("checkbox", { name: "כולל טלפונים" }).check();
    await expect(page.getByText("זה מידע אישי").first()).toBeVisible();
    await expect(page.getByText("טלפון לדוגמה").filter({ visible: true }).first()).toBeVisible();
    const withPhones = await downloaded(page, () => page.getByRole("button", { name: "הורדת CSV" }).click());
    expect(withPhones.d.suggestedFilename()).toContain("tracking-with-phones");
    expect(withPhones.bytes.toString("utf8").split("\r\n")[0]).toBe("﻿מרצה,טלפון,יום ושעה,כותרת,נושא,מקורות,הסעה/תשלום,מלווה,קיבל הודעת סיכום מ");
    await expect(toast(page, "יש בו טלפונים")).toBeVisible();
    // the toast is never printed (a print right after a download)
    await page.emulateMedia({ media: "print" });
    // (by CSS, not by role: hidden, it is out of the accessibility tree)
    expect(await page.locator("[role=status]", { hasText: "יש בו טלפונים" }).evaluate((e) => getComputedStyle(e).display)).toBe("none");
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("checkbox", { name: "כולל טלפונים" }).uncheck();
    await noSidewaysScroll(page);

    // print: no header or controls; a table at every width, its header row repeated on each page
    await page.getByRole("checkbox", { name: "בהדפסה: עמוד לכל יום" }).check();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.getByRole("button", { name: "הדפסה" })).toBeHidden();
    const table = page.getByRole("table", { name: "טבלת מעקב, יום שני" });
    await expect(table).toBeVisible();
    expect(await table.locator("thead").evaluate((e) => getComputedStyle(e).display)).toBe("table-header-group");
    expect(await page.getByRole("region", { name: "יום שני" }).evaluate((e) => getComputedStyle(e).breakBefore)).toBe("page");
    // a day's own page says which sheet it is; the print date as the site writes dates
    await expect(page.getByRole("region", { name: "יום שני" }).getByText("טבלת מעקב · שבוע וולוז'ין הדגמה · הודפס ב-")).toBeVisible();
    await expect(page.getByText(/^הודפס ב-\d{1,2}\.\d{1,2}\.\d{4} · /)).toBeVisible();
    expect(await table.locator("tbody tr").first().evaluate((e) => getComputedStyle(e).printColorAdjust)).toBe("exact");
    if (info.project.name === "desktop") {
      // A4 landscape: the page is wider than it is tall
      const pdf = (await page.pdf({ preferCSSPageSize: true })).toString("latin1");
      const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf)!;
      const [w, h] = [Number(box[1]), Number(box[2])];
      expect(Math.abs(w - 841.9), `width ${w}`).toBeLessThan(3);
      expect(Math.abs(h - 595.3), `height ${h}`).toBeLessThan(3);
    }
    await page.emulateMedia({ media: "screen" });
  });

  test("the escorts' list: by escort in their gender, who introduces the speaker, the instructor's phrases, a page each", async ({ page }) => {
    await page.goto(`${demoUrl()}/tracking`);
    await outputsNav(page).getByRole("link", { name: "רשימת מלווים" }).click();
    await expect(page).toHaveURL(/\/print\/escorts$/);
    const b = page.getByRole("region", { name: "מלווה לדוגמה ב׳" });
    await expect(b).toContainText("הוא מלווה 2 שיעורים");
    await expect(b.locator("[data-lesson-row]")).toHaveCount(2);
    await expect(b.locator("[data-lesson-row]").first()).toContainText("ראשון 10:00–11:15 · בית מדרש");
    await expect(b.locator("[data-lesson-row]").first()).toContainText("הצגה על ידי המלווה — מציג את המרצה");
    await expect(page.getByRole("region", { name: "מלווה לדוגמה א׳" })).toContainText("היא מלווה שיעור אחד");
    await expect(page.getByText("הניסוחים של «משהו שחשוב לדעת» עוד לא הודבקו")).toBeVisible();
    const open = page.getByRole("region", { name: "עוד בלי מלווה" });
    await expect(open).toBeVisible();
    await noSidewaysScroll(page);

    // the instructor pastes a phrase («הגדרות ← תבניות»): every escorted lesson shows it
    await page.getByRole("link", { name: "מדביקים אותם בהגדרות ← «תבניות»" }).click();
    await page.getByLabel("מתי הניסוח חל").selectOption({ label: "כל שיעור" });
    await page.getByLabel("ניסוח (אפשר כמה, ניסוח בכל שורה)").fill("ניסוח לדוגמה לכל שיעור");
    await page.getByRole("button", { name: "הוספה", exact: true }).click();
    await expect(toast(page, "הניסוח נוסף")).toBeVisible();
    await nav(page).getByRole("link", { name: "תוצרים" }).click();
    await outputsNav(page).getByRole("link", { name: "רשימת מלווים" }).click();
    await expect(b.locator("[data-lesson-row]").first()).toContainText("משהו שחשוב לדעת");
    await expect(b.locator("[data-lesson-row]").first()).toContainText("ניסוח לדוגמה לכל שיעור");
    const d = page.getByRole("region", { name: "מלווה לדוגמה ד׳" });
    await expect(d).toContainText("נתון לדוגמה: להגיע רבע שעה לפני"); // the lesson's own note, after the phrases

    // phones: only the lessons the caller may see; here, the ones with a phone on file
    await page.getByRole("checkbox", { name: "כולל טלפונים" }).check();
    await expect(open.getByText("טלפון: טלפון לדוגמה").first()).toBeVisible();
    await page.getByRole("checkbox", { name: "כולל טלפונים" }).uncheck();

    // print: an escort per page; the open lessons stay on screen only
    await page.getByRole("checkbox", { name: "בהדפסה: כל מלווה בעמוד משלו" }).check();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(open).toBeHidden();
    expect(await b.evaluate((e) => getComputedStyle(e).breakBefore)).toBe("page");
    await expect(b.getByText("רשימת מלווים · שבוע וולוז'ין הדגמה · הודפס ב-")).toBeVisible(); // a page handed to an escort says which week
    await page.emulateMedia({ media: "screen" });
    await expect(b.getByText("רשימת מלווים · שבוע וולוז'ין הדגמה · הודפס ב-")).toBeHidden();
    await noSidewaysScroll(page);
  });

  test("the designer's export: the public schedule only, kept as a snapshot; a title changed in the week shows as a change", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/export/designer`);
    await expect(page.getByRole("heading", { name: "ייצוא למעצבת" })).toBeVisible();
    await expect(page.getByText("עוד לא ייצאו את הלו״ז למעצבת.")).toBeVisible();
    const schedule = page.getByRole("table", { name: "הלו״ז שייצא" });
    await expect(schedule).toContainText("במקביל");
    // a time range and «זמן זיכרון» stay on one line; the speaker and the title may wrap
    const cells = schedule.locator("tbody tr").first().locator("td");
    expect(await cells.evaluateAll((tds) => tds.map((td) => getComputedStyle(td).whiteSpace))).toEqual(["nowrap", "nowrap", "nowrap", "nowrap", "normal", "normal", "normal", "nowrap", "nowrap"]);
    await noSidewaysScroll(page);

    const first = await downloaded(page, () => page.getByRole("button", { name: "ייצוא xlsx" }).click());
    expect(first.d.suggestedFilename()).toMatch(/^volozhin-designer-edition-1-.*\.xlsx$/);
    const parts = unzipSync(new Uint8Array(first.bytes));
    const sheet = strFromU8(parts["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain("זמן זיכרון");
    const everything = Object.values(parts).map((p) => strFromU8(p)).join("");
    for (const secret of ["טלפון לדוגמה", "example.org", "₪", "לבדוק שוב את הסכום", "להגיע רבע שעה"]) expect(everything).not.toContain(secret);
    await expect(toast(page, "הייצוא נשמר להשוואה")).toBeVisible();
    await expect(page.getByText("אין שינויים מאז הייצוא הקודם.")).toBeVisible();

    // a title changes in the week (one that a spreadsheet would read as a formula)
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    const panel = await openLesson(page, info, "ראשון", "מרצה 07");
    const details = panel.getByRole("region", { name: "פרטי השיעור" });
    await details.getByLabel("כותרת").fill("=כותרת חדשה לדוגמה");
    await details.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, /^נשמר$/)).toBeVisible();
    await panel.getByRole("button", { name: "סגירה" }).click();

    await nav(page).getByRole("link", { name: "תוצרים" }).click();
    await outputsNav(page).getByRole("link", { name: "ייצוא למעצבת" }).click();
    const changed = page.getByRole("region", { name: "השתנו" });
    await expect(changed).toContainText("השתנו (1)");
    const field = changed.locator('[data-changed="title"]');
    await expect(field).toContainText("שיעור לדוגמה 4");
    await expect(field.locator("mark")).toHaveText("=כותרת חדשה לדוגמה");
    await expect(changed.locator("[data-changed]")).toHaveCount(1); // only the title
    await noSidewaysScroll(page);

    // the CSV: a BOM, and the formula guarded
    const csv = await downloaded(page, () => page.getByRole("button", { name: "ייצוא CSV" }).click());
    const text = csv.bytes.toString("utf8");
    expect(text.startsWith("﻿סוג,יום,תאריך,שעה,מרצה,כותרת,קטגוריה,חדר,במקביל\r\n")).toBe(true);
    expect(text).toContain(",'=כותרת חדשה לדוגמה,");
    await expect(page.getByText("אין שינויים מאז הייצוא הקודם.")).toBeVisible();
  });

  test("the archive: one zip — the edition, the speakers, the tracking table, and the personal data apart", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/edition`);
    await expect(page.getByRole("heading", { name: "ייצוא ארכיון (גיבוי)" })).toBeVisible();
    await expect(page.getByText("הארכיון כולל מידע אישי:")).toBeVisible();
    await noSidewaysScroll(page);
    const zip = await downloaded(page, () => page.getByRole("button", { name: "הורדת הארכיון של הדגמה" }).click());
    expect(zip.d.suggestedFilename()).toMatch(/^volozhin-archive-edition-1-\d{4}-\d{2}-\d{2}\.zip$/);
    const files = unzipSync(new Uint8Array(zip.bytes));
    expect(Object.keys(files).sort()).toEqual(["PERSONAL-DATA_contacts_and_transport.json", "README.txt", "edition.json", "kk.json", "memorial.json", "reviews.json", "sources.json", "speakers.json", "tracking.xlsx"]);
    expect(JSON.parse(strFromU8(files["reviews.json"])).reviews.length).toBeGreaterThan(0); // «איך עבר» (v12), as the admin reads it
    const edition = JSON.parse(strFromU8(files["edition.json"]));
    expect(edition.lessons.length).toBe(demoWeek().lessons.length);
    expect(edition.milestones.length).toBeGreaterThan(0);
    for (const f of ["edition.json", "speakers.json", "kk.json", "memorial.json", "sources.json", "reviews.json"]) {
      expect(strFromU8(files[f]), f).not.toContain("טלפון לדוגמה");
      expect(strFromU8(files[f]), f).not.toContain("כתובת לדוגמה");
    }
    const personal = strFromU8(files["PERSONAL-DATA_contacts_and_transport.json"]);
    expect(personal).toContain("טלפון לדוגמה");
    expect(personal).toContain("כתובת לדוגמה");
    expect(strFromU8(unzipSync(files["tracking.xlsx"])["xl/worksheets/sheet1.xml"])).toContain('rightToLeft="1"');
    await expect(toast(page, "הארכיון ירד")).toBeVisible();
  });

  test("«ידע»: a note in markdown-lite — bold and a list, never HTML; a milestone, W−n, done", async ({ page }) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "ידע" }).click();
    await expect(page.getByRole("heading", { name: "ידע ואבני דרך" })).toBeVisible();
    const milestones = page.getByRole("list", { name: "אבני הדרך" });
    await expect(milestones.getByRole("listitem").first()).toContainText("W−42 · הצעה");
    await expect(page.getByText("תאריך השבוע עוד לא נקבע (TBD), ולכן מוצג רק W−n")).toBeVisible();
    await expect(page.getByRole("region", { name: "תהליך" }).locator("strong")).toHaveText("הדגשה");
    await noSidewaysScroll(page);

    await page.getByRole("button", { name: "+ הערה חדשה" }).click();
    const form = page.getByRole("form", { name: "הערה חדשה" });
    await form.getByLabel("מדור").selectOption({ label: "אתגרים" });
    await form.getByRole("radio", { name: "לכל השנים" }).check();
    await form.getByLabel("כותרת").fill("אתגר לדוגמה");
    await form.getByLabel("התוכן").fill("שורה **מודגשת** ו-<b>תגית</b> <script>alert(1)</script>\n\n- פריט לדוגמה א\n- פריט לדוגמה ב");
    await expect(form.getByRole("region", { name: "תצוגה מקדימה של ההערה" }).locator("strong")).toHaveText("מודגשת");
    await form.getByRole("button", { name: "הוספת ההערה" }).click();
    await expect(toast(page, "ההערה נוספה")).toBeVisible();
    const note = page.getByRole("region", { name: "אתגרים" }).getByRole("listitem").filter({ hasText: "אתגר לדוגמה" }).first();
    await expect(note).toContainText("לכל השנים");
    await expect(note.locator("strong")).toHaveText("מודגשת");
    await expect(note).toContainText("<b>תגית</b> <script>alert(1)</script>"); // shown as typed, never markup
    await expect(note.locator("b, script")).toHaveCount(0);
    await expect(note.getByRole("list").getByRole("listitem")).toHaveText(["פריט לדוגמה א", "פריט לדוגמה ב"]);

    const add = page.getByRole("form", { name: "אבן דרך חדשה" });
    await add.getByLabel("אבן הדרך").fill("אבן דרך חדשה לדוגמה");
    await add.getByLabel("כמה ימים לפני השבוע").fill("30");
    await add.getByRole("button", { name: "הוספת אבן דרך" }).click();
    await expect(toast(page, "אבן הדרך נוספה")).toBeVisible();
    const m = milestones.getByRole("listitem").filter({ hasText: "אבן דרך חדשה לדוגמה" });
    await expect(m).toContainText("W−30 · הצעה");
    await m.getByRole("checkbox").check();
    await expect(toast(page, "סומן כבוצע")).toBeVisible();
    await expect(m.getByRole("checkbox")).toBeChecked();
    await expect(m).toContainText("בוצע");
    await add.getByLabel("אבן הדרך").fill("לא תקין");
    await add.getByLabel("כמה ימים לפני השבוע").fill("400");
    await add.getByRole("button", { name: "הוספת אבן דרך" }).click();
    await expect(add.getByRole("alert")).toContainText("בין 90- (אחרי השבוע) ל-365");
    await noSidewaysScroll(page);
  });

  test("«עזרה»: the team's one-page guide, from the header", async ({ page }) => {
    await page.goto(demoUrl());
    // the instructor's ten sections: every one inside the screen, none cut off or behind a sideways scroll
    const links = nav(page).getByRole("link");
    await expect(links).toHaveText(["השבוע", "המרצים שלי", "תוצרים", "לוגיסטיקה", "זמני זיכרון", "מכריכה לכריכה", "ידע", /^אישורים/, "הגדרות", "עזרה"]);
    const width = page.viewportSize()!.width;
    for (const box of await links.evaluateAll((ls) => ls.map((l) => l.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(box.left, JSON.stringify(box)).toBeGreaterThanOrEqual(0);
      expect(box.right, JSON.stringify(box)).toBeLessThanOrEqual(width);
    }
    await nav(page).getByRole("link", { name: "עזרה" }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(nav(page).getByRole("link", { name: "עזרה" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "עזרה" })).toBeInViewport({ ratio: 1 });
    const guide = page.getByRole("article", { name: "מדריך קצר לצוות" });
    await expect(guide.getByRole("heading", { level: 2, name: "מדריך קצר לצוות" })).toBeVisible();
    for (const h of ["כניסה", "הרשת", "המרצים שלי", "כרטיס המרצה", "שלבי השיעור", "הודעת הסיכום", "תוצרים"]) {
      await expect(guide.getByRole("heading", { level: 3, name: h, exact: true })).toBeVisible();
    }
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  const signedIn = async (page: Page, membership: { role: string; global: boolean; member: number; name?: string }) => {
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const email = `${membership.role}@example.org`;
    const sb = new FakeSupabase({
      status: 200,
      body: {
        status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: membership.name ?? "חבר/ת צוות לדוגמה", global_admin: membership.global,
        memberships: [{ edition_id: membership.global ? null : 7, role: membership.role, member_id: membership.member }],
      },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    const session = await signIn(page, email);
    sb.token = session.access_token;
    return { sb, week, session };
  };
  test("the header of an admin of every edition: all ten sections inside the nav from 1024px, a long name giving way", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the widths are set here");
    await signedIn(page, { role: "admin", global: true, member: 1, name: "שם ארוך מאוד של מדריך/ה לדוגמה" });
    await page.goto(mockUrl());
    await expect(page.getByRole("button", { name: "התנתקות" })).toBeVisible();
    const links = nav(page).getByRole("link");
    await expect(links).toHaveCount(10);
    for (const width of [1024, 1100, 1150, 1180, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const navBox = (await nav(page).boundingBox())!;
      for (const box of await links.evaluateAll((ls) => ls.map((l) => ({ text: l.textContent, ...l.getBoundingClientRect().toJSON() }) as DOMRect & { text: string }))) {
        // inside the nav's own box: not behind its sideways scroll (headless Chromium hides the scrollbar itself)
        expect(box.left, `${width}: ${box.text}`).toBeGreaterThanOrEqual(navBox.x - 0.5);
        expect(box.right, `${width}: ${box.text}`).toBeLessThanOrEqual(navBox.x + navBox.width + 0.5);
      }
      expect((await page.getByRole("banner").boundingBox())!.height, String(width)).toBeLessThanOrEqual(56); // one row: the week's grid height holds
    }
  });

  const authed = (sb: FakeSupabase, path: string, token: string) => {
    const calls = sb.calls.filter((c) => c.path === path);
    expect(calls.length, path).toBeGreaterThan(0);
    for (const c of calls) expect(c.auth, path).toBe(`Bearer ${token}`);
  };

  test("every new call goes out by its contract, with the member's own token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, week, session } = await signedIn(page, { role: "admin", global: true, member: 1 });
    const closed = week.lessons.filter((l) => l.state === "closed");
    const lesson = closed[0];
    sb.answers.set("get_contacts_for", [{ lesson_id: lesson.id, speaker_id: 1, phone: "טלפון לדוגמה מהשרת" }]);
    sb.tables.set("export_snapshots", []);
    sb.tables.set("notes", []);
    sb.tables.set("milestones", [{ id: 4, edition_id: 7, title: "אבן דרך לדוגמה", days_before: 42, done_at: null, done_by: null }]);

    // the tracking table: phones in one call, the lessons on screen
    await page.goto(`${mockUrl()}/tracking`);
    await expect(page.locator("[data-lesson-row]").first()).toBeVisible();
    expect(sb.rpc.get("get_contacts_for")).toBeUndefined(); // not until asked
    await page.getByRole("checkbox", { name: "כולל טלפונים" }).check();
    await expect(page.getByText("טלפון לדוגמה מהשרת")).toBeVisible();
    expect(sb.rpc.get("get_contacts_for")).toEqual([{ p_lessons: closed.map((l) => l.id) }]);

    // the designer's export: one insert of edition, kind and rows — the public keys only
    await outputsNav(page).getByRole("link", { name: "ייצוא למעצבת" }).click();
    await expect(page.getByText("עוד לא ייצאו את הלו״ז למעצבת.")).toBeVisible();
    await downloaded(page, () => page.getByRole("button", { name: "ייצוא xlsx" }).click());
    await expect.poll(() => sb.writes.filter((w) => w.table === "export_snapshots").length).toBe(1);
    const snap = sb.writes.find((w) => w.table === "export_snapshots")!;
    expect(snap.method).toBe("POST");
    const body = snap.body as { edition_id: number; kind: string; payload: Record<string, unknown>[] };
    expect([body.edition_id, body.kind, Object.keys(body).sort()]).toEqual([7, "designer", ["edition_id", "kind", "payload"]]);
    expect(body.payload.length).toBeGreaterThan(10);
    for (const r of body.payload) expect(Object.keys(r).sort()).toEqual(["category", "date", "day", "kind", "lesson_id", "parallel", "room", "speaker", "time", "title"]);

    // «ידע»: a note and a milestone, written by column — never an author, a time or a version
    await nav(page).getByRole("link", { name: "ידע" }).click();
    await page.getByRole("button", { name: "+ הערה חדשה" }).click();
    const form = page.getByRole("form", { name: "הערה חדשה" });
    await form.getByLabel("כותרת").fill("  הערה   לדוגמה ");
    await form.getByLabel("התוכן").fill("גוף לדוגמה\n");
    await form.getByRole("button", { name: "הוספת ההערה" }).click();
    await expect.poll(() => sb.writes.filter((w) => w.table === "notes").map((w) => [w.method, w.body])).toEqual([
      ["POST", { edition_id: 7, section: "process", title: "הערה לדוגמה", body_md: "גוף לדוגמה" }],
    ]);
    await page.getByRole("list", { name: "אבני הדרך" }).getByRole("checkbox").click(); // the stub answers the old row back: no state to check
    await expect.poll(() => sb.writes.filter((w) => w.table === "milestones").length).toBe(1);
    const done = sb.writes.find((w) => w.table === "milestones")!;
    expect([done.method, done.query.get("id"), Object.keys(done.body as object)]).toEqual(["PATCH", "eq.4", ["done_at"]]);

    // the archive: the edition's log, and the personal data through its policies
    sb.tables.set("activity", []);
    sb.tables.set("speaker_contacts", [{ speaker_id: 1, phone: "טלפון לדוגמה", email: null, secretary_note: null, notes: null }]);
    sb.tables.set("transport_details", []);
    sb.answers.set("load_kk", { tracks: [], groups: [], leaders: [], signups: [], orders: [] }); // 5ב-2: מכריכה לכריכה and the fallen too
    sb.answers.set("get_fallen_contacts", null); // asked for the fallen this edition planned for (the demo's: 1, 2, 3) — none stored
    sb.answers.set("load_reviews", []); // v12: «איך עבר», as the caller reads it
    await nav(page).getByRole("link", { name: "הגדרות" }).click();
    await page.getByRole("tab", { name: "מחזור" }).click();
    const zip = await downloaded(page, () => page.getByRole("button", { name: /^הורדת הארכיון/ }).click());
    expect(Object.keys(unzipSync(new Uint8Array(zip.bytes)))).toContain("PERSONAL-DATA_contacts_and_transport.json");
    const activity = sb.calls.find((c) => c.path === "/rest/v1/activity")!;
    expect(activity.query.get("edition_id")).toBe("eq.7");
    const contacts = sb.calls.find((c) => c.path === "/rest/v1/speaker_contacts")!;
    expect(contacts.query.get("speaker_id")).toMatch(/^in\.\(/);

    expect(sb.rpc.get("get_fallen_contacts")).toEqual([{ p_fallen: 1 }, { p_fallen: 2 }, { p_fallen: 3 }]);
    const reviewsAsked = sb.rpc.get("load_reviews") ?? []; // the archive's read, and the «מעבר לשנה הבאה» checklist's on the same tab
    expect(reviewsAsked.length).toBeGreaterThan(0);
    for (const a of reviewsAsked) expect(a).toEqual({ p_edition: 7 });
    for (const p of ["/rest/v1/rpc/get_contacts_for", "/rest/v1/export_snapshots", "/rest/v1/notes", "/rest/v1/milestones", "/rest/v1/activity", "/rest/v1/speaker_contacts", "/rest/v1/transport_details", "/rest/v1/rpc/load_kk", "/rest/v1/fallen", "/rest/v1/rpc/get_fallen_contacts", "/rest/v1/rpc/load_reviews"]) {
      authed(sb, p, session.access_token);
    }
  });

  test("a content member sees only their own speakers' phones; logistics is offered no phones and no designer export", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const { sb } = await signedIn(page, { role: "content", global: false, member: 2 });
    sb.answers.set("get_contacts_for", []);
    await page.goto(`${mockUrl()}/tracking`);
    await page.getByRole("checkbox", { name: "כולל טלפונים" }).check();
    await expect(page.getByText("רק הטלפונים של המרצים שבטיפולך.")).toBeVisible();
    await expect.poll(() => sb.rpc.get("get_contacts_for")?.length ?? 0).toBe(1);
    await expect(outputsNav(page).getByRole("link")).toHaveText(["טבלת מעקב", "רשימת מלווים", "מקראה"]); // the reader is content's too (5ב-1); the designer's export is not
    await page.goto(`${mockUrl()}/export/designer`);
    await expect(page).toHaveURL(/\/tracking$/);
  });

  test("logistics: the tracking table and the escorts' list, without «שלי», phones or the designer's export", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const { sb } = await signedIn(page, { role: "logistics", global: false, member: 5 });
    await page.goto(`${mockUrl()}/tracking`);
    await expect(page.locator("[data-lesson-row]").first()).toBeVisible();
    await expect(nav(page).getByRole("link")).toHaveText(["השבוע", "תוצרים", "לוגיסטיקה", "זמני זיכרון", "מכריכה לכריכה", "ידע", "עזרה"]);
    await expect(page.getByRole("checkbox", { name: "כולל טלפונים" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "שלי" })).toHaveCount(0);
    await expect(outputsNav(page).getByRole("link")).toHaveText(["טבלת מעקב", "רשימת מלווים"]);
    await outputsNav(page).getByRole("link", { name: "רשימת מלווים" }).click();
    await expect(page.getByRole("region", { name: "מלווה לדוגמה ב׳" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "כולל טלפונים" })).toHaveCount(0);
    expect(sb.rpc.get("get_contacts_for")).toBeUndefined();
  });

  test("«כולל טלפונים» belongs to one edition: in a practice week it is off — no phones, no call, no file with phones", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const real = demoWeek();
    Object.assign(real.edition, { id: 7, kind: "real", label: "real-7" });
    const practice = demoWeek();
    Object.assign(practice.edition, { id: 8, kind: "practice", label: "practice-8" });
    const email = "content@example.org";
    const sb = new FakeSupabase({
      status: 200,
      body: {
        status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: "חבר/ת צוות לדוגמה", global_admin: false,
        memberships: [{ edition_id: 7, role: "content", member_id: 2 }, { edition_id: 8, role: "content", member_id: 2 }],
      },
    });
    sb.answers.set("editions", [practice.edition, real.edition]);
    await sb.attach(page);
    await page.route("**/rest/v1/rpc/load_week", (route) => {
      const { p_edition } = route.request().postDataJSON() as { p_edition: number };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(p_edition === 8 ? practice : real) });
    });
    const asked: number[][] = [];
    const lead = real.lessonSpeakers.find((x) => x.role === "lead" && real.approaches.some((a) => a.speaker_id === x.speaker_id && a.owner_member_id === 2))!;
    await page.route("**/rest/v1/rpc/get_contacts_for", (route) => {
      asked.push((route.request().postDataJSON() as { p_lessons: number[] }).p_lessons);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ lesson_id: lead.lesson_id, speaker_id: lead.speaker_id, phone: "טלפון לדוגמה מהשרת" }]) });
    });
    const session = await signIn(page, email);
    sb.token = session.access_token;

    await page.goto(`${mockUrl()}/tracking`);
    const edition = page.getByRole("combobox", { name: "מחזור" });
    await edition.selectOption("7");
    const phones = page.getByRole("checkbox", { name: "כולל טלפונים" });
    await phones.check();
    await expect(page.getByText("טלפון לדוגמה מהשרת").first()).toBeVisible();
    expect(asked).toHaveLength(1);

    // the practice week: the switch is not offered there, and nothing it turned on stays on
    await edition.selectOption("8");
    await expect(page.locator("[data-lesson-row]").first()).toBeVisible();
    await expect(phones).toHaveCount(0);
    await expect(page.getByText("טלפון לדוגמה מהשרת")).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "טלפון" })).toHaveCount(0);
    const csv = await downloaded(page, () => page.getByRole("button", { name: "הורדת CSV" }).click());
    expect(csv.d.suggestedFilename()).toMatch(/^volozhin-tracking-practice-8-/);
    expect(csv.bytes.toString("utf8").split("\r\n")[0]).toBe("﻿מרצה,יום ושעה,כותרת,נושא,מקורות,הסעה/תשלום,מלווה,קיבל הודעת סיכום מ");
    expect(csv.bytes.toString("utf8")).not.toContain("טלפון לדוגמה");
    expect(asked).toHaveLength(1);

    // back in the real week: off by default in a newly chosen edition, until asked again
    await edition.selectOption("7");
    await expect(phones).toBeVisible();
    await expect(phones).not.toBeChecked();
    await expect(page.getByText("טלפון לדוגמה מהשרת")).toHaveCount(0);
    expect(asked).toHaveLength(1);
  });

  test("the designer's export: a file that downloaded but whose snapshot was not kept says both", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb } = await signedIn(page, { role: "admin", global: true, member: 1 });
    sb.tables.set("export_snapshots", []);
    // the insert is refused (as RLS would refuse it); reads still answer
    await page.route(
      (url) => url.pathname === "/rest/v1/export_snapshots",
      (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "new row violates row-level security policy" }) })
          : route.fallback(),
    );
    await page.goto(`${mockUrl()}/export/designer`);
    await expect(page.getByText("עוד לא ייצאו את הלו״ז למעצבת.")).toBeVisible();
    const csv = await downloaded(page, () => page.getByRole("button", { name: "ייצוא CSV" }).click());
    expect(csv.d.suggestedFilename()).toMatch(/^volozhin-designer-.*\.csv$/);
    const alert = page.getByRole("alert").filter({ hasText: "הקובץ ירד, אבל הייצוא לא נשמר להשוואה" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("אפשר לייצא שוב.");
    await expect(alert).toContainText("הפעולה הזו שמורה למדריך/ה."); // the refusal's own words
    await expect(toast(page, "הייצוא נשמר להשוואה")).toHaveCount(0);
    await expect(page.getByText("עוד לא ייצאו את הלו״ז למעצבת.")).toBeVisible(); // nothing to compare with yet
  });
});
