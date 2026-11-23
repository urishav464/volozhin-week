import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { expectSections, headerNav, INLINE_SECTIONS, LOGISTICS_SECTIONS, narrowHeader, noSidewaysScroll, STAFF_SECTIONS } from "./helpers";
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

  test("the header: below 1024px one row and «עוד» for the rest — by the keyboard, Escape gives it the focus back; from 1024px every section in the row", async ({ page }) => {
    await page.goto(demoUrl());
    const nav = headerNav(page);
    const more = nav.locator("[data-nav-more]");
    const panel = nav.locator("[data-nav-more-panel]");
    await expectSections(page, STAFF_SECTIONS, INLINE_SECTIONS);
    await noSidewaysScroll(page);
    if (!narrowHeader(page)) {
      // every section inline, in one row; «עוד»'s list is simply the row's end
      await expect(more).toBeHidden();
      await expect(panel).toBeVisible();
      const tops = await nav.getByRole("link").evaluateAll((ls) => ls.map((l) => Math.round(l.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
      expect((await page.getByRole("banner").boundingBox())!.height).toBeLessThanOrEqual(56);
      return;
    }
    // the staff's four, «עוד» closed — a header of two rows, not four
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toHaveAttribute("aria-controls", "nav-more");
    await expect(more).toHaveAccessibleName("עוד");
    await expect(panel).toHaveAttribute("id", "nav-more");
    await expect(panel).toBeHidden();
    expect((await page.getByRole("banner").boundingBox())!.height).toBeLessThanOrEqual(120);
    const box = (await more.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);

    // by the keyboard: Enter opens, Tab walks into its links (a disclosure, never a menu), Escape closes — the focus back
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link")).toHaveText(STAFF_SECTIONS.slice(INLINE_SECTIONS));
    await noSidewaysScroll(page);
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(more).toBeFocused();
    // Space opens it, Enter on «עוד» closes it again
    await page.keyboard.press("Space");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    // a tap outside it closes it
    await more.click();
    await expect(panel).toBeVisible();
    const main = (await page.locator("main").boundingBox())!;
    await page.mouse.click(main.x + 8, main.y + main.height - 8);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();

    // a section behind it: the page changes, «עוד» closes with the focus on it, and wears the active pill
    await more.click();
    await panel.getByRole("link", { name: "ידע" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/knowledge/);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(more).toHaveAttribute("data-active", "");
    await expect(more).toHaveAccessibleName("עוד, כאן: ידע");
    await expect(more).toBeFocused();
    await noSidewaysScroll(page);
  });

  test("the header of each role below and above 1024px: logistics' four and «עוד», a trainee's few with no «עוד»", async ({ page }) => {
    await page.goto(`${demoUrl()}/?as=logistics`);
    await expect(page).toHaveURL(/\/logistics$/);
    await expectSections(page, LOGISTICS_SECTIONS, INLINE_SECTIONS);
    await noSidewaysScroll(page);
    await page.goto(`${demoUrl()}/?as=trainee`);
    await expect(page.getByRole("heading", { name: "היום שלי", level: 2 })).toBeVisible();
    await expectSections(page, ["היום שלי", "מרצים", "השבוע", "עזרה"]);
    await expect(headerNav(page).locator("[data-nav-more]")).toHaveCount(0);
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
    // a content member is a trainee (the reset, phase 2): their own four sections, «היום שלי» the home
    await expect(page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" }).getByRole("link")).toHaveText(["היום שלי", "מרצים", "השבוע", "עזרה"]);
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
