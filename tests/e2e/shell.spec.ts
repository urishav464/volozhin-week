import { expect, test, type Page } from "@playwright/test";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

async function noSidewaysScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
}

const member = {
  status: "ok",
  schema_version: 1,
  email: "member@example.org",
  display_name: "נועה בדיקה",
  global_admin: false,
  memberships: [{ edition_id: 1, role: "content" }],
};

test.describe("demo build", () => {
  test("is Hebrew, right-to-left, labelled as a demo, and fits the screen", async ({ page }) => {
    await page.goto(demoUrl());
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.getByRole("heading", { name: "שבוע וולוז'ין" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("מצב הדגמה");
    await expect(page.getByText("מדריך/ה (הדגמה)").first()).toBeVisible();
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  test("signed out → «כניסה עם Google» asks for Google with PKCE", async ({ page }) => {
    const sb = new FakeSupabase();
    await sb.attach(page);
    await page.goto(mockUrl());
    await page.getByRole("button", { name: "כניסה עם Google" }).click();
    await page.waitForURL("**/auth/v1/authorize**");
    const call = sb.calls.find((c) => c.path === "/auth/v1/authorize")!;
    expect(call.query.get("provider")).toBe("google");
    expect(call.query.get("code_challenge")).toBeTruthy();
    expect(call.query.get("code_challenge_method")?.toLowerCase()).toBe("s256");
    expect(call.query.get("redirect_to")).toBe(`${mockUrl()}/`);
  });

  test("a member lands home, the request carrying their token", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: member });
    await sb.attach(page);
    await signIn(page);
    await page.goto(mockUrl());
    await expect(page.getByRole("heading", { name: /שלום, נועה בדיקה/ })).toBeVisible();
    await expect(page.getByText("צוות תוכן")).toBeVisible();
    expect(sb.calls.find((c) => c.path === "/rest/v1/rpc/whoami")?.auth).toMatch(/^Bearer /);
    await noSidewaysScroll(page);
  });

  test("an address not on the list is told so, by name", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: { status: "not_member", schema_version: 1 } });
    await sb.attach(page);
    await signIn(page, "someone.else@example.org");
    await page.goto(mockUrl());
    await expect(page.getByRole("heading", { name: "הכתובת עדיין לא ברשימת הצוות" })).toBeVisible();
    await expect(page.getByText("someone.else@example.org")).toBeVisible();
  });

  test("a non-Google sign-in is refused", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: { status: "wrong_provider", schema_version: 1 } });
    await sb.attach(page);
    await signIn(page);
    await page.goto(mockUrl());
    await expect(page.getByRole("heading", { name: "הכניסה רק עם Google" })).toBeVisible();
  });

  test("a stale database asks for schema.sql to be re-run", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: { ...member, schema_version: 0 } });
    await sb.attach(page);
    await signIn(page);
    await page.goto(mockUrl());
    await expect(page.getByRole("heading", { name: "מסד הנתונים לא מעודכן" })).toBeVisible();
    await expect(page.getByText("supabase/schema.sql")).toBeVisible();
  });

  test("a database where schema.sql never ran says the same", async ({ page }) => {
    const sb = new FakeSupabase({ status: 404, body: { code: "PGRST202", message: "Could not find the function public.whoami" } });
    await sb.attach(page);
    await signIn(page);
    await page.goto(mockUrl());
    await expect(page.getByRole("heading", { name: "מסד הנתונים לא מעודכן" })).toBeVisible();
  });

  test("«התנתקות» signs out and returns to the sign-in screen", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: member });
    await sb.attach(page);
    await signIn(page);
    await page.goto(mockUrl());
    await page.getByRole("button", { name: "התנתקות" }).click();
    await expect(page.getByRole("button", { name: "כניסה עם Google" })).toBeVisible();
    expect(sb.count("/auth/v1/logout")).toBe(1);
  });
});
