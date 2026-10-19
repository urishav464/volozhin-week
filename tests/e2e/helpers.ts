import { expect, type Page } from "@playwright/test";

/**
 * No sideways scroll. Compares with clientWidth, not innerWidth: on a mobile
 * viewport Chromium widens the layout viewport to fit overflowing content, so
 * innerWidth grows with the overflow and would hide it.
 */
export async function noSidewaysScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
}
