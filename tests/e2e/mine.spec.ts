// «המרצים שלי», the team's board and the approvals queue in a real browser (v14: the call first, the instructor's
// approval only before closing). Demo build, every width: the call from a row — the sheet open at its points, each
// result moving the row on, the focus with it; a speaker who agreed waits for approval (the header's badge counts
// her), approved in the row, then «לסגירת השעה» on her cell; «כל הצוות» — what waits for the instructor, a block per
// handler, «בלי אחראי/ת» for a speaker sent back to the pool; the approvals queue (who agreed first, the others
// folded, the archive's batch among them); a hand-over. Mock build: a content member is offered no approval, and the
// row's hand-over goes out by the contract's parameter names with the member's own token. Synthetic people only.
import { expect, type Page, test } from "@playwright/test";
import { demoWeek } from "../../src/data/demoWeek";
import { toXlsx } from "../../src/exports/xlsx";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

/** A toast (the demo banner is a status too). */
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });
/** A speaker's row in one of «שלי»'s groups. */
const row = (page: Page, group: string, name: string) => page.getByRole("region", { name: group, exact: true }).locator("li").filter({ hasText: name });
/** A fold, by its summary's words. */
const fold = (page: Page, title: string) => page.locator("details").filter({ has: page.locator("summary", { hasText: title }) });

test.describe("demo build", () => {
  test("the call first: «לשיחה» opens the points; «לא ענתה» → «לנסות שוב», «שוחחנו» → «מחכים לתשובה», «הסכימה» → «לסגור שעה» → «שבץ»", async ({ page }) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "המרצים שלי" }).click();
    await expect(page).toHaveURL(/\/mine$/);
    await expect(nav(page).getByRole("link", { name: "המרצים שלי" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("tab", { name: "שלי" })).toHaveAttribute("aria-selected", "true");
    await expect(row(page, "להתקשר", "מרצה 32")).toContainText("לפני שיחה");
    await expect(row(page, "לנסות שוב", "מרצה 36")).toContainText("לא ענתה");
    await noSidewaysScroll(page);

    const sheet = page.getByRole("dialog", { name: "מרצה 32" });
    const result = sheet.getByRole("group", { name: "תוצאת השיחה" });
    /** «לשיחה» in the row, a result in the sheet — the list behind it moves the row — then the sheet closed: the focus is on the row, in its new group. */
    const call = async (from: string, said: string, to: string, note?: string) => {
      await row(page, from, "מרצה 32").getByRole("button", { name: "לשיחה" }).click();
      if (note) await result.getByLabel("מה נאמר בשיחה").fill(note);
      await result.getByRole("button", { name: said, exact: true }).click();
      await expect(row(page, to, "מרצה 32")).toBeAttached();
      await sheet.getByRole("button", { name: "סגירה", exact: true }).click();
      await expect(row(page, to, "מרצה 32").getByRole("button", { name: "מרצה 32" })).toBeFocused();
    };

    // the sheet opens at the call: the instructor's points, the caller's name for X, addressed to her
    await row(page, "להתקשר", "מרצה 32").getByRole("button", { name: "לשיחה" }).click();
    const points = sheet.locator("[data-call-points]");
    await expect(points).toContainText("אני מדריך/ה (הדגמה) מהמדרשה הגבוהה בעין פרת");
    await expect(points).toContainText("נשמח שתגיעי ללמד שעה ורבע, תסכימי?");
    await expect(result.getByRole("button", { name: "הסכימה", exact: true })).toBeVisible();
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה", exact: true }).click();

    await call("להתקשר", "לא ענתה", "לנסות שוב");
    await expect(page.getByRole("region", { name: "להתקשר", exact: true })).toHaveCount(0);
    await call("לנסות שוב", "שוחחנו, מחכים לתשובה", "מחכים לתשובה");
    await expect(row(page, "מחכים לתשובה", "מרצה 32")).toContainText("שוחחנו, מחכים לתשובה");
    await call("מחכים לתשובה", "הסכימה", "לסגור שעה", "נושא לדוגמה; בהתנדבות (נתון לדוגמה)");
    await expect(row(page, "לסגור שעה", "מרצה 32")).toContainText("הסכימה · עוד לא נבחרה שעה"); // approved already: nothing waits

    await row(page, "לסגור שעה", "מרצה 32").getByRole("button", { name: "שבץ" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("status").filter({ hasText: "משבצים את" })).toContainText("מרצה 32");
  });

  test("who agreed waits for the instructor: a chip, «אישור» in the row counts the badge down, then «לסגירת השעה» opens her cell", async ({ page }) => {
    await page.goto(`${demoUrl()}/mine`);
    const badge = nav(page).getByRole("link", { name: /אישורים/ });
    await expect(badge).toHaveAccessibleName("אישורים, 2 ממתינים"); // she agreed and waits; the demo's payment request
    const agreed = row(page, "הסכימו — ממתינים לאישור", "מרצה 56");
    await expect(agreed).toContainText("הסכימה · מוצעת בשלישי 20:00");
    await expect(agreed).toContainText("ממתינה לאישור");
    await expect(agreed.getByRole("button", { name: "לשיחה" })).toHaveCount(0);
    await noSidewaysScroll(page);

    await agreed.getByRole("button", { name: "אישור מרצה 56" }).click();
    await expect(toast(page, "מרצה 56 אושרה")).toBeVisible();
    await expect(badge).toHaveAccessibleName("אישורים, 1 ממתין");
    await expect(page.getByRole("region", { name: "הסכימו — ממתינים לאישור", exact: true })).toHaveCount(0);
    const ready = row(page, "לסגור שעה", "מרצה 56");
    await expect(ready.getByRole("button", { name: "מרצה 56" })).toBeFocused(); // the focus moved with the row

    await ready.getByRole("button", { name: "לסגירת השעה" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "המרצה אישרה את השעה — סגירה" })).toBeVisible();
  });

  test("«כל הצוות»: what waits for the instructor first, a block per handler in the team's order, and one sent back to the pool under «בלי אחראי/ת»", async ({ page }) => {
    await page.goto(`${demoUrl()}/mine`);
    await page.getByRole("tab", { name: "שלי" }).press("ArrowLeft"); // right to left: ← is the next tab
    await expect(page).toHaveURL(/\/mine\/team$/);
    const tab = page.getByRole("tab", { name: "כל הצוות" });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(tab).toBeFocused();
    await expect(nav(page).getByRole("link", { name: "המרצים שלי" })).toHaveAttribute("aria-current", "page");

    const board = page.getByRole("tabpanel", { name: "כל הצוות" });
    const waiting = board.getByRole("region", { name: "מחכה לאישור שלך" });
    await expect(waiting.getByRole("listitem")).toHaveCount(2);
    await expect(waiting).toContainText("מרצה 56");
    await expect(waiting).toContainText("פרופ׳ מרצה 04");
    await expect(waiting.getByRole("link", { name: "לאישורים" })).toHaveAttribute("href", "/approvals");
    // the team's order; logistics handles no speaker
    expect(await board.locator("section").evaluateAll((s) => s.map((x) => x.getAttribute("aria-label")))).toEqual(["מחכה לאישור שלך", "מדריך/ה (הדגמה)", "חניך/ה א׳", "חניך/ה ב׳", "חניך/ה ג׳"]);
    const block = (who: string) => board.getByRole("region", { name: who, exact: true });
    await expect(block("מדריך/ה (הדגמה)").locator("li").first()).toContainText("מרצה 32"); // by group: «להתקשר» first
    await expect(block("מדריך/ה (הדגמה)").locator("li").filter({ hasText: "מרצה 56" })).toContainText("ממתינה לאישור");
    await expect(block("חניך/ה א׳").locator("li").filter({ hasText: "הרב מרצה 13" })).toContainText("הוצע להעביר למדריך/ה (הדגמה)");
    await expect(block("חניך/ה ג׳").locator("li").filter({ hasText: "מרצה 23" })).toContainText("סירב");
    await expect(fold(page, "בלי אחראי/ת")).toHaveCount(0); // nobody in process without a handler
    await noSidewaysScroll(page);

    // the instructor sends one back to the pool: still in process, nobody's
    await block("חניך/ה ג׳").getByRole("button", { name: "פרופ׳ מרצה 11" }).click();
    const sheet = page.getByRole("dialog", { name: "פרופ׳ מרצה 11" });
    await sheet.getByRole("button", { name: "העברה לחבר/ת צוות" }).click();
    const form = sheet.getByRole("group", { name: "העברת הטיפול" });
    await form.getByLabel("להעביר ל…").selectOption({ label: "בחזרה למאגר, בלי מטפל/ת" });
    await form.getByRole("button", { name: "העברה", exact: true }).click();
    await expect(toast(page, /למאגר, בלי מטפל\/ת/)).toBeVisible();
    await sheet.getByRole("button", { name: "סגירה", exact: true }).click();
    const unowned = fold(page, "בלי אחראי/ת");
    await expect(unowned.locator("summary")).toHaveText(/בלי אחראי\/ת\s*1/);
    await unowned.locator("summary").click();
    await expect(unowned.locator("li").filter({ hasText: "פרופ׳ מרצה 11" })).toContainText("מחכים לתשובה");
    await expect(block("חניך/ה ג׳")).not.toContainText("מרצה 11");
    await noSidewaysScroll(page);

    await page.getByRole("tab", { name: "כל הצוות" }).press("Home");
    await expect(page).toHaveURL(/\/mine$/);
  });

  test("the approvals queue: who agreed first; the others folded, approved as a batch; a rejection — the badge counts who agreed and the requests", async ({ page }) => {
    await page.goto(demoUrl());
    const badge = nav(page).getByRole("link", { name: /אישורים/ });
    await badge.click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(badge).toHaveAccessibleName("אישורים, 2 ממתינים");
    const agreed = page.getByRole("group", { name: "הסכימו — ממתינים לאישור" });
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
    await expect(badge).toHaveAccessibleName("אישורים, 2 ממתינים");

    // who agreed, not approved, with a word to the team: the badge counts down, and her row in «המרצים שלי» says so
    await agreed.getByRole("button", { name: "דחייה מרצה 56" }).click();
    await page.getByRole("group", { name: "דחיית מרצה 56" }).getByLabel("למה? (לא חובה, גלוי לצוות)").fill("נתון לדוגמה: לא השנה");
    await page.getByRole("button", { name: "לא לאשר אותה" }).click();
    await expect(toast(page, "מרצה 56 לא אושרה")).toBeVisible();
    await expect(page.getByText("אין מרצים שהסכימו ומחכים לאישור.")).toBeVisible();
    await expect(badge).toHaveAccessibleName("אישורים, 1 ממתין");
    await noSidewaysScroll(page);

    await nav(page).getByRole("link", { name: "המרצים שלי" }).click();
    const rejected = row(page, "הסכימו — ממתינים לאישור", "מרצה 56");
    await expect(rejected).toContainText("לא אושרה");
    await expect(rejected).toContainText("«נתון לדוגמה: לא השנה»");
    await expect(rejected.getByRole("button", { name: "אישור מרצה 56" })).toHaveCount(0);
  });

  test("«אישור באצווה» of who taught in an archive, inside «עוד ממתינים לאישור»: «ביטול» gives the focus back; the badge does not count them", async ({ page }) => {
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
    await page.getByRole("radio", { name: "גיליון המעקב של אשתקד" }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "מעקב לדוגמה.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
    await page.getByLabel("שם המחזור בארכיון").fill("ארכיון לדוגמה");
    await page.getByRole("button", { name: "בדיקה מול המאגר" }).click();
    await page.getByRole("button", { name: "ייבוא", exact: true }).click();
    await page.getByRole("group", { name: "אישור", exact: true }).getByRole("button", { name: "ייבוא" }).click();
    await expect(toast(page, "הייבוא נשמר")).toBeVisible();

    await nav(page).getByRole("link", { name: /אישורים/ }).click();
    await expect(nav(page).getByRole("link", { name: /אישורים/ })).toHaveAccessibleName("אישורים, 2 ממתינים"); // the imported have no approach this edition
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
    await expect(more.getByRole("group", { name: "עוד ממתינים לאישור" }).getByRole("listitem")).toHaveCount(6); // nothing approved
    await noSidewaysScroll(page);
  });

  test("a hand-over: take the one offered to me, and move one of mine to a teammate — the team's board shows where they went", async ({ page }) => {
    await page.goto(`${demoUrl()}/mine`);
    const offered = page.getByRole("region", { name: "הוצעו לי" });
    await expect(offered).toContainText("חניך/ה א׳ מציע/ה להעביר אליך את הטיפול");
    await offered.getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect(toast(page, "הטיפול עבר אליך")).toBeVisible();
    await expect(page.getByRole("region", { name: "הוצעו לי" })).toHaveCount(0);
    await expect(row(page, "מחכים לתשובה", "הרב מרצה 13").getByRole("button", { name: "הרב מרצה 13" })).toBeFocused();

    await row(page, "להתקשר", "מרצה 32").getByRole("button", { name: "מרצה 32" }).click();
    const sheet = page.getByRole("dialog", { name: "מרצה 32" });
    await sheet.getByRole("button", { name: "העברה לחבר/ת צוות" }).click();
    const form = sheet.getByRole("group", { name: "העברת הטיפול" });
    await form.getByLabel("להעביר ל…").selectOption({ label: "חניך/ה ב׳" });
    await form.getByLabel("הערה להעברה (לא חובה)").fill("יש לה קשר עם המרצה (נתון לדוגמה)");
    await form.getByRole("button", { name: "העברה", exact: true }).click();
    await expect(toast(page, "הטיפול עבר לחניך/ה ב׳")).toBeVisible();
    await noSidewaysScroll(page);
    await sheet.getByRole("button", { name: "סגירה", exact: true }).click();
    await expect(page.getByRole("region", { name: "להתקשר", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "המרצים שלי" })).toBeFocused(); // the row left the list

    await page.getByRole("tab", { name: "כל הצוות" }).click();
    await expect(page.getByRole("region", { name: "חניך/ה ב׳", exact: true }).locator("li").filter({ hasText: "מרצה 32" })).toContainText("להתקשר");
  });
});

test.describe("mock build", () => {
  test("a content member: no approval in the rows or the board, the team's tab reads nothing new, the row's hand-over on the wire", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions and the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    const mine = (speaker: number) => week.approaches.find((a) => a.speaker_id === speaker)!;
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "member@example.org", display_name: "חבר/ת צוות", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("answer_handover", null);
    await sb.attach(page);
    const session = await signIn(page);
    sb.token = session.access_token;
    await page.goto(mockUrl());
    await nav(page).getByRole("link", { name: "המרצים שלי" }).click();
    await expect(nav(page).getByRole("link", { name: /אישורים/ })).toHaveCount(0);

    // who agreed: the chip, never «אישור» — the instructor approves
    const agreed = row(page, "הסכימו — ממתינים לאישור", "מרצה 56");
    await expect(agreed).toContainText("ממתינה לאישור");
    await expect(agreed.getByRole("button", { name: /אישור/ })).toHaveCount(0);
    await expect(row(page, "תשלום/הסעה", "מרצה 04").getByRole("button", { name: /אישור/ })).toHaveCount(0);

    await page.getByRole("region", { name: "הוצעו לי" }).getByRole("button", { name: "קבלת הטיפול" }).click();
    await expect.poll(() => sb.rpc.get("answer_handover")).toEqual([{ p_approach: mine(13).id, p_accept: true, p_note: null }]);
    for (const c of sb.calls.filter((x) => x.path === "/rest/v1/rpc/answer_handover")) expect(c.auth).toBe(`Bearer ${session.access_token}`);

    // the board is the loaded week: no list for the instructor, no call of its own
    const before = new Set(sb.rpc.keys());
    await page.getByRole("tab", { name: "כל הצוות" }).click();
    await expect(page.getByRole("region", { name: "חניך/ה א׳", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "מחכה לאישור שלך" })).toHaveCount(0);
    expect(new Set(sb.rpc.keys())).toEqual(before);
  });
});
