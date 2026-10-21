// «הגדרות» in a real browser: an admin runs the team from the site (demo
// build, every width), a non-admin never reaches it (mock build), and adding a
// member goes out as the right REST call with the member's own token.
import { expect, type Page, test } from "@playwright/test";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

/** A toast (the demo banner is a status too). */
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

test.describe("demo build — an admin", () => {
  test("opens הגדרות from the header, adds a member, and pastes the trainees' names", async ({ page }, info) => {
    const wide = info.project.name === "desktop";
    await page.goto(demoUrl());
    await page.getByRole("banner").getByRole("link", { name: "הגדרות" }).click();
    await expect(page).toHaveURL(/\/settings\/team$/);
    await expect(page.getByRole("tablist", { name: "אזורי ההגדרות" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "צוות" })).toHaveAttribute("aria-selected", "true");
    await noSidewaysScroll(page);

    // a member: the address is stored the way the database wants it
    await page.getByLabel("כתובת Gmail").fill("  New.Member@Example.org ");
    await page.getByLabel("שם", { exact: true }).fill("חבר/ת צוות לדוגמה");
    await page.getByRole("radio", { name: "צוות לוגיסטי" }).check();
    await page.getByRole("button", { name: "הוספה לצוות" }).click();
    await expect(toast(page, "חבר/ת צוות לדוגמה נוסף/ה לצוות")).toBeVisible();
    const team = page.getByRole(wide ? "table" : "list", { name: "צוות המחזור" });
    await expect(team.getByText("new.member@example.org")).toBeVisible();
    await expect(page.getByLabel("כתובת Gmail")).toHaveValue("");
    await noSidewaysScroll(page);

    // the same address twice is refused, in Hebrew, beside the form
    await page.getByLabel("כתובת Gmail").fill("new.member@example.org");
    await page.getByLabel("שם", { exact: true }).fill("שוב");
    await page.getByRole("button", { name: "הוספה לצוות" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "הכתובת כבר ברשימה" })).toBeVisible();

    // the roster: paste, preview, save
    await page.getByRole("tab", { name: "חניכים" }).click();
    await expect(page).toHaveURL(/\/settings\/roster$/);
    await page.getByLabel("הדבקת שמות").fill("חניך/ה לדוגמה 01\nחניך/ה לדוגמה 02\nחניך/ה לדוגמה 02\n3\tחניך/ה לדוגמה 03\tנ");
    const preview = page.getByRole("list", { name: "תצוגה מקדימה" });
    await expect(preview.getByRole("listitem")).toHaveCount(4);
    await expect(preview.getByText("כפול בהדבקה")).toHaveCount(1);
    await page.getByRole("button", { name: "הוספת 3 שמות" }).click();
    await expect(toast(page, "נוספו 3 שמות לרשימה")).toBeVisible();
    await expect(page.getByText("9 חניכים")).toBeVisible(); // the demo's six escorts (DEMO_ROSTER) and these three
    const roster = page.getByRole(wide ? "table" : "list", { name: "רשימת החניכים" });
    for (const n of ["01", "02", "03"]) await expect(roster.getByText(`חניך/ה לדוגמה ${n}`)).toBeVisible();
    await noSidewaysScroll(page);

    // pasting the same names again adds nothing
    await page.getByLabel("הדבקת שמות").fill("חניך/ה לדוגמה 01\nחניך/ה  לדוגמה-02");
    await expect(preview.getByText("כבר ברשימה")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "הוספה לרשימה" })).toBeDisabled();

    // the tabs answer the keyboard: ← is the next one in a right-to-left row
    await page.getByRole("tab", { name: "חניכים" }).focus();
    await page.keyboard.press(wide ? "ArrowDown" : "ArrowLeft");
    await expect(page).toHaveURL(/\/settings\/rooms$/);
    await expect(page.getByRole("tab", { name: "חדרים" })).toBeFocused();
    await noSidewaysScroll(page);
  });

  test("opens a new edition (date TBD) and finds it on the week", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for this flow");
    await page.goto(`${demoUrl()}/settings/edition`);
    const label = page.getByLabel("שם המחזור");
    await expect(label).not.toHaveValue(""); // this Hebrew year, from Intl
    await label.fill("מחזור לדוגמה");
    await page.getByLabel("תאריך הפתיחה (יום ראשון)").fill("2027-02-15");
    await page.getByRole("button", { name: "פתיחת המחזור" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "יום ראשון" })).toBeVisible(); // a Monday is refused
    await page.getByRole("button", { name: "ניקוי התאריך" }).click();
    await page.getByRole("button", { name: "פתיחת המחזור" }).click();
    await expect(toast(page, "המחזור מחזור לדוגמה נפתח")).toBeVisible();
    await expect(page.getByRole("table", { name: "המחזורים" }).getByRole("row").filter({ hasText: "מחזור לדוגמה" })).toContainText("TBD");
    await page.getByRole("banner").getByRole("link", { name: "השבוע" }).click();
    await expect(page.getByRole("combobox", { name: "מחזור" })).toHaveValue(/\d+/);
    await expect(page.getByRole("combobox", { name: "מחזור" }).locator("option:checked")).toHaveText("מחזור לדוגמה");
    await expect(page.getByRole("grid", { name: "רשת השבוע" })).toBeVisible();
  });

  test("a confirm cancelled from the keyboard gives the focus back to the button that asked: the team, the trainees, the rooms", async ({ page }, info) => {
    const wide = info.project.name === "desktop";
    const button = (name: string) => page.getByRole("button", { name, exact: true });
    const cancel = () => page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "ביטול", exact: true }).press("Enter");
    // a delete is asked for from the row on a wide screen; on a phone «מחיקה» is inside «עריכה», which takes the focus back
    const askDelete = async (name: string) => {
      if (!wide) await button(`עריכת ${name}`).click();
      await button(`מחיקת ${name}`).click();
    };
    const asker = (name: string) => button(`${wide ? "מחיקת" : "עריכת"} ${name}`);

    await page.goto(`${demoUrl()}/settings/team`);
    await askDelete("לוגיסטיקה (הדגמה)");
    await cancel();
    await expect(asker("לוגיסטיקה (הדגמה)")).toBeFocused();
    if (wide) {
      // asked from the edit form, which the cancel closes: the row's «מחיקה»
      await button("עריכת לוגיסטיקה (הדגמה)").click();
      await button("מחיקת לוגיסטיקה (הדגמה)").click(); // the form's: the row is the form now
      await cancel();
      await expect(button("מחיקת לוגיסטיקה (הדגמה)")).toBeFocused();
    }
    // someone with history: the delete refused, deactivation offered instead — and cancelled
    await askDelete("חניך/ה א׳");
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "מחיקה", exact: true }).click();
    await expect(page.getByRole("group", { name: "אישור" })).toContainText("חניך/ה א׳: לחבר/ת הצוות כבר יש פעולות במערכת");
    await cancel();
    await expect(asker("חניך/ה א׳")).toBeFocused();
    // deactivated from the keyboard, the busy button keeps the focus (now «החזרה»); then only «הבנתי», which gives it back too
    await button("השבתת חניך/ה א׳").press("Enter");
    await expect(toast(page, "חניך/ה א׳ הושבת/ה")).toBeVisible();
    await expect(button("החזרת חניך/ה א׳")).toBeFocused();
    await askDelete("חניך/ה א׳");
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "מחיקה", exact: true }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "הבנתי" }).press("Enter");
    await expect(asker("חניך/ה א׳")).toBeFocused();

    await page.getByRole("tab", { name: "חניכים" }).click();
    await askDelete("מלווה לדוגמה ב׳");
    await expect(page.getByRole("group", { name: "אישור" })).toContainText("למחוק את מלווה לדוגמה ב׳");
    await cancel();
    await expect(asker("מלווה לדוגמה ב׳")).toBeFocused();

    await page.getByRole("tab", { name: "חדרים" }).click();
    await button("מחיקת כיתה ג׳").click();
    await cancel();
    await expect(button("מחיקת כיתה ג׳")).toBeFocused();
    // a room in use cannot go: «הבנתי» gives the focus back too
    await button("מחיקת כיתת בית מדרש").click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "מחיקה", exact: true }).click();
    await page.getByRole("group", { name: "אי אפשר למחוק" }).getByRole("button", { name: "הבנתי" }).press("Enter");
    await expect(button("מחיקת כיתת בית מדרש")).toBeFocused();
  });

  test("the categories and the templates: a confirm cancelled gives the focus back; a busy button keeps it", async ({ page }) => {
    const button = (name: string) => page.getByRole("button", { name, exact: true });
    const confirm = () => page.getByRole("group", { name: "אישור" });
    const cancel = () => confirm().getByRole("button", { name: "ביטול", exact: true }).press("Enter");

    await page.goto(`${demoUrl()}/settings/categories`);
    await button("מחיקת פילוסופיה").click();
    await cancel();
    await expect(button("מחיקת פילוסופיה")).toBeFocused();
    // a category in use: the delete refused, deactivation offered instead — and cancelled
    await button("מחיקת מחשבת ישראל").click();
    await confirm().getByRole("button", { name: "מחיקה", exact: true }).click();
    await expect(confirm().getByRole("button", { name: "השבתה", exact: true })).toBeVisible();
    await cancel();
    await expect(button("מחיקת מחשבת ישראל")).toBeFocused();
    // a busy button keeps the focus: deactivated from the keyboard, the same button (now «הפעלה») still has it
    await button("השבתת מחשבת ישראל").press("Enter");
    await expect(toast(page, "«מחשבת ישראל» הושבתה")).toBeVisible();
    await expect(button("הפעלת מחשבת ישראל")).toBeFocused();
    // already deactivated: only «הבנתי», and it gives the focus back too
    await button("מחיקת מחשבת ישראל").click();
    await confirm().getByRole("button", { name: "מחיקה", exact: true }).click();
    await confirm().getByRole("button", { name: "הבנתי" }).press("Enter");
    await expect(button("מחיקת מחשבת ישראל")).toBeFocused();

    await page.getByRole("tab", { name: "תבניות" }).click();
    await page.getByLabel("הנוסח", { exact: true }).fill("נוסח לדוגמה ל{{פנייה}}");
    await button("שמירת הנוסח").click();
    await expect(toast(page, "הנוסח נשמר")).toBeVisible();
    await button("מחיקת הנוסח").click();
    await cancel();
    await expect(button("מחיקת הנוסח")).toBeFocused();
    // two phrases: the one whose «מחיקה» asked takes the focus back, not its neighbour
    await page.getByLabel("ניסוח (אפשר כמה, ניסוח בכל שורה)").fill("ניסוח לדוגמה א\nניסוח לדוגמה ב");
    await button("הוספה").click();
    await expect(toast(page, "נוספו 2 ניסוחים")).toBeVisible();
    await button("מחיקת הניסוח: ניסוח לדוגמה ב").click();
    await cancel();
    await expect(button("מחיקת הניסוח: ניסוח לדוגמה ב")).toBeFocused();
  });
});

const content = {
  status: "ok",
  schema_version: EXPECTED_SCHEMA_VERSION,
  email: "member@example.org",
  display_name: "חבר/ת צוות לדוגמה",
  global_admin: false,
  memberships: [{ edition_id: 7, role: "content", member_id: 2 }],
};
const admin = {
  status: "ok",
  schema_version: EXPECTED_SCHEMA_VERSION,
  email: "admin@example.org",
  display_name: "מדריך/ה לדוגמה",
  global_admin: true,
  memberships: [{ edition_id: null, role: "admin", member_id: 1 }],
};
const edition = { id: 7, label: 'תשפ"ז', kind: "real", start_date: null, first_day_from: null, last_day_until: 1140, status: "planning", settings: {} };

test.describe("mock build", () => {
  test("a content member has no «הגדרות», and /settings sends them home", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: content });
    await sb.attach(page);
    await signIn(page);
    await page.goto(mockUrl());
    await expect(page.getByRole("heading", { name: "עוד לא נפתח מחזור" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "הגדרות" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "לפתיחת מחזור" })).toHaveCount(0);

    await page.goto(`${mockUrl()}/settings/team`);
    await expect(page.getByRole("heading", { name: "עוד לא נפתח מחזור" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    expect(sb.calls.some((c) => c.path === "/rest/v1/members")).toBe(false);
  });

  test("an admin adds a member: one POST to members, normalised, with the admin's own token", async ({ page }) => {
    const sb = new FakeSupabase({ status: 200, body: admin });
    sb.answers.set("editions", [edition]);
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    await page.goto(mockUrl());
    await page.getByRole("banner").getByRole("link", { name: "הגדרות" }).click();
    await expect(page.getByText(/מחזור:\s*תשפ"ז/)).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "התנתקות" })).toBeVisible(); // the fullest header still fits
    await noSidewaysScroll(page);

    await page.getByLabel("כתובת Gmail").fill(" New.Member@Example.org");
    await page.getByLabel("שם", { exact: true }).fill(" חבר/ת צוות לדוגמה ");
    await page.getByRole("radio", { name: "נקבה" }).first().check();
    await page.getByRole("button", { name: "הוספה לצוות" }).click();
    await expect(toast(page, "נוספה לצוות")).toBeVisible();

    const posts = sb.writes.filter((w) => w.table === "members");
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
    expect(posts[0].auth).toBe(`Bearer ${session.access_token}`);
    expect(posts[0].body).toEqual({ email: "new.member@example.org", display_name: "חבר/ת צוות לדוגמה", gender: "f", role: "content", edition_id: 7 });
    expect(posts[0].prefer).toContain("return=representation");
    // the list is read again after the write (the edition's rows, then the all-editions rows)
    await expect.poll(() => sb.calls.filter((c) => c.path === "/rest/v1/members" && c.method === "GET").length).toBeGreaterThanOrEqual(4);
    expect(sb.calls.find((c) => c.path === "/rest/v1/members" && c.method === "GET")?.query.get("edition_id")).toBe("eq.7");
  });

  test("an edition's admin is offered only what the database allows them, and names themselves", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const me = { ...admin, email: "edition.admin@example.org", display_name: "", global_admin: false, memberships: [{ edition_id: 7, role: "admin", member_id: 3 }] };
    const sb = new FakeSupabase({ status: 200, body: me });
    sb.answers.set("editions", [edition]);
    sb.tables.set("members", [
      { id: 3, email: "edition.admin@example.org", display_name: "", gender: null, role: "admin", edition_id: 7, active: true },
      { id: 4, email: "peer.admin@example.org", display_name: "מדריך/ה נוסף/ת לדוגמה", gender: null, role: "admin", edition_id: 7, active: true },
      { id: 5, email: "member@example.org", display_name: "חבר/ת צוות לדוגמה", gender: null, role: "content", edition_id: 7, active: true },
    ]);
    sb.answers.set("team", [
      { id: 1, display_name: "מדריך/ה לכל המחזורים", gender: null, role: "admin" },
      { id: 4, display_name: "מדריך/ה נוסף/ת לדוגמה", gender: null, role: "admin" },
      { id: 5, display_name: "חבר/ת צוות לדוגמה", gender: null, role: "content" },
    ]);
    sb.answers.set("set_my_profile", null);
    await sb.attach(page);
    await signIn(page, "edition.admin@example.org");
    await page.goto(`${mockUrl()}/settings/categories`); // global admins only → back to the team
    await expect(page).toHaveURL(/\/settings\/team$/);
    await expect(page.getByRole("tab")).toHaveText(["מחזור", "צוות", "חניכים", "חדרים", "תבניות", "קישורים"]);

    // no way to mint an admin, and no handle on a fellow admin's row
    await expect(page.getByRole("radio", { name: "צוות תוכן" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "מדריך/ה של המחזור" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "עריכת חבר/ת צוות לדוגמה" })).toBeVisible();
    await expect(page.getByRole("button", { name: /מדריך\/ה נוסף\/ת לדוגמה/ })).toHaveCount(0);
    // the all-editions admin appears by name only (public.team), read-only
    const everywhere = page.getByRole("table", { name: "בכל המחזורים" });
    await expect(everywhere.getByText("מדריך/ה לכל המחזורים")).toBeVisible();
    await expect(everywhere.getByRole("button")).toHaveCount(0);

    // no name yet: the header shows the address, and the form asks for one
    await expect(page.getByRole("banner").getByText("edition.admin@example.org")).toBeVisible();
    await page.getByLabel("השם שיוצג לצוות").fill("מדריך/ה של המחזור לדוגמה");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הפרטים שלך נשמרו")).toBeVisible();
    expect(sb.rpc.get("set_my_profile")).toEqual([{ p_display_name: "מדריך/ה של המחזור לדוגמה", p_gender: null }]);
    await expect.poll(() => sb.count("/rest/v1/rpc/whoami")).toBeGreaterThanOrEqual(2); // the header is re-read
  });

  test("a refusal from the database reads as Hebrew, never as a Postgres message", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const sb = new FakeSupabase({ status: 200, body: admin });
    sb.answers.set("editions", [edition]);
    await sb.attach(page);
    await signIn(page, "admin@example.org");
    // PostgREST's answer to a duplicate (email, edition): 409 with SQLSTATE 23505
    await page.route("**/rest/v1/members?*", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "23505", message: 'duplicate key value violates unique constraint "members_email_edition_key"' }) })
        : route.fallback(),
    );
    await page.goto(`${mockUrl()}/settings/team`);
    await page.getByLabel("כתובת Gmail").fill("someone@example.org");
    await page.getByLabel("שם", { exact: true }).fill("חבר/ת צוות לדוגמה");
    await page.getByRole("button", { name: "הוספה לצוות" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "הכתובת כבר ברשימה" })).toBeVisible();
    await expect(page.getByText("duplicate key")).toHaveCount(0);
    await expect(page.getByLabel("כתובת Gmail")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("כתובת Gmail")).toBeFocused();
  });

  test("a member with history: the DELETE's P0001 offers deactivation in the row; a write RLS drops reads as refused, not saved", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const sb = new FakeSupabase({ status: 200, body: admin });
    sb.answers.set("editions", [edition]);
    sb.tables.set("members", [{ id: 5, email: "member@example.org", display_name: "חבר/ת צוות לדוגמה", gender: null, role: "content", edition_id: 7, active: true }]);
    await sb.attach(page);
    await signIn(page, "admin@example.org");
    const sent: string[] = [];
    await page.route("**/rest/v1/members?*", (route) => {
      const m = route.request().method();
      if (m === "GET") return route.fallback();
      sent.push(`${m} ${new URL(route.request().url()).searchParams.get("id")}`);
      return m === "DELETE"
        ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "member_has_history", details: null, hint: null }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: "[]" }); // RLS filtered the PATCH: no row back
    });
    await page.goto(`${mockUrl()}/settings/team`);
    await page.getByRole("button", { name: "מחיקת חבר/ת צוות לדוגמה" }).click();
    await page.getByRole("group", { name: "אישור" }).getByRole("button", { name: "מחיקה" }).click();
    const offer = page.getByRole("group", { name: "אישור" });
    await expect(offer).toContainText("חבר/ת צוות לדוגמה: לחבר/ת הצוות כבר יש פעולות במערכת");
    await offer.getByRole("button", { name: "השבתה" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "הפעולה הזו שמורה למדריך/ה" })).toBeVisible();
    await expect(toast(page, /הושבת/)).toHaveCount(0);
    expect(sent).toEqual(["DELETE eq.5", "PATCH eq.5"]);
  });
});
