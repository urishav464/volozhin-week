// The grid in a real browser, on the demo build (the same engine production
// semantics run on — docs/CONTRACT.md). Desktop drags with a mouse; phone and
// tablet tap. These are the decision gate's tasks. The reset, phase 3: no pool
// and no placing mode — a speaker is proposed from a cell's chooser or from
// their page (/speakers/:id, «איפה אפשר לשבץ»), and what they said about a slot
// is the chooser's word beside them; a lesson still moves by drag.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { noSidewaysScroll } from "./helpers";
import { LRM } from "../../src/domain/time";

const demoUrl = () => process.env.E2E_DEMO_URL!;

/** Press on `from` and carry it over `to` — still held, so the grid can be read mid-drag. */
async function carry(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
}

async function drag(page: Page, from: Locator, to: Locator) {
  await carry(page, from, to);
  await page.mouse.up();
}

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });

const cell = (page: Page, day: number, start: number, end: number) => page.locator(`[data-drop="cell:${day}:${start}:${end}"]`);

/** A free cell's panel, its chooser searched for one speaker. */
async function chooser(page: Page, c: Locator, name: string) {
  await c.click();
  const dialog = page.getByRole("dialog", { name: "משבצת פנויה" });
  await dialog.getByLabel("חיפוש מרצה למשבצת").fill(name);
  return dialog;
}

/** The speaker's page, «איפה אפשר לשבץ»: a day's fold opened, «להציע כאן» on one slot. */
async function placeFromPage(page: Page, speakerId: number, day: number, start: number) {
  await page.goto(`${demoUrl()}/speakers/${speakerId}#placement`);
  const d = page.locator(`#placement [data-place-day="${day}"]`);
  const option = d.locator(`[data-place-option="${day}:${start}"]`);
  if (!(await option.isVisible())) await d.locator("summary").click();
  await option.getByRole("button", { name: "להציע כאן" }).click();
  await expect(toast(page, /הוצע\S* למשבצת/)).toBeVisible();
}

test.describe("desktop", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "mouse grid only");
    await page.goto(demoUrl());
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();
  });

  test("a free cell's chooser proposes a speaker; «ביטול» takes it back (the pool's drag went with the pool)", async ({ page }) => {
    const target = cell(page, 4, 510, 600);
    const dialog = await chooser(page, target, "מרצה 41");
    await dialog.locator('[data-chooser-speaker="41"]').getByRole("button", { name: "הצע", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "סומן/ה למשבצת" })).toBeVisible();
    const card = page.locator('[data-day="4"] [data-lesson-id]').filter({ hasText: "מרצה 41" });
    await expect(card).toBeVisible();
    await page.getByRole("status").getByRole("button", { name: "ביטול" }).click();
    await expect(card).toHaveCount(0);
    await expect(target).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("a speaker's page places without dragging (the grid's placing mode went with the pool): the week shows the draft in its cell", async ({ page }) => {
    await placeFromPage(page, 42, 4, 600);
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await expect(page.locator('[data-day="4"] [data-lesson-id]').filter({ hasText: "מרצה 42" })).toHaveAttribute("aria-label", /^טיוטה .*10:00–11:30/);
  });

  test("the day's need counts its CLOSED lessons, said once in its header: a woman proposed changes nothing; she agrees on the call, the lesson closes, and it does (v14; the reset, phase 2)", async ({ page }) => {
    // the reset, phase 2: no free cell is tinted or carries the need — the day's header says it, once
    const need = page.locator('[data-day-header="3"] [data-need]');
    await expect(need).toHaveAttribute("data-need", "even"); // Wednesday: one woman and one man closed
    await expect(page.locator("[data-drop][data-need], [data-free-cell][data-need]")).toHaveCount(0);
    const free = await chooser(page, cell(page, 3, 1200, 1290), "מרצה 42");
    await free.locator('[data-chooser-speaker="42"]').getByRole("button", { name: "הצע", exact: true }).click();
    await expect(page.locator('[data-day="3"] [data-lesson-id]').filter({ hasText: "מרצה 42" })).toBeVisible();
    await expect(need).toHaveAttribute("data-need", "even"); // a candidate is not a lesson
    // the panel is the new draft's: the candidate, where the call begins
    const card = page.getByRole("dialog", { name: "משבצת בתהליך" }).locator("[data-pitch-id]").filter({ hasText: "מרצה 42" });
    await expect(card).toContainText("לפני שיחה"); // placed is not called
    await card.getByRole("group", { name: "תוצאת השיחה" }).getByRole("button", { name: "הסכימה", exact: true }).click();
    await expect(toast(page, "עודכן: ד״ר מרצה 42 · הסכימה")).toBeVisible();
    await card.getByRole("button", { name: "המרצה אישרה את השעה — סגירה" }).click();
    await expect(toast(page, "השיעור נסגר")).toBeVisible();
    await expect(page.getByRole("button", { name: /ד״ר מרצה 42 — /, exact: false })).toBeVisible();
    await expect(need).toHaveAttribute("data-need", "m"); // two women closed, one man
  });

  test("a cell's chooser says what a speaker said about that slot (v14): «זמין/ה» where they can, nothing where nothing was said", async ({ page }) => {
    // speaker 30 said «יכולה» on Tuesday from 20:00 through the night (the grid's drag colouring went with the pool)
    let dialog = await chooser(page, cell(page, 2, 1350, 1440), "מרצה 30");
    const row = dialog.locator('[data-chooser-speaker="30"]');
    await expect(row).toContainText("זמין/ה");
    await expect(row).toContainText("בטיפול: חניך/ה ב׳"); // someone else's: offered to them
    await expect(row.getByRole("button", { name: "הצע לחניך/ה ב׳" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // Wednesday 22:30: nothing said — offered, and no word about it
    dialog = await chooser(page, cell(page, 3, 1350, 1440), "מרצה 30");
    await expect(dialog.locator('[data-chooser-speaker="30"]')).toBeVisible();
    await expect(dialog.locator('[data-chooser-speaker="30"]')).not.toContainText("זמין/ה");
    await expect(dialog.locator('[data-chooser-speaker="30"]')).not.toContainText("שלא");
  });

  test("splitting a row into two parallel lessons needs a reason", async ({ page }) => {
    await cell(page, 4, 870, 960).click();
    const dialog = page.getByRole("dialog", { name: "משבצת פנויה" });
    await dialog.getByText("מבנה המשבצת").click();
    await dialog.getByText("פיצול למקבילים").click();
    await expect(dialog.getByRole("button", { name: "2 מקבילים" })).toBeDisabled();
    await dialog.getByLabel("סיבה לפיצול").fill("שני מסלולים");
    await dialog.getByRole("button", { name: "2 מקבילים" }).click();
    await expect(page.locator('[data-day="4"] [data-lesson-id]').filter({ hasText: "מקביל" })).toHaveCount(2);
  });

  test("any minutes split a row in time; «איחוד» builds the night", async ({ page }) => {
    await cell(page, 4, 960, 1050).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("מבנה המשבצת").click();
    await dialog.getByText("פיצול בזמן").click();
    await dialog.getByLabel("דקות בחלק 1").fill("65");
    await expect(dialog.getByLabel("דקות בחלק 2")).toHaveText("25");
    await dialog.getByLabel("דקות בחלק 1").fill("80");
    await expect(dialog.getByRole("button", { name: "פיצול ל-2 חלקים" })).toBeDisabled(); // 10 minutes left
    await dialog.getByLabel("דקות בחלק 1").fill("60");
    await dialog.getByRole("button", { name: "פיצול ל-2 חלקים" }).click();
    await expect(page.locator('[data-day="4"] [aria-label*="16:00–17:00"]')).toBeVisible();
    await expect(page.locator('[data-day="4"] [aria-label*="17:00–17:30"]')).toBeVisible();

    await cell(page, 3, 1470, 1560).click();
    await page.getByRole("dialog").getByText("מבנה המשבצת").click();
    await page.getByRole("dialog").getByRole("button", { name: "איחוד עם המשבצת הבאה" }).click();
    await expect(page.locator('[data-day="3"] [aria-label*="00:30–03:30"]')).toBeVisible();
  });

  test("a merged cell split in two is two lessons of its whole length — not three (v13)", async ({ page }) => {
    await cell(page, 3, 1470, 1560).click();
    await page.getByRole("dialog").getByText("מבנה המשבצת").click();
    await page.getByRole("dialog").getByRole("button", { name: "איחוד עם המשבצת הבאה" }).click();
    const merged = page.locator('[data-day="3"] [data-lesson-id][aria-label*="00:30–03:30"]');
    await merged.click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("מבנה המשבצת").click();
    await expect(dialog.getByText("משבצת מאוחדת")).toBeVisible();
    await dialog.getByText("פיצול למקבילים").click();
    await dialog.getByLabel("סיבה לפיצול").fill("שני מסלולים");
    await dialog.getByRole("button", { name: "2 מקבילים" }).click();
    await expect(merged).toHaveCount(2);
    await expect(page.locator('[data-day="3"] [data-lesson-id][aria-label*="00:30–02:00"]')).toHaveCount(0);
  });

  test("a closed lesson moves by drag", async ({ page }) => {
    const card = page.locator('[data-day="4"] [data-lesson-id]').filter({ hasText: "מרצה 24" });
    await drag(page, card, cell(page, 4, 870, 960));
    await expect(page.getByRole("status").filter({ hasText: "השיעור הוזז" })).toBeVisible();
    await expect(page.locator('[data-day="4"] [aria-label*="14:30–16:00"]').filter({ hasText: "מרצה 24" })).toBeVisible();
  });

  test("the warnings drawer lists what needs a second look", async ({ page }) => {
    await page.getByRole("button", { name: /אזהרות/ }).click();
    const dialog = page.getByRole("dialog", { name: "אזהרות" });
    await expect(dialog.getByText("שני שיעורי «תנ\"ך» ברצף בשלישי")).toBeVisible();
    await expect(dialog.getByText("3 שיעורי «מחשבת ישראל» ברצף בראשון")).toHaveCount(1);
    await expect(dialog.getByText(/סירב השנה/)).toBeVisible();
    await dialog.getByText("לידיעה", { exact: true }).click(); // what is only to know waits in a fold at the end
    await expect(dialog.getByText(/במקביל/)).toBeVisible();
  });
});

test.describe("phone and tablet", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "day view only");
    await page.goto(demoUrl());
    await expect(page.getByRole("tablist", { name: "ימים" })).toBeVisible();
  });

  test("switch days and propose a speaker by tapping a free cell", async ({ page }) => {
    await page.getByRole("tab", { name: "רביעי" }).click();
    await cell(page, 3, 1200, 1290).click();
    const sheet = page.getByRole("dialog", { name: "משבצת פנויה" });
    await sheet.getByLabel("חיפוש מרצה למשבצת").fill("מרצה 42");
    await sheet.getByRole("button", { name: "הצע", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "סומן/ה למשבצת" })).toBeVisible();
    await expect(page.locator("[data-lesson-id]").filter({ hasText: "מרצה 42" })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("no pool tab: a speaker's page proposes a slot, and the day view shows the new draft there", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: "ניווט" }).getByRole("button", { name: "מאגר" })).toHaveCount(0);
    await placeFromPage(page, 43, 4, 510);
    await nav(page).getByRole("link", { name: "השבוע" }).click();
    await page.getByRole("tab", { name: "חמישי" }).click();
    await expect(page.locator("[data-lesson-id]").filter({ hasText: "מרצה 43" })).toHaveAttribute("aria-label", /^טיוטה .*08:30–10:00/);
    await noSidewaysScroll(page);
  });

  test("the night merge reads as one lesson with its continuation", async ({ page }) => {
    await page.getByRole("tab", { name: "שני" }).click();
    await expect(page.getByText("המשך השיעור").first()).toBeVisible();
    await noSidewaysScroll(page);
  });
});

// v14: the call first — the candidate card at every width
test.describe("the call on the card (v14)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoUrl());
    await expect(page.locator("[data-day-header]").first()).toBeVisible();
  });

  const day = async (page: Page, name: string) => {
    if (await page.getByRole("tab", { name }).isVisible()) await page.getByRole("tab", { name }).click();
  };

  test("the points to say, in the speaker's gender with the caller's name; each result is recorded, the current one not offered", async ({ page }) => {
    // Sunday 16:00: two speakers talked to, waiting for an answer
    await page.locator('[data-day="0"] [data-lesson-id]').filter({ hasText: "מרצה 09" }).click();
    const card = page.getByRole("dialog", { name: "משבצת בתהליך" }).locator("[data-pitch-id]").filter({ hasText: "ד״ר מרצה 09" });
    await expect(card).toContainText("שוחחנו, מחכים לתשובה");
    await expect(card.locator("[data-call-points]")).toBeHidden(); // folded
    await card.getByText("נקודות לשיחה", { exact: true }).click();
    const points = card.locator("[data-call-points]");
    await expect(points).toContainText("*אני מדריך/ה (הדגמה) מהמדרשה הגבוהה בעין פרת");
    await expect(points).toContainText("*נשמח שתגיע ללמד שעה ורבע, תסכים?");
    const results = card.getByRole("group", { name: "תוצאת השיחה" });
    await expect(results.getByRole("button", { name: "שוחחנו, מחכים לתשובה" })).toHaveCount(0);
    await results.getByLabel("מה נאמר בשיחה").fill("נתון לדוגמה: לחזור אחרי שבת");
    await results.getByRole("button", { name: "לא ענה", exact: true }).click();
    await expect(toast(page, "עודכן: ד״ר מרצה 09 · לא ענה")).toBeVisible();
    await expect(card).toContainText("לא ענה");
    await expect(results.getByRole("button", { name: "שוחחנו, מחכים לתשובה" })).toBeVisible();
    await expect(results.getByRole("button", { name: "לא ענה", exact: true })).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("agreed and waiting for the instructor: «אישור» on the card, then the closing", async ({ page }) => {
    await day(page, "שלישי");
    await page.locator('[data-day="2"] [data-lesson-id]').filter({ hasText: "מרצה 56" }).click();
    const card = page.getByRole("dialog", { name: "משבצת בתהליך" }).locator("[data-pitch-id]").filter({ hasText: "מרצה 56" });
    await expect(card).toContainText("הסכימה");
    await expect(card).toContainText("ממתינה לאישור המדריך/ה");
    await expect(card.getByRole("button", { name: /את השעה — סגירה/ })).toHaveCount(0);
    await card.getByRole("button", { name: "אישור", exact: true }).click();
    await expect(toast(page, "מרצה 56 אושרה")).toBeVisible();
    await expect(card.getByRole("button", { name: "המרצה אישרה את השעה — סגירה" })).toBeFocused(); // the focus moves on with the card
    await card.getByRole("button", { name: "המרצה אישרה את השעה — סגירה" }).click();
    await expect(toast(page, "השיעור נסגר")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "שיעור סגור" })).toBeVisible();
  });

  test("«סירבה» frees the slot — the chooser first, who declined folded — and «החזרה לתהליך» brings her back", async ({ page }) => {
    await day(page, "רביעי");
    await cell(page, 3, 1200, 1290).click();
    const free = page.getByRole("dialog", { name: "משבצת פנויה" });
    await free.getByLabel("חיפוש מרצה למשבצת").fill("מרצה 42");
    await free.getByRole("button", { name: "הצע", exact: true }).click();
    const card = page.getByRole("dialog", { name: "משבצת בתהליך" }).locator("[data-pitch-id]").filter({ hasText: "מרצה 42" });
    await card.getByRole("group", { name: "תוצאת השיחה" }).getByRole("button", { name: "סירבה", exact: true }).click();
    await expect(toast(page, "עודכן: ד״ר מרצה 42 · סירבה")).toBeVisible();
    await expect(free.getByLabel("חיפוש מרצה למשבצת")).toBeFocused();
    await expect(page.locator('[data-day="3"] [data-lesson-id]').filter({ hasText: "פנוי" })).toHaveAttribute("aria-label", /, פנוי$/);
    await free.getByText("סירבו כאן").click();
    const declined = free.locator("[data-pitch-id]").filter({ hasText: "מרצה 42" });
    await expect(declined).toContainText("סירבה");
    await declined.getByRole("button", { name: "החזרה לתהליך" }).click();
    await expect(toast(page, "ד״ר מרצה 42 חזרה לתהליך")).toBeVisible();
    await expect(card).toContainText("לפני שיחה");
    await noSidewaysScroll(page);
  });
});

// v13: the grid rethought — every width
test.describe("reading the grid (v13)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoUrl());
    await expect(page.locator("[data-day-header]").first()).toBeVisible();
  });

  test("a day header opens the day: its women and men against the tolerance, its topics, its hours", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^(הסתרת|הצגת) הלילה$/ })).toHaveCount(0); // the night is always shown
    await expect(page.locator("[data-week-balance]")).toContainText("2 ימים לא מאוזנים");
    // the topics axis in the day's header (the phone's too), and the topics × days table:
    // behind «לפי ימים» on a wide screen, inside the folded legend on a phone
    await expect(page.locator('[data-day-header="0"] [data-topic-axis="thin"]')).toHaveCount(1);
    const byDays = page.getByRole("button", { name: "לפי ימים", exact: true });
    if (await byDays.isVisible()) await byDays.click();
    else await page.getByText("מקרא הנושאים", { exact: true }).click();
    await expect(page.getByRole("table", { name: "הנושאים לפי ימים" }).getByRole("row", { name: /מחשבת ישראל/ })).toContainText("3");
    await page.locator('[data-day-header="0"]').first().click();
    const panel = page.getByRole("dialog", { name: "יום ראשון" });
    await expect(panel.locator("[data-day-balance]")).toContainText("לא מאוזן — הפרש של 3 בסגורים");
    await expect(panel.locator('[data-topic-axis="large"]')).toBeVisible();
    await expect(panel.getByRole("list", { name: "הנושאים של היום" })).toContainText("מחשבת ישראל · 3");
    await panel.getByText("עוד אין ביום הזה").click();
    await expect(panel.getByRole("list", { name: "נושאים שעוד אין ביום הזה" })).toBeVisible();
    await panel.getByText("השעות", { exact: true }).click();
    await expect(panel.getByRole("list", { name: "השעות של יום ראשון" })).toContainText("פתיחת השבוע (לדוגמה)");
    await expect(panel.getByRole("list", { name: "השעות של יום ראשון" })).toContainText("בתהליך:");
    // the instructor sets the tolerance there; Sunday's 1 to 4 is within 3
    await panel.getByText("כללי הרשת").click();
    await panel.getByLabel("הפרש מותר ביום בין מרצות למרצים").fill("3");
    await panel.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "כללי הרשת נשמרו" })).toBeVisible();
    await expect(panel.locator("[data-day-balance]")).toContainText("מאוזן בסגורים");
    await expect(page.locator("[data-week-balance]")).not.toContainText("לא מאוזן");
    await noSidewaysScroll(page);
  });

  test("an unbalanced day's warning opens the day", async ({ page }) => {
    await page.getByRole("button", { name: /^אזהרות/ }).first().click();
    await page.getByRole("dialog", { name: "אזהרות" }).getByRole("button", { name: /שלישי לא מאוזן: נסגרו 1 מרצות ו-3 מרצים/ }).click();
    await expect(page.getByRole("dialog", { name: "יום שלישי" })).toBeVisible();
  });

  test("a closed card names its topic; «אחריות» colours each handler's lessons, drafts too, and «רק של X» fades the rest", async ({ page }) => {
    if (await page.getByRole("tab", { name: "שלישי" }).isVisible()) await page.getByRole("tab", { name: "שלישי" }).click();
    await expect(page.locator('[data-day="2"] [data-lesson-id]').filter({ hasText: "מרצה 21" }).locator("[data-category]")).toHaveText('תנ"ך');
    await page.getByRole("radio", { name: "אחריות" }).click();
    const legend = page.getByRole("group", { name: "מקרא האחריות" });
    await legend.getByRole("button", { name: "חניך/ה א׳" }).click();
    await expect(legend.getByRole("button", { name: "רק של חניך/ה א׳" })).toHaveAttribute("aria-pressed", "true");
    const mine = page.locator('[data-lesson-id][data-owner="2"]');
    const others = page.locator('[data-lesson-id][data-owner]:not([data-owner="2"])');
    await expect(mine.first()).not.toHaveClass(/opacity-30/);
    await expect(others.first()).toHaveClass(/opacity-30/);
    await legend.getByRole("button", { name: "כולם" }).click();
    await expect(others.first()).not.toHaveClass(/opacity-30/);
  });

  test("both memorial rows hold the same «זמן זיכרון», and an admin adds one from the grid", async ({ page }) => {
    await expect(page.locator('[data-day="0"] [data-memorial-card]')).toHaveCount(2); // before lunch and after it
    // free Sunday's afternoon row (on «זמני זיכרון»), then take it back from the grid
    await page.goto(`${demoUrl()}/memorial`);
    const sunday = page.getByRole("region", { name: "יום ראשון" });
    await sunday.locator("li").filter({ hasText: "14:15–14:30" }).getByRole("button", { name: "הסרת המשבצת" }).click();
    await page.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(page.getByRole("status").filter({ hasText: "זמן הזיכרון הוסר" })).toBeVisible();
    await page.getByRole("navigation").getByRole("link", { name: "השבוע" }).first().click();
    if (await page.getByRole("tab", { name: "ראשון" }).isVisible()) await page.getByRole("tab", { name: "ראשון" }).click();
    await expect(page.locator('[data-day="0"] [data-memorial-card]')).toHaveCount(1);
    await page.getByRole("button", { name: `הוספת זמן זיכרון: ראשון ${LRM}14:15–14:30` }).click();
    await expect(page.getByRole("status").filter({ hasText: "זמן הזיכרון נוסף" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "זמן זיכרון" })).toBeVisible();
    await expect(page.locator('[data-day="0"] [data-memorial-card]')).toHaveCount(2);
  });
});
