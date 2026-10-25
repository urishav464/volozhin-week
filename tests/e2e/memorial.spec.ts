// Memorial times, «לוגיסטיקה» and the archive's additions (milestone 5ב-2) in a
// real browser, at every width. Demo build: a plan made for one of the fallen,
// placed on a slot with the picker (no drag needed), and the week's yellow card
// with the name, the family's status and the minutes; the family's contact
// person behind its button and nowhere on the week; the policy «ממתין להחלטת
// ישיבת הצוות» until set. «לוגיסטיקה»: the approved transports — the pickup
// address and the driver's phone only behind «כולל כתובות וטלפונים», in the
// page and in the CSV alike — the payments' totals and «שולם», the book orders,
// the prints by «מתי» and day with «אין קבצים»; the archive with kk.json,
// memorial.json, sources.json and, when asked, the source files in their day's
// folder. Mock build: logistics reads the transports in one get_transports_for
// call and the memorial screen without any planning control or a family's
// contact (get_fallen_contacts never called); the archive reads load_kk and the
// files through signed URLs, and names a file it could not read.
// Synthetic data only.
import { readFileSync } from "node:fs";
import { expect, type Download, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoWeek } from "../../src/data/demoWeek";
import { LRM } from "../../src/domain/time";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function downloaded(page: Page, click: () => Promise<void>): Promise<{ d: Download; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  return { d, bytes: readFileSync((await d.path())!) };
}

/** The week's memorial card for a day: on a phone or a tablet, that day first. */
async function weekCard(page: Page, info: TestInfo, day: string, text: string) {
  await nav(page).getByRole("link", { name: "השבוע" }).click();
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  return page.locator("[data-memorial-card]").filter({ hasText: text });
}

test.describe("demo build", () => {
  test("memorial times: a plan made, placed with the picker, and the week's yellow card — the family's contact only behind its button", async ({ page }, info) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    await expect(page).toHaveURL(/\/memorial$/);
    await expect(page.getByRole("heading", { name: "זמני זיכרון", level: 2 })).toBeVisible();
    await expect(page.getByText("ממתין להחלטת ישיבת הצוות")).toBeVisible();
    await expect(page.getByText("עוד לא נקבעה מדיניות.")).toBeVisible();
    const tray = page.getByRole("list", { name: "תוכניות שלא שובצו" });
    await expect(tray.locator("[data-memorial-plan]")).toHaveCount(2);
    await noSidewaysScroll(page);

    // a plan for «חלל/ה לדוגמה 4», into the tray
    await page.getByLabel("תוכנית חדשה").selectOption({ label: "חלל/ה לדוגמה 4" });
    await page.getByRole("button", { name: "+ תוכנית" }).click();
    await expect(toast(page, "התוכנית נוספה למגש")).toBeVisible();
    const plan = tray.locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 4" });
    await expect(plan).toContainText("עוד לא נוצר קשר");
    // its details: the family invited, 12 minutes
    await plan.getByRole("button", { name: "עריכת התוכנית: חלל/ה לדוגמה 4" }).click();
    const form = page.getByRole("form", { name: "עריכת התוכנית: חלל/ה לדוגמה 4" });
    await form.getByLabel("מה המשפחה אמרה").selectOption({ label: "המשפחה הוזמנה" });
    await form.getByLabel("דקות מתוכננות (לא חובה)").fill("12");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התוכנית נשמרה")).toBeVisible();
    // placed on Monday's 13:00 slot — the picker, by keyboard or tap, no drag: the select picks, «שיבוץ» places
    const picker = plan.getByLabel("שיבוץ", { exact: true });
    // (plain text: an LRM keeps «13:00–13:15» left to right among the Hebrew, in the option and the slot's heading)
    const monday = (await picker.locator("option", { hasText: `שני ${LRM}13:00–13:15` }).first().textContent())!;
    await picker.selectOption({ label: monday });
    await expect(toast(page, "«חלל/ה לדוגמה 4» שובץ/ה")).toHaveCount(0);
    await plan.getByRole("button", { name: "שיבוץ: חלל/ה לדוגמה 4" }).click();
    await expect(toast(page, "«חלל/ה לדוגמה 4» שובץ/ה")).toBeVisible();
    await expect(page.locator('[data-memorial-slot]').filter({ hasText: "חלל/ה לדוגמה 4" })).toContainText(`שני ${LRM}13:00–13:15`);
    await noSidewaysScroll(page);

    // the family's contact person: only behind its button, an admin's
    const sunday = page.locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 1" });
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await sunday.getByRole("button", { name: "פרטי הקשר של המשפחה" }).click();
    await expect(sunday.getByRole("group", { name: "פרטי הקשר של המשפחה: חלל/ה לדוגמה 1" })).toContainText("טלפון לדוגמה");
    await expect(sunday.getByText("מידע אישי של משפחה שכולה")).toBeVisible();

    // the week: the yellow card on Monday — the fallen's name, the family's status, the minutes; no contact
    const card = await weekCard(page, info, "שני", "חלל/ה לדוגמה 4");
    // the name first, alone (the yellow says «זמן זיכרון»); the whole title is the card's accessible name and its tooltip
    await expect(card.locator("[data-memorial-name]")).toHaveText("חלל/ה לדוגמה 4");
    await expect(card).toHaveAttribute("aria-label", /^זמן זיכרון – חלל\/ה לדוגמה 4, 13:00–13:15: המשפחה הוזמנה · 12 דק׳$/);
    await expect(card).toHaveAttribute("title", `זמן זיכרון – חלל/ה לדוגמה 4 · ${LRM}13:00–13:15 · המשפחה הוזמנה · 12 דק׳`);
    await expect(card.locator("[data-memorial-where]")).toHaveCount(0); // the row's only slot, all of it: its time is the row's
    await expect(card).toContainText("המשפחה הוזמנה · 12 דק׳");
    await expect(card).toHaveClass(/bg-amber-100/); // last year's yellow
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await card.click();
    const panel = page.getByRole("dialog", { name: "זמן זיכרון" });
    await expect(panel.getByRole("region", { name: "זמן הזיכרון" })).toContainText("המשפחה הוזמנה");
    await expect(panel.getByRole("group", { name: "קבצי המקורות" })).toContainText("עוד לא הועלו חומרים לזמן הזיכרון הזה.");
    await expect(panel.getByText("טלפון לדוגמה")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("two slots in one memorial row: told apart by their own time and room in the day view; the fallen's name whole on the desktop grid", async ({ page }, info) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    // a second slot in Sunday's row א: 13:05–13:10, in «כיתה ג׳», beside the placed one (13:00–13:15, בית מדרש)
    await page.getByRole("button", { name: `הוספת זמן זיכרון: ראשון ${LRM}13:00–13:15` }).click();
    const form = page.getByRole("form", { name: `זמן זיכרון חדש: ראשון ${LRM}13:00–13:15` });
    await form.getByLabel("מ-").fill("13:05");
    await form.getByLabel("עד").fill("13:10");
    await form.getByLabel("חדר").selectOption({ label: "כיתה ג׳" });
    await form.getByRole("button", { name: "הוספה" }).click();
    await expect(toast(page, "זמן הזיכרון נוסף")).toBeVisible();
    // «חלל/ה לדוגמה 2» from the tray onto it
    const plan = page.getByRole("list", { name: "תוכניות שלא שובצו" }).locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 2" });
    await plan.getByLabel("שיבוץ", { exact: true }).selectOption({ label: `ראשון ${LRM}13:05–13:10 · כיתה ג׳` });
    await plan.getByRole("button", { name: "שיבוץ: חלל/ה לדוגמה 2" }).click();
    await expect(toast(page, "«חלל/ה לדוגמה 2» שובץ/ה")).toBeVisible();

    await nav(page).getByRole("link", { name: "השבוע" }).click();
    const first = page.locator("[data-memorial-card]").filter({ hasText: "חלל/ה לדוגמה 1" });
    const second = page.locator("[data-memorial-card]").filter({ hasText: "חלל/ה לדוגמה 2" });
    if (info.project.name !== "desktop") {
      // the day view (also the only view offline): each slot its own start in the time column, and its range and room
      await page.getByRole("tab", { name: "ראשון" }).click();
      await expect(first.locator("[data-memorial-where]")).toHaveText("13:00–13:15 · בית מדרש");
      await expect(second.locator("[data-memorial-where]")).toHaveText("13:05–13:10 · כיתה ג׳");
      await expect(first.locator("xpath=../preceding-sibling::bdi")).toHaveText("13:00");
      await expect(second.locator("xpath=../preceding-sibling::bdi")).toHaveText("13:05");
      for (const c of [first, second]) expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44); // a touch target
    } else {
      // two lanes of ~80px: the name alone fits where «זמן זיכרון – <name>» was cut; the whole title on hover
      const name = first.locator("[data-memorial-name]");
      await expect(name).toHaveText("חלל/ה לדוגמה 1");
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(first).toHaveAttribute("title", /^זמן זיכרון – חלל\/ה לדוגמה 1 · /);
      await expect(second).toHaveAttribute("title", /^זמן זיכרון – חלל\/ה לדוגמה 2 · /);
    }
    await noSidewaysScroll(page);
  });

  test("a memorial page in Word says «צריך PDF» on the slot and the manifest; a plan taken back to the tray keeps its page on its card, never «להסרה»", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the flow");
    await page.goto(demoUrl());
    // Sunday's slot holds «חלל/ה לדוגמה 1»: a Word page for the reader, uploaded on the week's panel
    const card = page.locator("[data-memorial-card]").filter({ hasText: "חלל/ה לדוגמה 1" });
    await card.click();
    const panel = page.getByRole("dialog", { name: "זמן זיכרון" });
    await expect(panel.locator("[data-memorial-reader]")).toHaveAttribute("data-memorial-reader", "memorial_missing");
    await panel.locator("input[type=file]").setInputFiles({ name: "דף זיכרון.docx", mimeType: DOCX_MIME, buffer: Buffer.from("PK synthetic, never opened") });
    await expect(panel.getByRole("group", { name: "קבצי המקורות" })).toContainText("Word · צריך PDF");
    // the slot's verdict: a lesson's words — never «not uploaded» when something was
    const verdict = panel.locator("[data-memorial-reader]");
    await expect(verdict).toHaveAttribute("data-memorial-reader", "memorial_needs_pdf");
    await expect(verdict).toContainText("מקראה: זמן זיכרון — צריך PDF.");
    await expect(verdict).toContainText("צריך להעלות PDF");
    await expect(verdict).not.toContainText("עוד לא הועלו");
    await page.keyboard.press("Escape");

    await nav(page).getByRole("link", { name: "תוצרים" }).click();
    await page.getByRole("link", { name: "מקראה", exact: true }).first().click();
    const row = page.locator("[data-manifest-row][data-status^=memorial]").filter({ hasText: "חלל/ה לדוגמה 1" });
    await expect(row).toHaveAttribute("data-status", "memorial_needs_pdf");
    await expect(row).toContainText("זמן זיכרון — צריך PDF");
    await expect(row).toContainText("הועלה קובץ Word, שלא נכנס למקראה — צריך PDF");
    await expect(row).not.toContainText("החומרים עוד לא הועלו");
    await expect(page.locator("[data-manifest-totals]")).toContainText("2 צריך PDF"); // the demo's Word-only lesson, and this slot

    // the plan back in the tray: its page goes with it — on its card, «ממתין לשיבוץ» — never left at the old slot for removal
    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    const plan = page.locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 1" });
    await plan.getByLabel("שיבוץ", { exact: true }).selectOption({ label: "במגש (לא משובץ/ת)" });
    await plan.getByRole("button", { name: "למגש: חלל/ה לדוגמה 1" }).click();
    await expect(toast(page, "«חלל/ה לדוגמה 1» חזר/ה למגש")).toBeVisible();
    const inTray = page.getByRole("list", { name: "תוכניות שלא שובצו" }).locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 1" });
    const materials = inTray.getByRole("group", { name: "החומרים של התוכנית: חלל/ה לדוגמה 1" });
    await expect(materials).toContainText("ממתין לשיבוץ");
    await expect(materials.locator("[data-source-file]")).toContainText(["דף זיכרון.docx"]);
    await expect(page.getByText("מתוכנית שנמחקה מהמחזור")).toHaveCount(0);
    await noSidewaysScroll(page);

    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await page.locator("[data-memorial-card]").filter({ hasText: "עוד לא שובץ/ה" }).first().click();
    const slot = page.getByRole("dialog", { name: "זמן זיכרון" });
    await expect(slot.getByRole("region", { name: "זמן הזיכרון" })).toContainText("עוד לא שובץ/ה כאן חלל/ה.");
    await expect(slot.getByText("דף זיכרון.docx")).toHaveCount(0);
    await expect(slot.getByRole("button", { name: "הסרה" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await nav(page).getByRole("link", { name: "תוצרים" }).click();
    await page.getByRole("link", { name: "מקראה", exact: true }).first().click();
    await expect(page.locator("[data-manifest-row]").filter({ hasText: "להסרה" })).toHaveCount(0);
    const waiting = page.getByRole("list", { name: "חומרים שממתינים לשיבוץ" });
    await expect(waiting.locator("[data-source-file]")).toContainText(["חלל/ה לדוגמה 1:"]); // whose material it is
    await expect(waiting.locator("[data-source-file]")).toContainText(["דף זיכרון.docx"]);
    await noSidewaysScroll(page);
  });

  test("by keyboard, the plan's «שיבוץ» and the liaison's select only pick: an ArrowDown commits nothing until «שיבוץ» / «שמירה»", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "a keyboard on a computer");
    await page.goto(`${demoUrl()}/memorial`);
    const plan = page.getByRole("list", { name: "תוכניות שלא שובצו" }).locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 2" });
    const picker = plan.getByLabel("שיבוץ", { exact: true });
    await picker.focus();
    await page.keyboard.press("ArrowDown"); // a closed select changes on ArrowDown, and says so (change)
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(500);
    expect(await toast(page, "שובץ/ה").count()).toBe(0); // now, not after a toast would have faded
    await expect(picker).toBeFocused(); // nothing re-rendered it away
    const placed = page.locator("[data-memorial-slot]").filter({ has: page.locator("[data-memorial-plan]", { hasText: "חלל/ה לדוגמה 2" }) });
    await expect(placed).toHaveCount(0); // still in the tray
    const chosen = (await picker.locator("option:checked").textContent())!;
    expect(chosen).not.toBe("במגש (לא משובץ/ת)");
    await page.keyboard.press("Tab");
    const place = plan.getByRole("button", { name: "שיבוץ: חלל/ה לדוגמה 2" });
    await expect(place).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toast(page, "«חלל/ה לדוגמה 2» שובץ/ה")).toBeVisible();
    await expect(placed).toContainText(chosen);

    // the liaison of Sunday's slot: an ArrowDown picks another trainee, «שמירה» saves
    const sunday = page.locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 1" });
    const liaison = sunday.getByLabel("קשר עם המשפחה (המלווה)");
    const before = await liaison.inputValue();
    await liaison.focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(500);
    expect(await toast(page, "המלווה נשמר/ה").count()).toBe(0);
    await expect(liaison).toBeFocused();
    await expect(sunday.locator("dd").filter({ hasText: "מלווה לדוגמה ד׳" })).toHaveCount(1); // still the saved one
    const picked = await liaison.inputValue();
    expect(picked).not.toBe(before);
    await sunday.getByRole("button", { name: "שמירת המלווה" }).click();
    await expect(toast(page, "המלווה נשמר/ה")).toBeVisible();
    await expect(liaison).toHaveValue(picked);
    await expect(sunday.getByRole("button", { name: "שמירת המלווה" })).toHaveCount(0);
  });

  test("a «are you sure?» cancelled by keyboard gives the focus back to the button that asked: a slot's removal, a plan's deletion, a name's", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "a keyboard on a computer");
    await page.goto(`${demoUrl()}/memorial`);
    const cancel = (scope: Locator) => scope.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ביטול", exact: true });

    // Monday's free slot before lunch (v13: and one after it)
    const monday = page.getByRole("region", { name: "יום שני" });
    const removeSlot = monday.getByRole("button", { name: "הסרת המשבצת" }).first();
    await removeSlot.click();
    await cancel(monday).press("Enter");
    await expect(removeSlot).toBeFocused();
    await expect(monday.locator("[data-memorial-slot]")).toHaveCount(2); // still there

    // a plan in the tray
    const plan = page.getByRole("list", { name: "תוכניות שלא שובצו" }).locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 2" });
    const deletePlan = plan.getByRole("button", { name: "מחיקת התוכנית" });
    await deletePlan.click();
    await cancel(plan).press("Enter");
    await expect(deletePlan).toBeFocused();
    // its form opened meanwhile, «מחיקת התוכנית» is not drawn again: the plan's «שיבוץ» takes the focus, never the page
    await deletePlan.click();
    await plan.getByRole("button", { name: "עריכת התוכנית: חלל/ה לדוגמה 2" }).click();
    await cancel(plan).press("Enter");
    await expect(plan.getByLabel("שיבוץ", { exact: true })).toBeFocused();
    await expect(plan.getByRole("form", { name: "עריכת התוכנית: חלל/ה לדוגמה 2" })).toBeVisible(); // the form untouched

    // a name in the cross-year list: that row's «מחיקה», not another's — a middle row (one key for every row would hand the
    // focus to the last row drawn)
    const fallen = page.getByRole("list", { name: "החללים" });
    const deleteName = fallen.getByRole("button", { name: "מחיקה: חלל/ה לדוגמה 5" });
    await deleteName.click();
    await cancel(fallen).press("Enter");
    await expect(deleteName).toBeFocused();
    await expect(fallen.locator("[data-fallen]")).toHaveCount(9);
  });

  test("a screen whose file is gone after a deploy (the old name answered with index.html): a notice with «רענון», never a blank page", async ({ page }) => {
    await page.goto(demoUrl());
    await expect(nav(page)).toBeVisible();
    // what Cloudflare Pages answers for a chunk name the new deploy no longer has: index.html, 200, text/html
    const index = await (await page.request.get(demoUrl())).text();
    await page.route(/\/assets\/MemorialScreen-[^/]+\.js$/, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: index }));
    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    await expect(page.getByRole("heading", { name: "המסך הזה לא נטען" })).toBeVisible();
    await expect(page.getByText("כנראה שהאתר התעדכן מאז שהדף נפתח")).toBeVisible();
    await expect(nav(page)).toBeVisible(); // the header stays: the rest of the site is a click away
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await expect(page.getByRole("heading", { name: "המסך הזה לא נטען" })).toHaveCount(0);
    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    await page.unroute(/\/assets\/MemorialScreen-[^/]+\.js$/);
    await page.getByRole("button", { name: "רענון" }).click(); // the new version's files
    await expect(page.getByRole("heading", { name: "זמני זיכרון", level: 2 })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("the liaison's own link: the memorial time with their role, never a speaker's ticks — and so in the escorts' list", async ({ page }) => {
    // roster 4 (מלווה לדוגמה ד׳) is Sunday's liaison and escorts one lesson on Wednesday
    await page.goto(`${demoUrl()}/e#demo-e-1-4-dugma00000`);
    await expect(page.getByRole("heading", { name: "שלום, מלווה לדוגמה ד׳" })).toBeVisible();
    await expect(page.getByText("שיעור אחד וזמן זיכרון אחד", { exact: true })).toBeVisible();
    const cards = page.getByRole("list", { name: "השיעורים שלי" }).locator("[data-escort-lesson]");
    const memorial = cards.filter({ hasText: "זמן זיכרון" });
    await expect(memorial).toHaveCount(1);
    await expect(memorial.getByRole("checkbox")).toHaveCount(0); // no «הזכרתי למרצה» on a bereaved family's time
    await expect(memorial).toContainText("אתה איש הקשר של הצוות עם המשפחה.");
    await expect(memorial).not.toContainText("זמן זיכרון · זמן זיכרון");
    for (const secret of ["חלל/ה לדוגמה", "טלפון לדוגמה", "family1@example.org"]) await expect(memorial).not.toContainText(secret);
    await expect(cards.filter({ hasNotText: "זמן זיכרון" }).getByRole("checkbox")).toHaveCount(4); // a lesson keeps its four
    await noSidewaysScroll(page);

    await page.goto(`${demoUrl()}/print/escorts`);
    const d = page.getByRole("region", { name: "מלווה לדוגמה ד׳" });
    const liaison = d.locator("[data-lesson-row]").filter({ hasText: "איש הקשר של המשפחה" });
    await expect(liaison).toHaveCount(1);
    await expect(liaison.getByRole("list", { name: "הסימונים של המלווה" })).toHaveCount(0);
    await expect(d.locator("[data-lesson-row]").filter({ hasNotText: "איש הקשר של המשפחה" }).getByRole("list", { name: "הסימונים של המלווה" })).toHaveCount(1);
    await noSidewaysScroll(page);
  });

  test("«לוגיסטיקה»: transports (addresses and phones only when asked), payments, books, prints — each printed and downloaded", async ({ page }) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "לוגיסטיקה" }).click();
    await expect(page).toHaveURL(/\/logistics$/);
    const rows = page.locator("[data-transport-row]");
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("2 הסעות מאושרות · סודרו 1")).toBeVisible();
    await expect(rows.first()).toContainText("נהג/ת לדוגמה");
    await expect(page.getByText("כתובת לדוגמה")).toHaveCount(0);
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await noSidewaysScroll(page);
    const plain = await downloaded(page, () => page.getByRole("button", { name: "הורדת CSV" }).click());
    expect(plain.d.suggestedFilename()).toMatch(/^volozhin-transports-edition-1-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = plain.bytes.toString("utf8");
    expect(csv).toContain("נהג/ת לדוגמה");
    expect(csv).not.toMatch(/כתובת לדוגמה|טלפון לדוגמה|כתובת איסוף/);
    await page.getByRole("checkbox", { name: "כולל כתובות וטלפונים" }).check();
    await expect(rows.first()).toContainText("כתובת לדוגמה");
    await expect(rows.first()).toContainText("טלפון לדוגמה");
    const full = await downloaded(page, () => page.getByRole("button", { name: "הורדת CSV" }).click());
    expect(full.d.suggestedFilename()).toMatch(/^volozhin-transports-with-addresses-phones-/);
    expect(full.bytes.toString("utf8")).toContain("כתובת לדוגמה");
    await expect(toast(page, "יש בו כתובות וטלפונים")).toBeVisible();
    // «סודר» on the second
    await rows.nth(1).getByRole("button", { name: "סימון «סודר»" }).click();
    await expect(toast(page, "סומן שההסעה סודרה")).toBeVisible();
    await expect(page.getByText("2 הסעות מאושרות · סודרו 2")).toBeVisible();
    // the print view: the file's own table, addresses included only because the toggle is on
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("table").filter({ hasText: "כתובת איסוף" })).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "תשלומים" }).click();
    const totals = page.getByRole("definition").filter({ hasText: "₪" });
    await expect(page.getByLabel("סיכום התשלומים")).toContainText("סה״כ מאושר");
    await expect(page.locator("[data-payment-row]")).toHaveCount(2);
    await expect(totals.first()).toBeVisible();
    const unpaid = page.locator("[data-payment-row]").filter({ hasText: "טרם שולם" });
    await unpaid.getByRole("button", { name: /^סימון ששולם/ }).click();
    await expect(toast(page, "סומן ששולם")).toBeVisible();
    await expect(page.locator("[data-payment-row]").filter({ hasText: "טרם שולם" })).toHaveCount(0);
    const pay = await downloaded(page, () => page.getByRole("button", { name: "הורדת xlsx" }).click());
    const sheet = strFromU8(unzipSync(new Uint8Array(pay.bytes))["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("סה״כ");
    await noSidewaysScroll(page);

    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "ספרים" }).click();
    await expect(page.locator("[data-book-row]")).toHaveCount(3);
    const book = page.locator("[data-book-row]").first();
    await book.getByLabel("עותקים להזמנה").fill("7");
    await book.getByRole("checkbox", { name: "הוזמן" }).check();
    await book.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הזמנת הספרים נשמרה")).toBeVisible();
    await expect(page.getByText("· הוזמנו 1")).toBeVisible();
    await noSidewaysScroll(page);

    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "הדפסות" }).click();
    const ahead = page.getByRole("region", { name: "להדפיס מראש" });
    await expect(ahead.locator("[data-print-row]").first()).toContainText("דף מקורות לדוגמה.pdf");
    await expect(ahead.locator("[data-print-row]").first()).toContainText("עמודים");
    await expect(page.getByRole("region", { name: "להדפיס באותו יום" }).locator("[data-print-row]")).toContainText(["אין קבצים"]);
    for (const text of await page.locator("[data-print-row]").filter({ hasText: "אין קבצים" }).allTextContents()) expect(text.split("אין קבצים").length - 1, text).toBe(1); // said once
    await expect(page.locator("[data-print-row]").filter({ hasText: /עותקים/ })).toHaveCount(0); // no copy count nobody entered
    await noSidewaysScroll(page);
  });

  test("the archive: kk.json, memorial.json, sources.json — and the source files in their day's folder when asked", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/edition`);
    await expect(page.getByText("פרטי הקשר של המשפחות לא יוצאים מהמערכת בשום ייצוא אחר")).toBeVisible();
    await page.getByRole("checkbox", { name: "כולל קבצי המקורות" }).check();
    await expect(page.getByText(/^\d+ קבצים, כ-[\d.]+(KB|MB), בתיקייה לכל יום/)).toBeVisible();
    await expect(page.getByText(/בערך פי 3 מהגודל הזה: עדיף במחשב, לא בטלפון\.$/)).toBeVisible(); // the zip is built in memory
    await noSidewaysScroll(page);
    const zip = await downloaded(page, () => page.getByRole("button", { name: "הורדת הארכיון של הדגמה" }).click());
    const files = unzipSync(new Uint8Array(zip.bytes));
    for (const f of ["kk.json", "memorial.json", "sources.json", "edition.json", "PERSONAL-DATA_contacts_and_transport.json"]) expect(Object.keys(files)).toContain(f);
    const kk = JSON.parse(strFromU8(files["kk.json"]));
    expect(kk.groups.map((g: { title: string }) => g.title)).toContain("ספר לדוגמה א׳");
    expect(kk.signups.every((s: { name: string | null }) => typeof s.name === "string")).toBe(true);
    const memorial = JSON.parse(strFromU8(files["memorial.json"]));
    expect(memorial.fallen).toHaveLength(9);
    expect(strFromU8(files["memorial.json"])).not.toContain("טלפון לדוגמה");
    expect(JSON.parse(strFromU8(files["PERSONAL-DATA_contacts_and_transport.json"])).family_contacts).toEqual([expect.objectContaining({ fallen: "חלל/ה לדוגמה 1" })]);
    const sources = Object.keys(files).filter((k) => k.startsWith("sources/"));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((k) => k.startsWith("sources/1-ראשון/") && k.endsWith("דף מקורות לדוגמה.pdf"))).toBe(true);
    expect(strFromU8(files[sources.find((k) => k.endsWith(".pdf"))!].subarray(0, 4))).toBe("%PDF");
    await expect(toast(page, "הארכיון ירד")).toBeVisible();
  });
});

test.describe("mock build", () => {
  const signedIn = async (page: Page, role: "logistics" | "admin", global: boolean) => {
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const email = `${role}@example.org`;
    const sb = new FakeSupabase({
      status: 200,
      body: {
        status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: "חבר/ת צוות לדוגמה", global_admin: global,
        memberships: [{ edition_id: global ? null : 7, role, member_id: 5 }],
      },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    const session = await signIn(page, email);
    sb.token = session.access_token;
    return { sb, week, session };
  };

  test("logistics: the transports in one get_transports_for call; memorial times read-only, no family's contact asked for", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const { sb, week, session } = await signedIn(page, "logistics", false);
    const ride = week.lessons.find((l) => l.state === "closed" && l.transport !== "none" && l.approval === "approved")!;
    sb.answers.set("get_transports_for", [{ lesson_id: ride.id, pickup_address: "כתובת מהשרת לדוגמה", pickup_time: "07:00", driver_name: "נהג/ת מהשרת", driver_phone: null, arranged: false }]);
    await page.goto(`${mockUrl()}/logistics`);
    await expect(page.locator(`[data-transport-row="${ride.id}"]`)).toContainText("נהג/ת מהשרת");
    expect(sb.rpc.get("get_transports_for")).toEqual([{ p_edition: 7 }]);
    expect(sb.calls.find((c) => c.path === "/rest/v1/rpc/get_transports_for")!.auth).toBe(`Bearer ${session.access_token}`);
    // a lesson whose details did not come back says so — nothing is made up
    const other = page.locator("[data-transport-row]").filter({ hasNotText: "נהג/ת מהשרת" }).first();
    await expect(other).toContainText("פרטי ההסעה גלויים רק");
    expect(sb.rpc.get("get_transport_details")).toBeUndefined(); // never one lesson at a time here

    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    await expect(page.locator("[data-memorial-plan]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "+ תוכנית" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "פרטי הקשר של המשפחה" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^הוספת זמן זיכרון/ })).toHaveCount(0);
    await expect(page.getByLabel("שיבוץ")).toHaveCount(0);
    await expect(page.getByText("את התוכניות ואת השיבוץ עושה המדריך/ה של המחזור.")).toBeVisible();
    expect(sb.rpc.get("get_fallen_contacts")).toBeUndefined();
    expect(sb.calls.some((c) => c.path === "/rest/v1/fallen_contacts")).toBe(false);
  });

  test("a content member has no «לוגיסטיקה»: not in the header, and its address lands on the week", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const week = demoWeek();
    week.edition.id = 7;
    const sb = new FakeSupabase({ status: 200, body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "content@example.org", display_name: "חבר/ת צוות לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] } });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    sb.token = (await signIn(page, "content@example.org")).access_token;
    await page.goto(`${mockUrl()}/logistics/transports`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/$`));
    await expect(nav(page).getByRole("link", { name: "לוגיסטיקה" })).toHaveCount(0);
    expect(sb.rpc.get("get_transports_for")).toBeUndefined();
  });

  test("the archive reads load_kk, the fallen, and each file through a signed URL — one it could not read is named", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, week } = await signedIn(page, "admin", true);
    const lesson = week.lessons.find((l) => l.id === 1)!;
    week.sourceFiles = [
      { id: 1, lesson_id: lesson.id, cover: false, speaker_id: null, fallen_id: null, storage_path: "7/1/00000000-0000-4000-8000-000000000001-a.pdf", display_name: "קובץ א.pdf", mime: "application/pdf", size_bytes: 9, page_count: 1, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z" },
      { id: 2, lesson_id: lesson.id, cover: false, speaker_id: null, fallen_id: null, storage_path: "7/1/00000000-0000-4000-8000-000000000002-b.pdf", display_name: "קובץ ב.pdf", mime: "application/pdf", size_bytes: 9, page_count: 1, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z" },
    ];
    sb.storageFiles.set(week.sourceFiles[0].storage_path, Buffer.from("%PDF-1.7 synthetic", "latin1"));
    sb.answers.set("load_kk", { tracks: [], groups: [], leaders: [], signups: [], orders: [] });
    // the cross-year list: fallen 3 (planned here) and fallen 9 (another year's — no plan in this edition)
    sb.tables.set("fallen", [{ id: 3, name: "חלל/ה לדוגמה 3", gender: null, note: null, active: true }, { id: 9, name: "חלל/ה לדוגמה 9", gender: null, note: null, active: false }]);
    sb.answers.set("get_fallen_contacts", null);
    sb.answers.set("load_reviews", []); // v12: «איך עבר» goes into the archive too
    await page.goto(`${mockUrl()}/settings/edition`);
    await page.getByRole("checkbox", { name: "כולל קבצי המקורות" }).check();
    await expect(page.getByText("2 קבצים, כ-")).toBeVisible();
    const zip = await downloaded(page, () => page.getByRole("button", { name: /^הורדת הארכיון/ }).click());
    const files = unzipSync(new Uint8Array(zip.bytes));
    expect(Object.keys(files).filter((k) => k.startsWith("sources/"))).toEqual(["sources/1-ראשון/0830_1_קובץ א.pdf"]);
    expect(JSON.parse(strFromU8(files["sources.json"])).files.find((f: { id: number }) => f.id === 2)).toMatchObject({ not_read: true, in_zip: null });
    expect(JSON.parse(strFromU8(files["memorial.json"])).fallen.map((f: { id: number }) => f.id)).toEqual([3, 9]); // names only, every year
    expect(sb.rpc.get("load_kk")).toEqual([{ p_edition: 7 }]);
    // a family's contact asked for the fallen this edition planned for only (the demo's plans: 1, 2, 3) — never fallen 9's
    expect(sb.rpc.get("get_fallen_contacts")).toEqual([{ p_fallen: 1 }, { p_fallen: 2 }, { p_fallen: 3 }]);
    expect(sb.storage.filter((s) => s.method === "POST" && s.path === "/storage/v1/object/sign/sources")).toHaveLength(1);
    await expect(page.getByRole("alert").filter({ hasText: "קובץ אחד לא נקרא ולא נכלל:" })).toContainText("קובץ ב.pdf");
  });
});
