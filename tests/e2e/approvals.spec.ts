// «אישורים» and the transport board («לוגיסטיקה ← הסעות וצוות», a tab of the logistics home since phase 4) — the reset, phase 3 — in a real browser. One approval is
// enough, the staff's or logistics'; the vetting of speakers stays the instructor's. Demo build, every width: the
// instructor (the default demo, a global admin) asks for two payments on the lesson pages (one asked again after a «לא»),
// decides one request in its row — its pickup beside it — and the other two as a batch, then vets the speaker who
// agreed: the header's badge counts down to nothing; the vetting itself — who agreed first, the others folded and
// approved as a batch, a refusal with a word that her chip and «כל הצוות» show, the archive's «אישור באצווה» behind a
// Confirm whose «ביטול» gives the focus back (it was «המרצים שלי»'s and the old queue's). Logistics (`?as=logistics`: the demo edition made real, the board's
// synthetic pickup times and staff shifts): their header («בית» first since phase 4), «אישורים» in it counting the requests only, the requests with
// their pickups and no vetting; the board — the counts, a day at a time on the axis (a tablet up; aria-hidden) with its
// text twin, the list (the phone's whole board), the clamped early pickup and the round trip's return, the staff shifts
// (v20: no «אחראי/ת משמרת» — every shift is a shift), a pending request decided on the board (the payment with it), then
// the driver and «סודר» on it, the addresses and phones only behind «כולל כתובות וטלפונים»; v20's driver suggestions —
// «במשמרת בשעת האיסוף» and «אחריות של מכינה» — on the board and on the lesson page, a pick filling the fields only. Mock build: decide_payments and set_transport_driver go out
// by the contract's parameter names with the member's own token — from the approvals page and from the board, for a
// global admin and for logistics; v20: a pick of the suggestions saves through set_transport_driver alone, the cohort
// contact's phone read through get_rota_contacts on that click only; a decision someone else made first (`stale`) says so in one line and reads again;
// an edition's admin decides the requests and only reads how many wait for the vetting; logistics never sends
// set_transport_request (nor the old screens' set_transport_details); a trainee never sees «אישורים». Synthetic people,
// places and numbers only («נהג/ת לדוגמה», «כתובת לדוגמה», «123 456 789»).
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import type { LessonTransport } from "../../src/data/commands";
import { demoDayOwners, demoWeek } from "../../src/data/demoWeek";
import type { RotaData } from "../../src/data/rota";
import { toXlsx } from "../../src/exports/xlsx";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { expectSections, INLINE_SECTIONS, LOGISTICS_SECTIONS, noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
const badge = (page: Page) => nav(page).getByRole("link", { name: /^אישורים/ });
const requestsList = (page: Page) => page.getByRole("region", { name: "בקשות תשלום והסעה" }).getByRole("list", { name: "בקשות שממתינות לאישור" });
const request = (page: Page, speaker: string) => requestsList(page).locator("[data-request-row]").filter({ hasText: speaker });
const boardRow = (page: Page, lessonId: number) => page.locator(`li[data-transport-row="${lessonId}"]`);
const counts = (page: Page) => page.locator("[data-board-counts]");
/** A fold, by its summary's words. */
const fold = (page: Page, title: string) => page.locator("details").filter({ has: page.locator("summary", { hasText: title }) });

/** The demo's lessons by place (src/data/demoWeek.ts): the ids the pages' addresses take. */
const lessonAt = (day: number, start: number) => demoWeek().lessons.find((l) => l.day === day && l.start_min === start && l.kind === "lesson" && l.state === "closed")!.id;

/** Where the focus went after a row (and its buttons) left: never the page itself. */
async function focusKept(page: Page) {
  await expect.poll(() => page.evaluate(() => document.activeElement != null && document.activeElement !== document.body)).toBe(true);
}

/** A step of the lesson page, opened. */
async function payStep(page: Page): Promise<Locator> {
  const s = page.locator('[data-page-step="pay"]');
  const toggle = s.locator("h3 button");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return s;
}

/** «ימים» → a day's tab → a slot's «לשיעור»: the staff's way to a lesson page. */
async function lessonFromDay(page: Page, day: string, speaker: string) {
  await nav(page).getByRole("link", { name: "ימים" }).click();
  await page.getByRole("tablist", { name: "ימי השבוע" }).getByRole("tab", { name: new RegExp(`^${day}`) }).click();
  await page.locator("[data-slot-card]").filter({ hasText: speaker }).getByRole("link", { name: "לשיעור" }).click();
  await expect(page).toHaveURL(/\/lesson\/\d+/);
}

test.describe("demo build — the instructor", () => {
  test("requests asked on their lesson pages, one decided in its row with its pickup, two as a batch; the vetting below; the badge counts down to nothing", async ({ page }) => {
    await page.goto(`${demoUrl()}/day/0`);
    // the demo's request that waits, and a speaker who agreed and waits for the vetting (v14)
    await expect(badge(page)).toHaveAccessibleName("אישורים, 2 ממתינים");

    // Sunday 14:30 «מרצה 07»: a payment, nothing else — sent for approval from the lesson page, and decided right there too
    await page.locator("[data-slot-card]").filter({ hasText: "מרצה 07" }).getByRole("link", { name: "לשיעור" }).click();
    let pay = await payStep(page);
    let form = pay.getByRole("form", { name: "בקשת תשלום והסעה" });
    await form.getByRole("radio", { name: "תשלום", exact: true }).check();
    await form.getByLabel("סכום בשקלים").fill("150");
    await form.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect(toast(page, "הבקשה נשלחה לאישור")).toBeVisible();
    await expect(pay.getByRole("group", { name: "החלטה על הבקשה" })).toBeVisible();
    await expect(badge(page)).toHaveAccessibleName("אישורים, 3 ממתינים");

    // Monday 10:00 «ד״ר מרצה 25»: refused before — asked again as it was
    await lessonFromDay(page, "שני", "מרצה 25");
    pay = await payStep(page);
    form = pay.getByRole("form", { name: "בקשת תשלום והסעה" });
    await expect(form.getByLabel("סכום בשקלים")).toHaveValue("300");
    await form.getByRole("button", { name: "בקשה מחדש" }).click();
    await expect(toast(page, "הבקשה נשלחה לאישור")).toBeVisible();
    await expect(badge(page)).toHaveAccessibleName("אישורים, 4 ממתינים");

    await badge(page).click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(badge(page)).toHaveAttribute("aria-current", "page");
    // one row per request, by time; each the lesson's day, time and speaker as a link to its pay step, then what was asked
    const rows = requestsList(page).locator("[data-request-row]");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-lesson-id"))))).toEqual([lessonAt(0, 870), lessonAt(1, 510), lessonAt(1, 600)]);
    await expect(request(page, "מרצה 07")).toContainText("בטיפול: חניך/ה ג׳ · 150 ₪ · בלי הסעה");
    await expect(request(page, "מרצה 07").locator("[data-pickup]")).toHaveCount(0); // a payment alone: no pickup
    await expect(request(page, "מרצה 04")).toContainText("200 ₪ · הלוך ושוב");
    await expect(request(page, "מרצה 04").locator("[data-pickup]")).toHaveText("איסוף: כתובת לדוגמה"); // ONE transports read for the page
    await expect(request(page, "מרצה 04").getByRole("link")).toHaveAttribute("href", `/lesson/${lessonAt(1, 510)}?step=pay`);
    await expect(page.getByRole("region", { name: "בקשות תשלום והסעה" })).toContainText("אישור אחד מספיק");
    await noSidewaysScroll(page);

    // one, in its row
    await requestsList(page).getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" }).click();
    await expect(toast(page, "הבקשה אושרה")).toBeVisible();
    await expect(rows).toHaveCount(2);
    await expect(badge(page)).toHaveAccessibleName("אישורים, 3 ממתינים");
    await focusKept(page);

    // the other two as a batch, with a note to the team
    await page.getByLabel("הערה לאישור (לא חובה, גלויה לצוות)").first().fill("נתון לדוגמה: אושר באצווה");
    const all = page.getByRole("checkbox", { name: "סימון כל הבקשות" });
    await requestsList(page).getByRole("checkbox", { name: "סימון הבקשה של מרצה 07" }).check();
    await expect(page.getByRole("button", { name: "אישור בקשה מסומנת" })).toBeVisible();
    await all.check();
    await page.getByRole("button", { name: "אישור 2 בקשות מסומנות" }).click();
    await expect(toast(page, "2 בקשות אושרו")).toBeVisible();
    await expect(page.getByRole("region", { name: "בקשות תשלום והסעה" })).toContainText("אין בקשות שממתינות לאישור.");
    await expect(badge(page)).toHaveAccessibleName("אישורים, 1 ממתין");
    await focusKept(page);

    // the vetting, the instructor's alone: who agreed, her name the way to her page
    const vetting = page.getByRole("group", { name: "מרצים שהסכימו — ממתינים לאישור" });
    await expect(vetting.getByRole("listitem")).toHaveCount(1);
    await expect(vetting.getByRole("link", { name: /מרצה 56/ })).toHaveAttribute("href", "/speakers/56");
    await vetting.getByRole("button", { name: "אישור מרצה 56" }).click();
    await expect(toast(page, "מרצה 56 אושרה")).toBeVisible();
    await expect(page.getByText("אין מרצים שהסכימו ומחכים לאישור.")).toBeVisible();
    await expect(badge(page)).toHaveAccessibleName("אישורים"); // nothing waits: no count
    await focusKept(page);
    await noSidewaysScroll(page);

    // back on Monday's lesson: approved — the request's step is done, with the batch's note
    await lessonFromDay(page, "שני", "מרצה 25");
    pay = await payStep(page);
    await expect(pay.locator("[data-approval]")).toHaveAttribute("data-approval", "approved");
    await expect(pay).toContainText("נתון לדוגמה: אושר באצווה");
  });
});

test.describe("demo build — the instructor's vetting", () => {
  test("who agreed first; the others folded, approved as a batch; a refusal with a word — her chip and «כל הצוות» say so; the badge counts who agreed and the requests", async ({ page }) => {
    await page.goto(`${demoUrl()}/approvals`);
    await expect(badge(page)).toHaveAccessibleName("אישורים, 2 ממתינים");
    const agreed = page.getByRole("group", { name: "מרצים שהסכימו — ממתינים לאישור" });
    await expect(agreed.getByRole("listitem")).toHaveCount(1);
    await expect(agreed.getByRole("listitem")).toContainText("מרצה 56");
    const more = fold(page, "עוד ממתינים לאישור");
    await expect(more.locator("summary")).toHaveText(/עוד ממתינים לאישור\s*4/);
    await noSidewaysScroll(page);

    // four more wait, none of them agreed this edition: a batch, and the badge does not move
    await more.locator("summary").click();
    const rest = page.getByRole("group", { name: "עוד ממתינים לאישור" });
    await expect(rest.getByRole("listitem")).toHaveCount(4);
    await rest.getByLabel("סימון הכול").check();
    await rest.getByRole("button", { name: "אישור 4 מסומנים" }).click();
    await expect(toast(page, "4 מרצים אושרו")).toBeVisible();
    await expect(more.getByText("אין עוד מרצים שממתינים לאישור.")).toBeVisible();
    await expect(badge(page)).toHaveAccessibleName("אישורים, 2 ממתינים");
    await focusKept(page);

    // who agreed, not approved, with a word to the team: the badge counts down
    await agreed.getByRole("button", { name: "דחייה מרצה 56" }).click();
    await page.getByRole("group", { name: "דחיית מרצה 56" }).getByLabel("למה? (לא חובה, גלוי לצוות)").fill("נתון לדוגמה: לא השנה");
    await page.getByRole("button", { name: "לא לאשר אותה" }).click();
    await expect(toast(page, "מרצה 56 לא אושרה")).toBeVisible();
    await expect(page.getByText("אין מרצים שהסכימו ומחכים לאישור.")).toBeVisible();
    await expect(badge(page)).toHaveAccessibleName("אישורים, 1 ממתין");
    await focusKept(page);
    await noSidewaysScroll(page);

    // «כל הצוות» and her page say so — and the word to the team, on her chip
    await nav(page).getByRole("link", { name: "מרצים" }).click();
    await page.getByRole("link", { name: "כל הצוות" }).click();
    const row = page.locator("[data-team-view]").getByRole("region", { name: "מדריך/ה (הדגמה)", exact: true }).locator("li").filter({ hasText: "מרצה 56" });
    await expect(row).toContainText("לא אושרה");
    await row.getByRole("link").click();
    await expect(page).toHaveURL(/\/speakers\/56$/);
    const chip = page.locator("header [data-vetting]");
    await expect(chip).toHaveAttribute("data-vetting", "rejected");
    await expect(chip).toHaveAttribute("title", /«נתון לדוגמה: לא השנה»/);
    await chip.click();
    await expect(page.getByRole("group", { name: "אישור המדריך/ה" })).toContainText("«נתון לדוגמה: לא השנה»");
  });

  test("«אישור באצווה» of who taught in an archive, inside «עוד ממתינים לאישור»: «ביטול» gives the focus back; the badge does not count them", async ({ page }, info) => {
    // an archive edition, through the import (tests/e2e/import.spec.ts walks the rest of it): two who taught in it
    const bytes = toXlsx([
      {
        name: "מעקב",
        headers: ["מרצה", "שיעור ב", "כותרת"],
        rows: [
          ["הרבנית ארכיון אלף", "ראשון 8:30", "שיעור ארכיון א"],
          ["ארכיון בית", "שני 10:00", "שיעור ארכיון ב"],
        ],
      },
    ]);
    await page.goto(`${demoUrl()}/settings/import`);
    await page.locator("summary", { hasText: "קבצים של אשתקד" }).click(); // last year's two files are folded under the candidates
    await page.getByRole("radio", { name: "גיליון המעקב" }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "מעקב לדוגמה.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון לדוגמה");
    // checked against the pool by itself: «ייבוא» once it has
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור", exact: true }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();

    await badge(page).click();
    await expect(badge(page)).toHaveAccessibleName("אישורים, 2 ממתינים"); // the imported have no approach this edition
    const more = fold(page, "עוד ממתינים לאישור");
    await more.locator("summary").click();
    const batch = more.getByRole("group", { name: "אישור באצווה: מי שלימד/ה ב-ארכיון לדוגמה" });
    const ask = batch.getByRole("button", { name: "אישור 2 מרצים שלימדו ב-ארכיון לדוגמה" });
    await ask.click();
    const confirm = batch.getByRole("group", { name: "אישור", exact: true });
    await expect(confirm).toContainText("לאשר 2 מרצים שלימדו ב-ארכיון לדוגמה?");
    await confirm.getByRole("button", { name: "ביטול" }).press("Enter");
    await expect(confirm).toHaveCount(0);
    await expect(ask).toBeFocused(); // not the page: the keyboard is where it was
    const rest = more.getByRole("group", { name: "עוד ממתינים לאישור" });
    await expect(rest.getByRole("listitem")).toHaveCount(6); // nothing approved
    await noSidewaysScroll(page);
    // a waiting speaker's name is the way to their page — where the archive's lesson is
    if (info.project.name === "desktop") {
      await rest.getByRole("link", { name: /^ארכיון בית/ }).click();
      await expect(page).toHaveURL(/\/speakers\/\d+$/);
      await expect(page.getByRole("region", { name: "שיעורים במחזורים" })).toContainText("ארכיון לדוגמה");
    }
  });
});

test.describe("demo build — logistics", () => {
  test("«אישורים» in the header counts the requests only; the requests with their pickups, and no vetting", async ({ page }) => {
    await page.goto(`${demoUrl()}/?as=logistics`);
    // phase 4: logistics' own header — «בית» (their home, `/` sends them there), «אישורים», the week to read — and no settings
    await expect(page).toHaveURL(new RegExp(`${demoUrl()}/logistics$`));
    await expectSections(page, LOGISTICS_SECTIONS, INLINE_SECTIONS); // «מצגות» since the reset's phase 5; below 1024px the row's four and «עוד»
    await expect(badge(page)).toHaveAccessibleName("אישורים, 1 ממתין"); // not the speaker who waits for the instructor
    await badge(page).click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(requestsList(page).locator("[data-request-row]")).toHaveCount(1);
    await expect(request(page, "מרצה 04").locator("[data-pickup]")).toHaveText("איסוף: 06:10 · כתובת לדוגמה");
    await expect(requestsList(page).getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" })).toBeVisible();
    // vetting is the instructor's: not a section, not a count
    await expect(page.locator("#vetting")).toHaveCount(0);
    await expect(page.locator("[data-vetting-count]")).toHaveCount(0);
    await expect(page.getByText("עוד ממתינים לאישור")).toHaveCount(0);
    await noSidewaysScroll(page);
    // «אחרי השבוע» and «ימים» are not logistics' pages: their home
    await page.goto(`${demoUrl()}/after`);
    await expect(page).toHaveURL(new RegExp(`${demoUrl()}/logistics$`));
    await expect(page.locator("[data-logistics-home]")).toBeVisible();
  });

  test("the board: the counts, a day's lanes and their text twin, an early pickup and a return; a request decided there; the driver and «סודר»", async ({ page }, info) => {
    const phone = info.project.name === "phone";
    await page.goto(`${demoUrl()}/logistics/transports?as=logistics`);
    await expect(counts(page)).toHaveText("ממתינות לאישור 1 · אושרו 2 · סודרו 1");
    // the days, each with its count; the first day with a transport opens
    const tabs = page.getByRole("group", { name: "ימים" }).getByRole("button");
    await expect(tabs).toHaveCount(5);
    await expect(page.getByRole("button", { name: "יום ראשון: הסעה אחת" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "יום שלישי: 0 הסעות" })).toBeVisible();
    for (const h of await tabs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
    const sunday = boardRow(page, lessonAt(0, 510));
    await expect(sunday).toHaveAttribute("data-state", "arranged");
    await expect(sunday).toContainText("סודר");
    await expect(sunday.locator("[data-pickup]")).toHaveText("07:15");
    await expect(sunday.locator("[data-driver]")).toHaveText("נהג/ת לדוגמה");
    // the shifts beside it, never a phone — v20 (plan §ה): no «אחראי/ת משמרת», no lead's badge
    const shifts = page.getByRole("list", { name: "משמרות צוות" });
    await expect(shifts).toContainText("איש/אשת צוות לדוגמה");
    await expect(shifts.locator("[data-shift]").first()).toBeVisible();
    await expect(shifts.locator("[data-lead]")).toHaveCount(0);
    await expect(page.getByText("אחראי/ת")).toHaveCount(0);
    // the addresses and the phones: only when asked
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await expect(page.getByText("כתובת לדוגמה")).toHaveCount(0);
    await noSidewaysScroll(page);

    // Monday: the round trip that waits — picked up at 06:10, before the axis begins; the return from the lesson's end
    await page.getByRole("button", { name: "יום שני: הסעה אחת" }).click();
    await expect(page).toHaveURL(/[?&]day=1/);
    const monday = boardRow(page, lessonAt(1, 510));
    await expect(monday).toHaveAttribute("data-state", "pending");
    await expect(monday).toContainText("ממתין לאישור");
    await expect(monday).toContainText("פרופ׳ מרצה 04");
    await expect(monday.locator("[data-pickup]")).toHaveText("06:10 (לפני 06:30)");
    await expect(monday.locator("[data-pickup]")).toHaveAttribute("data-clamped", "true");
    // back from the teaching's end (08:30 + 75 minutes), as the card's time, the speaker's message and the escort's page say
    await expect(monday).toContainText("08:30–09:45");
    await expect(monday.locator("[data-return]")).toHaveText("· חזרה מ-09:45");
    await expect(monday).toContainText("בטיפול");
    await expect(monday).toContainText("מדריך/ה (הדגמה)");
    await expect(monday.getByRole("button", { name: /^עריכת הנהג\/ת/ })).toHaveCount(0); // never before the approval
    await expect(page.getByRole("list", { name: "משמרות צוות" })).toContainText("איש/אשת צוות לדוגמה ב׳");

    const axis = page.locator("[data-board-axis]");
    if (phone) {
      // a phone: one day, the list alone
      await expect(axis).toBeHidden();
    } else {
      // the axis is for the eye: its text twin is the list — one lane per row, a shift lane per shift
      await expect(axis).toBeVisible();
      await expect(axis).toHaveAttribute("aria-hidden", "true");
      const lanes = await axis.locator("[data-lane]").evaluateAll((els) => els.map((e) => e.getAttribute("data-lane")));
      const listed = await page.locator("li[data-transport-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-transport-row")));
      expect(lanes).toEqual(listed);
      await expect(axis.locator("[data-shift-lane]")).toHaveCount(await page.getByRole("list", { name: "משמרות צוות" }).locator("[data-shift]").count());
      const lane = axis.locator(`[data-lane="${lessonAt(1, 510)}"]`);
      await expect(lane.locator('[data-outbound="bar"]')).toHaveAttribute("data-clamped", "true");
      await expect(lane.locator('[data-outbound="bar"]')).toHaveAttribute("style", /inset-inline-start: 0%/); // from the axis' edge
      await expect(lane.locator("[data-return]").first()).toHaveAttribute("data-return", "585");
      await expect(lane).toContainText("חזרה מ-09:45");
      await expect(lane.locator("[data-teach]")).toHaveAttribute("data-teach", "510-585"); // the lesson's block: its teaching, not the row's 10:00
      // a lane's click: its row in the list takes the focus
      await lane.click();
      await expect(monday).toBeFocused();
    }
    await noSidewaysScroll(page);

    // decided on the board: one approval decides the payment with the transport — the page says so
    await expect(monday).toContainText("אישור אחד מחליט גם על התשלום (200 ₪) וגם על ההסעה.");
    await monday.getByRole("group", { name: "החלטה על הבקשה" }).getByRole("button", { name: "אישור הבקשה" }).click();
    await expect(toast(page, "הבקשה אושרה")).toBeVisible();
    await expect(counts(page)).toHaveText("ממתינות לאישור 0 · אושרו 3 · סודרו 1");
    await expect(monday).toHaveAttribute("data-state", "approved");
    await expect(monday).toContainText("אושר — עוד לא סודר");
    await focusKept(page);
    await expect(badge(page)).toHaveAccessibleName("אישורים");

    // the driver: «ביטול» gives «עריכת הנהג/ת» the focus back; then name, phone and «סודר»
    const edit = monday.getByRole("button", { name: "עריכת הנהג/ת: פרופ׳ מרצה 04" });
    await edit.click();
    const driver = monday.getByRole("form", { name: "עריכת הנהג/ת: פרופ׳ מרצה 04" });
    await expect(driver.getByLabel("שם הנהג/ת")).toBeFocused();
    await expect(driver).toContainText("כשמסמנים «סודר», דף המלווה מציג את השם והטלפון של הנהג/ת.");
    await driver.getByRole("button", { name: "ביטול" }).click();
    await expect(driver).toHaveCount(0);
    await expect(edit).toBeFocused();
    await edit.click();
    await driver.getByLabel("שם הנהג/ת").fill("נהג/ת לדוגמה ב׳");
    await driver.getByLabel("טלפון הנהג/ת").fill("12-34");
    await driver.getByRole("button", { name: "שמירה" }).click();
    await expect(driver.getByText("מספר הטלפון לא תקין", { exact: false })).toBeVisible(); // said beside the form, nothing sent
    await driver.getByLabel("טלפון הנהג/ת").fill("123 456 789");
    await driver.getByRole("checkbox", { name: "סודר" }).check();
    await noSidewaysScroll(page);
    await driver.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "פרטי הנהג/ת נשמרו")).toBeVisible();
    await expect(counts(page)).toHaveText("ממתינות לאישור 0 · אושרו 3 · סודרו 2");
    await expect(monday).toHaveAttribute("data-state", "arranged");
    await expect(monday.locator("[data-driver]")).toHaveText("נהג/ת לדוגמה ב׳");
    await expect(monday).not.toContainText("123 456 789");
    await expect(edit).toBeFocused();

    // «כולל כתובות וטלפונים»: the pickup's address and the driver's phone
    await page.getByRole("checkbox", { name: "כולל כתובות וטלפונים" }).check();
    await expect(monday).toContainText("כתובת לדוגמה");
    await expect(monday).toContainText("123 456 789");

    // Wednesday: approved, a pickup of its own, no driver yet; the logistics member on the day's shift
    await page.getByRole("button", { name: "יום רביעי: הסעה אחת" }).click();
    const wednesday = boardRow(page, lessonAt(3, 600));
    await expect(wednesday).toHaveAttribute("data-state", "approved");
    await expect(wednesday.locator("[data-pickup]")).toHaveText("08:45");
    await expect(wednesday.locator("[data-driver]")).toHaveText("—");
    await expect(page.getByRole("list", { name: "משמרות צוות" }).locator("[data-shift]")).toContainText(["לוגיסטיקה (הדגמה)"]);
    // the pickup is the handler's: read-only here, «לדף השיעור» for it
    await expect(wednesday.getByRole("link", { name: /^לדף השיעור/ })).toHaveAttribute("href", `/lesson/${lessonAt(3, 600)}?step=pay`);
    await expect(wednesday.getByLabel("כתובת איסוף")).toHaveCount(0);
    await noSidewaysScroll(page);

    // v20 (plan §ו): who could drive — the staff on shift at 08:45 (the logistics member, 08:30–14:30) and the cohorts
    // whose staff can drive and are on campus that morning («ב»); a pick only fills the fields, «ביטול» saves nothing
    const wedEdit = wednesday.getByRole("button", { name: /^עריכת הנהג\/ת/ });
    await wedEdit.click();
    const wedForm = wednesday.getByRole("form", { name: /^עריכת הנהג\/ת/ });
    const suggestions = wedForm.locator("[data-driver-suggestions]");
    await expect(suggestions).toContainText("במשמרת בשעת האיסוף");
    await expect(suggestions.locator("[data-suggest-staff]")).toHaveText([/^לוגיסטיקה \(הדגמה\)\s*08:30–14:30$/]);
    await expect(suggestions.locator("[data-suggest-cohort]")).toHaveText(["צוות מכינה לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב"]);
    for (const b of await suggestions.locator("[data-suggest-staff], [data-suggest-cohort]").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await suggestions.locator("[data-suggest-staff]").click();
    await expect(wedForm.getByLabel("שם הנהג/ת")).toHaveValue("לוגיסטיקה (הדגמה)");
    await expect(suggestions.getByRole("status")).toHaveText("מולא שם הנהג/ת: לוגיסטיקה (הדגמה). את הטלפון מקלידים.");
    await expect(suggestions.locator("[data-suggest-staff]")).toBeFocused(); // the focus stays on the pick
    await suggestions.locator("[data-suggest-cohort]").click();
    await expect(wedForm.getByLabel("שם הנהג/ת")).toHaveValue("צוות מכינה לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב");
    // the demo's contact phone is a placeholder word, not a number: the phone field stays empty, and the line says why
    await expect(suggestions.getByRole("status")).toContainText("לא נראה כמו מספר טלפון — אפשר להקליד");
    await expect(wedForm.getByLabel("טלפון הנהג/ת")).toHaveValue("");
    await noSidewaysScroll(page);
    await wedForm.getByRole("button", { name: "ביטול" }).click();
    await expect(wedForm).toHaveCount(0);
    await expect(wedEdit).toBeFocused();
    await expect(wednesday.locator("[data-driver]")).toHaveText("—"); // nothing was sent

    // «אישורים»: nothing waits now
    await badge(page).click();
    await expect(page.getByRole("region", { name: "בקשות תשלום והסעה" })).toContainText("אין בקשות שממתינות לאישור.");
  });
});

test.describe("demo build — logistics: a refusal asks once; the lesson page's driver", () => {
  test("«דחייה» asks once and «ביטול» gives the focus back; the lesson page gives the driver only once approved — the board's form, never the old one", async ({ page }) => {
    await page.goto(`${demoUrl()}/logistics/transports?day=1&as=logistics`);
    const monday = boardRow(page, lessonAt(1, 510));
    const decide = monday.getByRole("group", { name: "החלטה על הבקשה" });
    const reject = decide.getByRole("button", { name: "דחייה" });
    await reject.click();
    await expect(decide).toContainText("לא לאשר את הבקשה? אחר כך אפשר רק לבקש שוב.");
    await expect(decide.getByRole("button", { name: "ביטול" })).toBeFocused();
    await decide.getByRole("button", { name: "ביטול" }).click();
    await expect(reject).toBeFocused();
    await expect(monday).toHaveAttribute("data-state", "pending"); // nothing was decided
    await expect(counts(page)).toHaveText("ממתינות לאישור 1 · אושרו 2 · סודרו 1");

    // its lesson page while it waits: the pickup to read, no driver — and never the old whole-details form
    await monday.getByRole("link", { name: /^לדף השיעור/ }).click();
    await expect(page).toHaveURL(new RegExp(`/lesson/${lessonAt(1, 510)}\\?step=pay$`));
    const pay = await payStep(page);
    const details = pay.getByRole("group", { name: "פרטי ההסעה" });
    await expect(details).toContainText("06:10");
    await expect(details).toContainText("את הנהג/ת קובעים אחרי האישור.");
    await expect(pay.getByRole("button", { name: "עריכת פרטי ההסעה" })).toHaveCount(0);
    await expect(pay.getByRole("button", { name: "עריכת הנהג/ת" })).toHaveCount(0);
    await expect(pay.getByLabel("שם הנהג/ת")).toHaveCount(0);
    await noSidewaysScroll(page);

    // decided right there: then the driver, on the board's form (name, phone, «סודר» — not the pickup)
    await pay.getByRole("group", { name: "החלטה על הבקשה" }).getByRole("button", { name: "אישור הבקשה" }).click();
    await expect(toast(page, "הבקשה אושרה")).toBeVisible();
    const edit = details.getByRole("button", { name: "עריכת הנהג/ת" });
    await edit.click();
    const driver = details.getByRole("form", { name: /^עריכת הנהג\/ת/ });
    await expect(driver.getByLabel("שם הנהג/ת")).toBeFocused();
    await expect(driver).toContainText("כשמסמנים «סודר», דף המלווה מציג את השם והטלפון של הנהג/ת.");
    await expect(driver.getByLabel("כתובת איסוף")).toHaveCount(0);
    await expect(driver.getByLabel("שעת איסוף")).toHaveCount(0);
    // v20: the board's suggestions here too — a pickup at 06:10 is checked against Sunday's night shift, then Monday's
    // morning: «איש/אשת צוות לדוגמה ב׳» (06:30–12:00); «ב»'s staff can drive and is on campus that night
    const suggestions = driver.locator("[data-driver-suggestions]");
    await expect(suggestions).toContainText("ליל ראשון–שני");
    await expect(suggestions.locator("[data-suggest-staff]")).toHaveText([/^איש\/אשת צוות לדוגמה ב׳\s*06:30–12:00$/]);
    await expect(suggestions.locator("[data-suggest-cohort]")).toHaveText(["צוות מכינה לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב"]);
    await suggestions.locator("[data-suggest-staff]").click();
    await expect(driver.getByLabel("שם הנהג/ת")).toHaveValue("איש/אשת צוות לדוגמה ב׳");
    await noSidewaysScroll(page);
    await driver.getByLabel("שם הנהג/ת").fill("נהג/ת לדוגמה ב׳");
    await driver.getByRole("checkbox", { name: "סודר" }).check();
    await driver.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "פרטי הנהג/ת נשמרו")).toBeVisible();
    await expect(details).toContainText("נהג/ת לדוגמה ב׳");
    await expect(details).toContainText("ההסעה סודרה");
    await expect(edit).toBeFocused();
    await noSidewaysScroll(page);

    // the board says the same — «הסעות וצוות», a tab of the logistics home (phase 4)
    await nav(page).getByRole("link", { name: "בית", exact: true }).click();
    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "הסעות וצוות" }).click();
    await expect(page).toHaveURL(/\/logistics\/transports$/);
    await page.getByRole("button", { name: "יום שני: הסעה אחת" }).click();
    await expect(boardRow(page, lessonAt(1, 510))).toHaveAttribute("data-state", "arranged");
    await expect(boardRow(page, lessonAt(1, 510)).locator("[data-driver]")).toHaveText("נהג/ת לדוגמה ב׳");
    await expect(counts(page)).toHaveText("ממתינות לאישור 0 · אושרו 3 · סודרו 2");
  });
});

test.describe("demo build — a trainee", () => {
  test("never «אישורים»: not in the header, and its address lands on «היום שלי»", async ({ page }) => {
    await page.goto(`${demoUrl()}/approvals?as=trainee`);
    await expect(page).toHaveURL(new RegExp(`${demoUrl()}/$`));
    await expect(page.getByRole("heading", { name: "היום שלי", level: 2 })).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
  });
});

// ------------------------------------------------------------------ mock build

type Who = { email: string; role: "admin" | "logistics" | "content"; global: boolean; member: number };

/** The demo's week as edition 7, real; two requests waiting (Sunday 14:30 «מרצה 07», a payment; Monday 08:30 «מרצה 04»). */
function realWeek() {
  const week = demoWeek();
  week.edition.id = 7;
  week.edition.kind = "real";
  week.dayOwners = demoDayOwners();
  Object.assign(week.lessons.find((l) => l.id === lessonAt(0, 870))!, { pay_amount: 150, approval: "pending" });
  return week;
}

/** What get_transports_for answers: the requests that wait and the approved ones, each with its pickup_min. */
function transportsOf(): LessonTransport[] {
  return [
    { lesson_id: lessonAt(0, 510), pickup_address: "כתובת לדוגמה", pickup_time: "07:15", driver_name: "נהג/ת מהשרת", driver_phone: null, arranged: true, approval: "approved", pickup_min: 435 },
    { lesson_id: lessonAt(1, 510), pickup_address: "כתובת לדוגמה", pickup_time: "08:00", driver_name: null, driver_phone: null, arranged: false, approval: "pending", pickup_min: 480 },
    { lesson_id: lessonAt(3, 600), pickup_address: "כתובת לדוגמה", pickup_time: null, driver_name: null, driver_phone: null, arranged: false, approval: "approved", pickup_min: null },
  ];
}

async function signedIn(page: Page, who: Who, week = realWeek()) {
  const sb = new FakeSupabase({
    status: 200,
    body: {
      status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: who.email, display_name: "חבר/ת צוות לדוגמה", global_admin: who.global,
      memberships: [{ edition_id: who.global ? null : 7, role: who.role, member_id: who.member }],
    },
  });
  sb.answers.set("editions", [week.edition]);
  sb.answers.set("load_week", week);
  sb.answers.set("get_transports_for", transportsOf());
  sb.answers.set("load_rota", { cohorts: [], cohortDuties: [], presence: [], groups: [], duties: [], assignments: [], staff: [], prep: [] } satisfies RotaData);
  for (const fn of ["decide_payments", "set_transport_driver"]) sb.answers.set(fn, null);
  await sb.attach(page);
  const session = await signIn(page, who.email);
  sb.token = session.access_token;
  return { sb, week, session };
}

/**
 * v20: a rota for the driver's suggestions (load_rota's answer — names only, never a phone): on Wednesday the logistics
 * member 08:30–14:30 and a named member 14:30–22:30; «א» on campus that morning but its staff cannot drive, «ב» can and
 * is there, «ג» can and is there only on Tuesday.
 */
function suggestRota(): RotaData {
  const cohort = (id: number, letter: string, can_drive: boolean, contact_name: string | null) => ({
    id, edition_id: 7, letter, name: `מכינה לדוגמה ${letter}`, trainees: 10, diet_veg: null, diet_gf: null, diet_both: null, contact_name, sort: id, can_drive,
  });
  return {
    cohorts: [cohort(1, "א", false, "איש/אשת קשר לדוגמה א"), cohort(2, "ב", true, "איש/אשת קשר לדוגמה ב"), cohort(3, "ג", true, null)],
    cohortDuties: [],
    presence: [
      { cohort_id: 1, day: 3, shift: 0 },
      { cohort_id: 2, day: 3, shift: 0 },
      { cohort_id: 3, day: 2, shift: 0 },
    ],
    groups: [],
    duties: [],
    assignments: [],
    staff: [
      { id: 41, edition_id: 7, day: 3, start_min: 510, end_min: 870, member_id: 5, name: "לוגיסטיקה (הדגמה)", cohort_id: null, note: null },
      { id: 42, edition_id: 7, day: 3, start_min: 870, end_min: 1350, member_id: null, name: "איש/אשת צוות לדוגמה", cohort_id: null, note: null },
    ],
    prep: [],
  };
}

/** Every call of these functions carried the member's own token. */
function tokens(sb: FakeSupabase, token: string, fns: string[]) {
  for (const fn of fns) {
    const calls = sb.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}`);
    expect(calls.length, fn).toBeGreaterThan(0);
    for (const c of calls) expect(c.auth, fn).toBe(`Bearer ${token}`);
  }
}

function desktopOnly(info: TestInfo) {
  test.skip(info.project.name !== "desktop", "one width is enough for the wire format and the permissions");
}

test.describe("mock build", () => {
  test("a global admin: decide_payments from the approvals page (one, a batch, a refusal) and the board; set_transport_driver with the changed keys only", async ({ page }, info) => {
    desktopOnly(info);
    const { sb, session } = await signedIn(page, { email: "admin@example.org", role: "admin", global: true, member: 1 });
    await page.goto(`${mockUrl()}/approvals`);
    // one transports read for the page, by the edition
    await expect(request(page, "מרצה 04").locator("[data-pickup]")).toHaveText("איסוף: 08:00 · כתובת לדוגמה");
    expect(sb.rpc.get("get_transports_for")).toEqual([{ p_edition: 7 }]);
    expect(sb.rpc.get("get_transport_details")).toBeUndefined(); // never one lesson at a time here

    // one, with a note
    await page.getByLabel("הערה לאישור (לא חובה, גלויה לצוות)").first().fill("נתון לדוגמה");
    await requestsList(page).getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" }).click();
    await expect.poll(() => sb.rpc.get("decide_payments")?.length ?? 0).toBe(1);
    expect(sb.rpc.get("decide_payments")![0]).toEqual({ p_lessons: [lessonAt(1, 510)], p_versions: [1], p_decision: "approved", p_note: "נתון לדוגמה" });
    // (this fake database answers the same week again: both still wait) — a batch of both, in the rows' order
    await page.getByRole("checkbox", { name: "סימון כל הבקשות" }).check();
    await page.getByRole("button", { name: "אישור 2 בקשות מסומנות" }).click();
    await expect.poll(() => sb.rpc.get("decide_payments")?.length ?? 0).toBe(2);
    expect(sb.rpc.get("decide_payments")![1]).toEqual({ p_lessons: [lessonAt(0, 870), lessonAt(1, 510)], p_versions: [1, 1], p_decision: "approved", p_note: null });
    // a refusal, with why
    await requestsList(page).getByRole("button", { name: "דחיית הבקשה של מרצה 07" }).click();
    await page.getByRole("group", { name: "דחיית הבקשה של מרצה 07" }).getByLabel("למה? (לא חובה, גלוי לצוות)").fill("נתון לדוגמה: לבדוק שוב");
    await page.getByRole("button", { name: "לא לאשר" }).click();
    await expect.poll(() => sb.rpc.get("decide_payments")?.length ?? 0).toBe(3);
    expect(sb.rpc.get("decide_payments")![2]).toEqual({ p_lessons: [lessonAt(0, 870)], p_versions: [1], p_decision: "rejected", p_note: "נתון לדוגמה: לבדוק שוב" });

    // the board: the pending one decided there — the same call
    await page.goto(`${mockUrl()}/logistics/transports?day=1`);
    const monday = boardRow(page, lessonAt(1, 510));
    await expect(monday.locator("[data-pickup]")).toHaveText("08:00");
    await monday.getByRole("group", { name: "החלטה על הבקשה" }).getByRole("button", { name: "אישור הבקשה" }).click();
    await expect.poll(() => sb.rpc.get("decide_payments")?.length ?? 0).toBe(4);
    expect(sb.rpc.get("decide_payments")![3]).toEqual({ p_lessons: [lessonAt(1, 510)], p_versions: [1], p_decision: "approved", p_note: null });

    // Wednesday's approved one: the driver's half only — name, phone, «סודר»
    await page.getByRole("button", { name: "יום רביעי: הסעה אחת" }).click();
    const wednesday = boardRow(page, lessonAt(3, 600));
    await wednesday.getByRole("button", { name: /^עריכת הנהג\/ת/ }).click();
    await wednesday.getByLabel("שם הנהג/ת").fill("נהג/ת לדוגמה");
    await wednesday.getByLabel("טלפון הנהג/ת").fill("123 456 789");
    await wednesday.getByRole("checkbox", { name: "סודר" }).check();
    await wednesday.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_driver")?.length ?? 0).toBe(1);
    expect(sb.rpc.get("set_transport_driver")![0]).toEqual({ p_lesson: lessonAt(3, 600), p_fields: { driver_name: "נהג/ת לדוגמה", driver_phone: "123 456 789", arranged: true } });
    // Sunday's, arranged already: a new name alone is all that goes
    await page.getByRole("button", { name: "יום ראשון: הסעה אחת" }).click();
    const sunday = boardRow(page, lessonAt(0, 510));
    await sunday.getByRole("button", { name: /^עריכת הנהג\/ת/ }).click();
    await sunday.getByLabel("שם הנהג/ת").fill("נהג/ת אחר/ת לדוגמה");
    await sunday.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_driver")?.length ?? 0).toBe(2);
    expect(sb.rpc.get("set_transport_driver")![1]).toEqual({ p_lesson: lessonAt(0, 510), p_fields: { driver_name: "נהג/ת אחר/ת לדוגמה" } });

    tokens(sb, session.access_token, ["decide_payments", "set_transport_driver", "get_transports_for", "load_rota"]);
    // the pickup is the handler's: never written from these pages, nor through the old screens' whole-details call
    for (const fn of ["set_transport_request", "set_transport_details", "set_payment"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });

  test("logistics: the same two calls with their own token — never set_transport_request, set_transport_details or the vetting", async ({ page }, info) => {
    desktopOnly(info);
    const { sb, session } = await signedIn(page, { email: "logistics@example.org", role: "logistics", global: false, member: 5 });
    await page.goto(mockUrl());
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/logistics$`)); // their home (phase 4)
    await expectSections(page, LOGISTICS_SECTIONS, INLINE_SECTIONS); // «מצגות» since the reset's phase 5; below 1024px the row's four and «עוד»
    await expect(badge(page)).toHaveAccessibleName("אישורים, 2 ממתינים"); // the two requests: no vetting is counted
    await badge(page).click();
    await expect(page.locator("#vetting")).toHaveCount(0);
    await requestsList(page).getByRole("button", { name: "אישור הבקשה של מרצה 07" }).click();
    await expect.poll(() => sb.rpc.get("decide_payments")).toEqual([{ p_lessons: [lessonAt(0, 870)], p_versions: [1], p_decision: "approved", p_note: null }]);

    await nav(page).getByRole("link", { name: "בית", exact: true }).click();
    await expect(page).toHaveURL(/\/logistics$/);
    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "הסעות וצוות" }).click();
    await expect(page).toHaveURL(/\/logistics\/transports$/);
    await page.getByRole("button", { name: "יום רביעי: הסעה אחת" }).click();
    const wednesday = boardRow(page, lessonAt(3, 600));
    await wednesday.getByRole("button", { name: /^עריכת הנהג\/ת/ }).click();
    await wednesday.getByRole("checkbox", { name: "סודר" }).check();
    await wednesday.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_driver")).toEqual([{ p_lesson: lessonAt(3, 600), p_fields: { arranged: true } }]);

    // the lesson page: what was asked, read-only — no request form to send a pickup with, no driver before the approval
    sb.answers.set("get_transport_details", { pickup_address: "כתובת לדוגמה", pickup_time: "08:00", driver_name: null, driver_phone: null, arranged: false });
    await page.goto(`${mockUrl()}/lesson/${lessonAt(1, 510)}?step=pay`);
    let pay = page.locator('[data-page-step="pay"]');
    await expect(pay.getByRole("group", { name: "החלטה על הבקשה" })).toBeVisible();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await expect(pay.getByLabel("כתובת איסוף")).toHaveCount(0);
    await expect(pay.getByRole("group", { name: "פרטי ההסעה" })).toContainText("את הנהג/ת קובעים אחרי האישור.");
    await expect(pay.getByRole("button", { name: /^עריכת/ })).toHaveCount(0);
    // an approved one: the driver's half through set_transport_driver, only the keys that changed
    await page.goto(`${mockUrl()}/lesson/${lessonAt(3, 600)}?step=pay`);
    pay = page.locator('[data-page-step="pay"]');
    await pay.getByRole("group", { name: "פרטי ההסעה" }).getByRole("button", { name: "עריכת הנהג/ת" }).click();
    await pay.getByLabel("שם הנהג/ת").fill("נהג/ת לדוגמה");
    await pay.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_driver")?.length ?? 0).toBe(2);
    expect(sb.rpc.get("set_transport_driver")![1]).toEqual({ p_lesson: lessonAt(3, 600), p_fields: { driver_name: "נהג/ת לדוגמה" } });

    tokens(sb, session.access_token, ["decide_payments", "set_transport_driver", "get_transports_for", "get_transport_details"]);
    for (const fn of ["set_transport_request", "set_transport_details", "set_payment", "vet_speakers"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });

  test("v20 on the wire: the driver's suggestions — a staff pick fills the name, a cohort pick the cohort and its contact (the phone read through get_rota_contacts on that click alone); saved through set_transport_driver, nothing else new", async ({ page }, info) => {
    desktopOnly(info);
    const { sb, session } = await signedIn(page, { email: "logistics@example.org", role: "logistics", global: false, member: 5 });
    const wed = lessonAt(3, 600);
    sb.answers.set("get_transports_for", [
      { lesson_id: wed, pickup_address: "כתובת לדוגמה", pickup_time: "08:45", driver_name: null, driver_phone: null, arranged: false, approval: "approved", pickup_min: 525 },
    ] satisfies LessonTransport[]);
    sb.answers.set("load_rota", suggestRota());
    sb.answers.set("get_rota_contacts", [
      { group_id: 11, head_phone: "000-000-0011" },
      { cohort_id: 2, phone: "000-000-0077" },
    ]);
    await page.goto(`${mockUrl()}/logistics/transports?day=3`);
    const row = boardRow(page, wed);
    await expect(row.locator("[data-pickup]")).toHaveText("08:45");
    await row.getByRole("button", { name: /^עריכת הנהג\/ת/ }).click();
    const form = row.getByRole("form", { name: /^עריכת הנהג\/ת/ });
    const suggestions = form.locator("[data-driver-suggestions]");
    // on shift during the trip (08:45 to 10:00): the logistics member — not the afternoon's; the cohort that can drive and is
    // on campus that morning — not «ג» (another day), not «א» (cannot drive)
    await expect(suggestions.locator("[data-suggest-staff]")).toHaveText([/^לוגיסטיקה \(הדגמה\)\s*08:30–14:30$/]);
    await expect(suggestions.locator("[data-suggest-cohort]")).toHaveText(["צוות מכינה לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב"]);
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined(); // nothing read before a pick
    await suggestions.locator("[data-suggest-staff]").click();
    await expect(form.getByLabel("שם הנהג/ת")).toHaveValue("לוגיסטיקה (הדגמה)");
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined(); // a staff pick reads nothing
    await suggestions.locator("[data-suggest-cohort]").click();
    await expect(form.getByLabel("טלפון הנהג/ת")).toHaveValue("000-000-0077");
    await expect(form.getByLabel("שם הנהג/ת")).toHaveValue("צוות מכינה לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב");
    await expect(suggestions.getByRole("status")).toHaveText("מולאו השם והטלפון של איש/אשת הקשר של מכינה לדוגמה ב.");
    expect(sb.rpc.get("get_rota_contacts")).toEqual([{ p_edition: 7 }]); // on that click, once
    // the review: a staff pick after it empties the phone — the contact's number never stays beside another name
    await suggestions.locator("[data-suggest-staff]").click();
    await expect(form.getByLabel("שם הנהג/ת")).toHaveValue("לוגיסטיקה (הדגמה)");
    await expect(form.getByLabel("טלפון הנהג/ת")).toHaveValue("");
    await expect(suggestions.getByRole("status")).toHaveText("מולא שם הנהג/ת: לוגיסטיקה (הדגמה). את הטלפון מקלידים.");
    // and back to the cohort: its contact's phone again, read on that click
    await suggestions.locator("[data-suggest-cohort]").click();
    await expect(form.getByLabel("טלפון הנהג/ת")).toHaveValue("000-000-0077");
    expect(sb.rpc.get("get_rota_contacts")).toHaveLength(2);
    expect(sb.rpc.get("set_transport_driver")).toBeUndefined(); // a pick only fills the fields
    await form.getByRole("checkbox", { name: "סודר" }).check();
    const before = new Set(sb.rpc.keys());
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "פרטי הנהג/ת נשמרו")).toBeVisible();
    expect(sb.rpc.get("set_transport_driver")).toEqual([
      { p_lesson: wed, p_fields: { driver_name: "צוות מכינה לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב", driver_phone: "000-000-0077", arranged: true } },
    ]);
    // nothing else new: no table written, no link to a shift or a cohort stored; the phone not read again
    await page.waitForLoadState("networkidle");
    expect([...sb.rpc.keys()].filter((k) => !before.has(k))).toEqual(["set_transport_driver"]);
    expect(sb.writes).toEqual([]);
    expect(sb.rpc.get("get_rota_contacts")).toHaveLength(2);
    tokens(sb, session.access_token, ["get_rota_contacts", "set_transport_driver", "load_rota", "get_transports_for"]);
  });

  test("the review: a staff pick on an arranged transport whose driver has a phone — the new name is saved with no phone, never the one before", async ({ page }, info) => {
    desktopOnly(info);
    const { sb } = await signedIn(page, { email: "logistics@example.org", role: "logistics", global: false, member: 5 });
    const wed = lessonAt(3, 600);
    sb.answers.set("get_transports_for", [
      { lesson_id: wed, pickup_address: "כתובת לדוגמה", pickup_time: "08:45", driver_name: "נהג/ת לדוגמה א", driver_phone: "000-000-0001", arranged: true, approval: "approved", pickup_min: 525 },
    ] satisfies LessonTransport[]);
    sb.answers.set("load_rota", suggestRota());
    await page.goto(`${mockUrl()}/logistics/transports?day=3`);
    const row = boardRow(page, wed);
    await row.getByRole("button", { name: /^עריכת הנהג\/ת/ }).click();
    const form = row.getByRole("form", { name: /^עריכת הנהג\/ת/ });
    await expect(form.getByLabel("טלפון הנהג/ת")).toHaveValue("000-000-0001");
    await form.locator("[data-driver-suggestions] [data-suggest-staff]").click();
    await expect(form.getByLabel("שם הנהג/ת")).toHaveValue("לוגיסטיקה (הדגמה)");
    await expect(form.getByLabel("טלפון הנהג/ת")).toHaveValue("");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_driver")?.length ?? 0).toBe(1);
    expect(sb.rpc.get("set_transport_driver")![0]).toEqual({ p_lesson: wed, p_fields: { driver_name: "לוגיסטיקה (הדגמה)", driver_phone: null } });
  });

  test("the board when its one transports read fails: it says so, and never what only that read can say — then reads again", async ({ page }, info) => {
    desktopOnly(info);
    const { sb } = await signedIn(page, { email: "logistics@example.org", role: "logistics", global: false, member: 5 });
    sb.answers.delete("get_transports_for"); // the fake answers 404: the read is refused
    await page.goto(`${mockUrl()}/logistics/transports?day=0`);
    await expect(page.getByRole("alert").filter({ hasText: "לא הצלחנו לטעון את פרטי ההסעות." })).toBeVisible();
    await expect(counts(page)).toHaveText("ממתינות לאישור 1 · אושרו 2"); // no «סודרו 0»: unknown
    const sunday = boardRow(page, lessonAt(0, 510));
    await expect(sunday.getByText("אושר", { exact: true })).toBeVisible();
    await expect(sunday).not.toContainText("עוד לא סודר");
    await expect(sunday.locator("[data-pickup]")).toHaveText("לא נטען"); // never «טוען…» for ever
    sb.answers.set("get_transports_for", transportsOf());
    await page.getByRole("alert").getByRole("button", { name: "לנסות שוב" }).click();
    await expect(counts(page)).toHaveText("ממתינות לאישור 1 · אושרו 2 · סודרו 1");
    await expect(sunday).toHaveAttribute("data-state", "arranged");
    await expect(sunday.locator("[data-pickup]")).toHaveText("07:15");
  });

  test("a decision someone else made first: refused as stale — one line says so, the week and the pickups are read again, and the next try goes at the new version", async ({ page }, info) => {
    desktopOnly(info);
    const { sb } = await signedIn(page, { email: "logistics@example.org", role: "logistics", global: false, member: 5 });
    // meanwhile the handler changed Monday's request: the database holds version 2
    const changed = realWeek();
    Object.assign(changed.lessons.find((l) => l.id === lessonAt(1, 510))!, { version: 2, pay_amount: 250 });
    let refused = false;
    await page.route("**/rest/v1/rpc/decide_payments", async (route) => {
      if (refused) return route.fallback();
      refused = true;
      sb.answers.set("load_week", changed);
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "stale", details: null, hint: null }) });
    });
    await page.goto(`${mockUrl()}/approvals`);
    await expect(request(page, "מרצה 04")).toContainText("200 ₪");
    const reads = { week: sb.count("/rest/v1/rpc/load_week"), transports: sb.count("/rest/v1/rpc/get_transports_for") };
    await requestsList(page).getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "מישהו אחר עדכן את זה הרגע. הנתונים נטענו מחדש — אפשר לנסות שוב." })).toBeVisible();
    await expect(page.getByText("stale")).toHaveCount(0);
    await expect(request(page, "מרצה 04")).toContainText("250 ₪"); // the request as it now stands
    expect(sb.count("/rest/v1/rpc/load_week")).toBeGreaterThan(reads.week);
    await expect.poll(() => sb.count("/rest/v1/rpc/get_transports_for")).toBeGreaterThan(reads.transports); // its pickup read again
    await focusKept(page);
    await requestsList(page).getByRole("button", { name: "אישור הבקשה של פרופ׳ מרצה 04" }).click();
    // (the refused call was answered above: the fake database records the second one alone)
    await expect.poll(() => sb.rpc.get("decide_payments")).toEqual([{ p_lessons: [lessonAt(1, 510)], p_versions: [2], p_decision: "approved", p_note: null }]);
  });

  test("an edition's admin decides the requests, and only reads how many wait for the instructor's vetting; the badge counts the requests", async ({ page }, info) => {
    desktopOnly(info);
    const { sb } = await signedIn(page, { email: "staff@example.org", role: "admin", global: false, member: 1 });
    await page.goto(`${mockUrl()}/approvals`);
    await expect(badge(page)).toHaveAccessibleName("אישורים, 2 ממתינים"); // the two requests — not the speaker who agreed
    await expect(requestsList(page).locator("[data-request-row]")).toHaveCount(2);
    await expect(requestsList(page).getByRole("button", { name: "אישור הבקשה של מרצה 07" })).toBeVisible();
    await expect(page.locator("#vetting")).toHaveCount(0);
    await expect(page.locator("[data-vetting-count]")).toHaveText("מרצה אחד/ת שהסכים/ה מחכה לאישור המדריך/ה.");
    await expect(page.getByRole("button", { name: /^אישור מרצה/ })).toHaveCount(0);
    expect(sb.rpc.get("vet_speakers")).toBeUndefined();
  });

  test("a trainee never sees «אישורים»: not in the header, its address lands home, nothing read for it", async ({ page }, info) => {
    desktopOnly(info);
    const { sb } = await signedIn(page, { email: "trainee@example.org", role: "content", global: false, member: 2 });
    await page.goto(`${mockUrl()}/approvals`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/$`));
    await expect(nav(page).getByRole("link")).toHaveText(["היום שלי", "מרצים", "השבוע", "עזרה"]);
    await page.goto(`${mockUrl()}/logistics/transports`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/$`));
    for (const fn of ["get_transports_for", "decide_payments", "set_transport_driver"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });
});
