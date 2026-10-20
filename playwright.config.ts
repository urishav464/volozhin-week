import { defineConfig } from "@playwright/test";

// The e2e suite builds the app itself (tests/e2e/global-setup.ts) twice: a demo
// build (no Supabase configured) and a "mock" build pointed at a host that does
// not exist, whose every request the tests answer by route interception.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  // Service workers off, except where a test turns them on (tests/e2e/offline.spec.ts): a worker would keep pages and
  // files between tests' loads, and requests it answered would bypass page.route.
  use: { locale: "he-IL", timezoneId: "Asia/Jerusalem", serviceWorkers: "block" },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
