// The grid in a real browser, on the demo build (the same engine production
// semantics run on — docs/CONTRACT.md). Desktop drags with a mouse; phone and
// tablet tap. These are the decision gate's tasks.
import { expect, type Locator, type Page, test } from "@playwright/test";

const demoUrl = () => process.env.E2E_DEMO_URL!;

async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  await to.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function noSidewaysScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
}

const cell = (page: Page, day: number, start: number, end: number) => page.locator(`[data-drop="cell:${day}:${start}:${end}"]`);
const speaker = (page: Page, id: number) => page.locator(`[data-speaker-id="${id}"]`);

test.describe("desktop", () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "mouse grid only");
    await page.goto(demoUrl());
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();
  });

  test("dragging a speaker onto a free cell proposes them; «ביטול» takes it back", async ({ page }) => {
    const target = cell(page, 4, 510, 600);
    await drag(page, speaker(page, 41), target);
    await expect(page.getByRole("status").filter({ hasText: "סומן/ה למשבצת" })).toBeVisible();
    const card = page.locator('[data-day="4"] [data-lesson-id]').filter({ hasText: "מרצה 41" });
    await expect(card).toBeVisible();
    await page.getByRole("status").getByRole("button", { name: "ביטול" }).click();
    await expect(card).toHaveCount(0);
    await expect(target).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("«שבץ» then a cell places without dragging", async ({ page }) => {
    await speaker(page, 42).getByRole("button", { name: "שבץ" }).click();
    await expect(page.getByRole("status").filter({ hasText: "משבצים את" })).toBeVisible();
    await cell(page, 4, 600, 690).click();
    await expect(page.locator('[data-day="4"] [data-lesson-id]').filter({ hasText: "מרצה 42" })).toBeVisible();
  });

  test("a day short of women turns even once a woman is proposed, then closes", async ({ page }) => {
    const wednesdayLate = cell(page, 3, 1350, 1440);
    await expect(wednesdayLate).toHaveAttribute("data-need", "f");
    await speaker(page, 42).getByRole("button", { name: "שבץ" }).click();
    await cell(page, 3, 1200, 1290).click();
    await expect(wednesdayLate).toHaveAttribute("data-need", "even");
    await page.locator('[data-day="3"] [data-lesson-id]').filter({ hasText: "מרצה 42" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "סגרנו" }).click();
    await expect(page.getByRole("status").filter({ hasText: "השיעור נסגר" })).toBeVisible();
    await expect(page.getByRole("button", { name: /ד״ר מרצה 42 — /, exact: false })).toBeVisible();
  });

  test("splitting a row into two parallel lessons needs a reason", async ({ page }) => {
    await cell(page, 4, 870, 960).click();
    const dialog = page.getByRole("dialog", { name: "משבצת פנויה" });
    await expect(dialog.getByRole("button", { name: "ל-2" })).toBeDisabled();
    await dialog.getByLabel("סיבה לפיצול").fill("שני מסלולים");
    await dialog.getByRole("button", { name: "ל-2" }).click();
    await expect(page.locator('[data-day="4"] [data-lesson-id]').filter({ hasText: "מקביל" })).toHaveCount(2);
  });

  test("60+30 splits a row; «איחוד» builds the night", async ({ page }) => {
    await cell(page, 4, 960, 1050).click();
    await page.getByRole("dialog").getByRole("button", { name: "60+30 דק׳" }).click();
    await expect(page.locator('[data-day="4"] [aria-label*="16:00–17:00"]')).toBeVisible();
    await expect(page.locator('[data-day="4"] [aria-label*="17:00–17:30"]')).toBeVisible();

    await cell(page, 3, 1470, 1560).click();
    await page.getByRole("dialog").getByRole("button", { name: "איחוד עם המשבצת הבאה" }).click();
    await expect(page.locator('[data-day="3"] [aria-label*="00:30–03:30"]')).toBeVisible();
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

  test("pool → «שבץ» → back to the day to choose the cell", async ({ page }) => {
    await page.getByRole("navigation", { name: "ניווט" }).getByRole("button", { name: "מאגר" }).click();
    await speaker(page, 43).getByRole("button", { name: "שבץ" }).click();
    await expect(page.getByRole("status").filter({ hasText: "משבצים את" })).toBeVisible();
    await page.getByRole("tab", { name: "חמישי" }).click();
    await cell(page, 4, 510, 600).click();
    await expect(page.locator("[data-lesson-id]").filter({ hasText: "מרצה 43" })).toBeVisible();
  });

  test("the night merge reads as one lesson with its continuation", async ({ page }) => {
    await page.getByRole("tab", { name: "שני" }).click();
    await expect(page.getByText("המשך השיעור").first()).toBeVisible();
    await noSidewaysScroll(page);
  });
});
