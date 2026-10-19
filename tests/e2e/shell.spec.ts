import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, fakeSession, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;


const member = {
  status: "ok",
  schema_version: EXPECTED_SCHEMA_VERSION,
  email: "member@example.org",
  display_name: "נועה בדיקה",
  global_admin: false,
  memberships: [{ edition_id: 1, role: "content", member_id: 2 }],
};

test.describe("demo build", () => {
  test("is Hebrew, right-to-left, labelled as a demo, and fits the screen", async ({ page }) => {
    await page.goto(demoUrl());
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.getByRole("heading", { name: "שבוע וולוז'ין" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("מצב הדגמה");
    await expect(page.getByText("מדריך/ה (הדגמה)").first()).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "עדשה" })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("the privacy page Google's consent screen links to is served as itself, not as the app", async ({ page }) => {
    await page.goto(`${demoUrl()}/privacy.html`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1, name: "מדיניות פרטיות" })).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0); // no demo banner: the app did not load
    await noSidewaysScroll(page);
  });
});

test.describe("mock build", () => {
  test("signed out → «כניסה עם Google» asks for Google with PKCE", async ({ page }) => {
    const sb = new FakeSupabase();
    await sb.attach(page);
    await page.goto(mockUrl());
    await expect(page.getByRole("link", { name: "מדיניות פרטיות" })).toHaveAttribute("href", "/privacy.html");
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
    const session = await signIn(page);
    sb.token = session.access_token; // anything else is refused, as PostgREST would
    await page.goto(mockUrl());
    await expect(page.getByRole("banner").getByText(/נועה בדיקה/)).toBeVisible();
    await expect(page.getByRole("banner").getByText(/צוות תוכן/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "עוד לא נפתח מחזור" })).toBeVisible();
    expect(sb.calls.find((c) => c.path === "/rest/v1/rpc/whoami")?.auth).toBe(`Bearer ${session.access_token}`);
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

  test("the return from Google exchanges the code with the verifier behind the challenge", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: member });
    await sb.attach(page);
    await page.goto(mockUrl());
    await page.getByRole("button", { name: "כניסה עם Google" }).click();
    await page.waitForURL("**/auth/v1/authorize**");
    const challenge = sb.calls.find((c) => c.path === "/auth/v1/authorize")!.query.get("code_challenge")!;
    sb.pkceSession = fakeSession();
    sb.token = (sb.pkceSession as { access_token: string }).access_token;
    await page.goto(`${mockUrl()}/?code=abc123`);
    await expect(page.getByRole("banner").getByText(/נועה בדיקה/)).toBeVisible();
    expect(sb.pkceBody?.auth_code).toBe("abc123");
    const digest = createHash("sha256").update(sb.pkceBody!.code_verifier!).digest("base64url");
    expect(digest).toBe(challenge);
    expect(page.url()).not.toContain("code=");
  });

  test("a failed return from Google says so, and cleans the address bar", async ({ page }) => {
    const sb = new FakeSupabase();
    await sb.attach(page);
    await page.goto(`${mockUrl()}/?error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code`);
    await expect(page.getByRole("alert")).toContainText("הכניסה לא הושלמה");
    await expect(page.getByRole("alert")).toContainText("Unable to exchange external code");
    await expect(page.getByRole("button", { name: "כניסה עם Google" })).toBeVisible();
    expect(page.url()).not.toContain("error");
  });
});
