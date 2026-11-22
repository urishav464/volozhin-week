import { expect, type Locator, type Page } from "@playwright/test";

/**
 * No sideways scroll. Compares with clientWidth, not innerWidth: on a mobile
 * viewport Chromium widens the layout viewport to fit overflowing content, so
 * innerWidth grows with the overflow and would hide it.
 */
export async function noSidewaysScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
}

/** The header's sections (src/screens/Shell.tsx HeaderNav). */
export const headerNav = (page: Page): Locator => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });

/** Below 1024px the header keeps one row: the sections a role uses less sit behind «עוד» (the reset, phase 5). */
export const narrowHeader = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 1024;

/**
 * A header section's link by its accessible name (a string is matched exactly; a badge's link reads «אישורים, 2
 * ממתינים», so pass a RegExp for it) — found whether or not it sits behind «עוד».
 */
export const sectionLink = (page: Page, label: string | RegExp): Locator =>
  headerNav(page).getByRole("link", { name: label, exact: typeof label === "string", includeHidden: true });

/**
 * Clicks a header section by its link's name. Below 1024px (src/screens/nav.ts splitNav) a section that is not in the
 * row is behind the «עוד» disclosure ([data-nav-more], aria-expanded): it is opened first, then the link clicked — the
 * page changes and «עוד» closes by itself. From 1024px every section is in the row.
 */
export async function goSection(page: Page, label: string | RegExp): Promise<void> {
  const link = sectionLink(page, label);
  await link.waitFor({ state: "attached" });
  if (!(await link.isVisible())) {
    const more = headerNav(page).locator("[data-nav-more]");
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(link).toBeVisible();
  }
  await link.click();
}

/**
 * The header's sections, in order: every one of them (those behind «עוד» included) — and the ones in view: below 1024px
 * only the row's first `inline` and the «עוד» button (when anything is behind it), from 1024px all of them and no «עוד».
 */
export async function expectSections(page: Page, all: (string | RegExp)[], inline: number = all.length): Promise<void> {
  const nav = headerNav(page);
  await expect(nav.getByRole("link", { includeHidden: true })).toHaveText(all);
  const narrow = narrowHeader(page);
  await expect(nav.getByRole("link")).toHaveText(narrow ? all.slice(0, inline) : all);
  await expect(nav.locator("[data-nav-more]")).toBeVisible({ visible: narrow && inline < all.length });
}

/** The staff's header (src/screens/nav.ts navFor): the row's four, then what «עוד» holds below 1024px. */
export const STAFF_SECTIONS: (string | RegExp)[] = ["השבוע", "ימים", "מרצים", /^אישורים/, "לוגיסטיקה", "תוצרים", "מצגות", "זמני זיכרון", "מכריכה לכריכה", "ידע", "הגדרות", "עזרה"];
/** Logistics' header: «בית · אישורים · השבוע · תוצרים», then what «עוד» holds below 1024px. */
export const LOGISTICS_SECTIONS: (string | RegExp)[] = ["בית", /^אישורים/, "השבוע", "תוצרים", "מצגות", "זמני זיכרון", "מכריכה לכריכה", "ידע", "עזרה"];
/** How many of each list stay in the row below 1024px. */
export const INLINE_SECTIONS = 4;
