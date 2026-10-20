// Memorial times, «לוגיסטיקה» and the archive's additions (milestone 5ב-2) in a
// real browser, at every width. Demo build: a plan made for one of the fallen,
// placed on a slot with the picker (no drag needed), and the week's yellow card
// with the name, the family's status and the minutes; the family's contact
// person behind its button and nowhere on the week; the policy «ממתין להחלטת
// ישיבת הצוות» until set. «לוגיסטיקה»: the approved transports — the pickup
// address and the driver's phone only behind «כולל כתובות וטלפונים», in the
// page and in the CSV alike — the payments' totals and «שולם», the book orders,
// the prints by «מתי» and day with «אין קבצים»; the archive with kk.json,
// memorial.json, sources.json and, when asked, the source files in their day's
// folder. Mock build: logistics reads the transports in one get_transports_for
// call and the memorial screen without any planning control or a family's
// contact (get_fallen_contacts never called); the archive reads load_kk and the
// files through signed URLs, and names a file it could not read.
// Synthetic data only.
import { readFileSync } from "node:fs";
import { expect, type Download, type Page, type TestInfo, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoWeek } from "../../src/data/demoWeek";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("banner").getByRole("navigation", { name: "אזורי המערכת" });

async function downloaded(page: Page, click: () => Promise<void>): Promise<{ d: Download; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  return { d, bytes: readFileSync((await d.path())!) };
}

/** The week's memorial card for a day: on a phone or a tablet, that day first. */
async function weekCard(page: Page, info: TestInfo, day: string, text: string) {
  await nav(page).getByRole("link", { name: "השבוע" }).click();
  if (info.project.name !== "desktop") await page.getByRole("tab", { name: day }).click();
  return page.locator("[data-memorial-card]").filter({ hasText: text });
}

test.describe("demo build", () => {
  test("memorial times: a plan made, placed with the picker, and the week's yellow card — the family's contact only behind its button", async ({ page }, info) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    await expect(page).toHaveURL(/\/memorial$/);
    await expect(page.getByRole("heading", { name: "זמני זיכרון", level: 2 })).toBeVisible();
    await expect(page.getByText("ממתין להחלטת ישיבת הצוות")).toBeVisible();
    await expect(page.getByText("עוד לא נקבעה מדיניות.")).toBeVisible();
    const tray = page.getByRole("list", { name: "תוכניות שלא שובצו" });
    await expect(tray.locator("[data-memorial-plan]")).toHaveCount(2);
    await noSidewaysScroll(page);

    // a plan for «חלל/ה לדוגמה 4», into the tray
    await page.getByLabel("תוכנית חדשה").selectOption({ label: "חלל/ה לדוגמה 4" });
    await page.getByRole("button", { name: "+ תוכנית" }).click();
    await expect(toast(page, "התוכנית נוספה למגש")).toBeVisible();
    const plan = tray.locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 4" });
    await expect(plan).toContainText("עוד לא נוצר קשר");
    // its details: the family invited, 12 minutes
    await plan.getByRole("button", { name: "עריכת התוכנית: חלל/ה לדוגמה 4" }).click();
    const form = page.getByRole("form", { name: "עריכת התוכנית: חלל/ה לדוגמה 4" });
    await form.getByLabel("מה המשפחה אמרה").selectOption({ label: "המשפחה הוזמנה" });
    await form.getByLabel("דקות מתוכננות (לא חובה)").fill("12");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "התוכנית נשמרה")).toBeVisible();
    // placed on Monday's 13:00 slot — the picker, by keyboard or tap, no drag
    const picker = plan.getByLabel("שיבוץ");
    const monday = (await picker.locator("option", { hasText: "שני 13:00–13:15" }).first().textContent())!;
    await picker.selectOption({ label: monday });
    await expect(toast(page, "«חלל/ה לדוגמה 4» שובץ/ה")).toBeVisible();
    await expect(page.locator('[data-memorial-slot]').filter({ hasText: "חלל/ה לדוגמה 4" })).toContainText("שני 13:00–13:15");
    await noSidewaysScroll(page);

    // the family's contact person: only behind its button, an admin's
    const sunday = page.locator("[data-memorial-plan]").filter({ hasText: "חלל/ה לדוגמה 1" });
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await sunday.getByRole("button", { name: "פרטי הקשר של המשפחה" }).click();
    await expect(sunday.getByRole("group", { name: "פרטי הקשר של המשפחה: חלל/ה לדוגמה 1" })).toContainText("טלפון לדוגמה");
    await expect(sunday.getByText("מידע אישי של משפחה שכולה")).toBeVisible();

    // the week: the yellow card on Monday — the fallen's name, the family's status, the minutes; no contact
    const card = await weekCard(page, info, "שני", "חלל/ה לדוגמה 4");
    await expect(card).toContainText("זמן זיכרון – חלל/ה לדוגמה 4");
    await expect(card).toContainText("המשפחה הוזמנה · 12 דק׳");
    await expect(card).toHaveClass(/bg-amber-100/); // last year's yellow
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await card.click();
    const panel = page.getByRole("dialog", { name: "זמן זיכרון" });
    await expect(panel.getByRole("region", { name: "זמן הזיכרון" })).toContainText("המשפחה הוזמנה");
    await expect(panel.getByRole("group", { name: "קבצי המקורות" })).toContainText("עוד לא הועלו חומרים לזמן הזיכרון הזה.");
    await expect(panel.getByText("טלפון לדוגמה")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("«לוגיסטיקה»: transports (addresses and phones only when asked), payments, books, prints — each printed and downloaded", async ({ page }) => {
    await page.goto(demoUrl());
    await nav(page).getByRole("link", { name: "לוגיסטיקה" }).click();
    await expect(page).toHaveURL(/\/logistics$/);
    const rows = page.locator("[data-transport-row]");
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("2 הסעות מאושרות · סודרו 1")).toBeVisible();
    await expect(rows.first()).toContainText("נהג/ת לדוגמה");
    await expect(page.getByText("כתובת לדוגמה")).toHaveCount(0);
    await expect(page.getByText("טלפון לדוגמה")).toHaveCount(0);
    await noSidewaysScroll(page);
    const plain = await downloaded(page, () => page.getByRole("button", { name: "הורדת CSV" }).click());
    expect(plain.d.suggestedFilename()).toMatch(/^volozhin-transports-edition-1-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = plain.bytes.toString("utf8");
    expect(csv).toContain("נהג/ת לדוגמה");
    expect(csv).not.toMatch(/כתובת לדוגמה|טלפון לדוגמה|כתובת איסוף/);
    await page.getByRole("checkbox", { name: "כולל כתובות וטלפונים" }).check();
    await expect(rows.first()).toContainText("כתובת לדוגמה");
    await expect(rows.first()).toContainText("טלפון לדוגמה");
    const full = await downloaded(page, () => page.getByRole("button", { name: "הורדת CSV" }).click());
    expect(full.d.suggestedFilename()).toMatch(/^volozhin-transports-with-addresses-phones-/);
    expect(full.bytes.toString("utf8")).toContain("כתובת לדוגמה");
    await expect(toast(page, "יש בו כתובות וטלפונים")).toBeVisible();
    // «סודר» on the second
    await rows.nth(1).getByRole("button", { name: "סימון «סודר»" }).click();
    await expect(toast(page, "סומן שההסעה סודרה")).toBeVisible();
    await expect(page.getByText("2 הסעות מאושרות · סודרו 2")).toBeVisible();
    // the print view: the file's own table, addresses included only because the toggle is on
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("table").filter({ hasText: "כתובת איסוף" })).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "תשלומים" }).click();
    const totals = page.getByRole("definition").filter({ hasText: "₪" });
    await expect(page.getByLabel("סיכום התשלומים")).toContainText("סה״כ מאושר");
    await expect(page.locator("[data-payment-row]")).toHaveCount(2);
    await expect(totals.first()).toBeVisible();
    const unpaid = page.locator("[data-payment-row]").filter({ hasText: "טרם שולם" });
    await unpaid.getByRole("button", { name: /^סימון ששולם/ }).click();
    await expect(toast(page, "סומן ששולם")).toBeVisible();
    await expect(page.locator("[data-payment-row]").filter({ hasText: "טרם שולם" })).toHaveCount(0);
    const pay = await downloaded(page, () => page.getByRole("button", { name: "הורדת xlsx" }).click());
    const sheet = strFromU8(unzipSync(new Uint8Array(pay.bytes))["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("סה״כ");
    await noSidewaysScroll(page);

    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "ספרים" }).click();
    await expect(page.locator("[data-book-row]")).toHaveCount(3);
    const book = page.locator("[data-book-row]").first();
    await book.getByLabel("עותקים להזמנה").fill("7");
    await book.getByRole("checkbox", { name: "הוזמן" }).check();
    await book.getByRole("button", { name: "שמירה" }).click();
    await expect(toast(page, "הזמנת הספרים נשמרה")).toBeVisible();
    await expect(page.getByText("· הוזמנו 1")).toBeVisible();
    await noSidewaysScroll(page);

    await page.getByRole("navigation", { name: "לוגיסטיקה" }).getByRole("link", { name: "הדפסות" }).click();
    const ahead = page.getByRole("region", { name: "להדפיס מראש" });
    await expect(ahead.locator("[data-print-row]").first()).toContainText("דף מקורות לדוגמה.pdf");
    await expect(ahead.locator("[data-print-row]").first()).toContainText("עמודים");
    await expect(page.getByRole("region", { name: "להדפיס באותו יום" }).locator("[data-print-row]")).toContainText(["אין קבצים"]);
    await expect(page.locator("[data-print-row]").filter({ hasText: /עותקים/ })).toHaveCount(0); // no copy count nobody entered
    await noSidewaysScroll(page);
  });

  test("the archive: kk.json, memorial.json, sources.json — and the source files in their day's folder when asked", async ({ page }) => {
    await page.goto(`${demoUrl()}/settings/edition`);
    await expect(page.getByText("פרטי הקשר של המשפחות לא יוצאים מהמערכת בשום ייצוא אחר")).toBeVisible();
    await page.getByRole("checkbox", { name: "כולל קבצי המקורות" }).check();
    await expect(page.getByText(/^\d+ קבצים, כ-[\d.]+(KB|MB), בתיקייה לכל יום/)).toBeVisible();
    await noSidewaysScroll(page);
    const zip = await downloaded(page, () => page.getByRole("button", { name: "הורדת הארכיון של הדגמה" }).click());
    const files = unzipSync(new Uint8Array(zip.bytes));
    for (const f of ["kk.json", "memorial.json", "sources.json", "edition.json", "PERSONAL-DATA_contacts_and_transport.json"]) expect(Object.keys(files)).toContain(f);
    const kk = JSON.parse(strFromU8(files["kk.json"]));
    expect(kk.groups.map((g: { title: string }) => g.title)).toContain("ספר לדוגמה א׳");
    expect(kk.signups.every((s: { name: string | null }) => typeof s.name === "string")).toBe(true);
    const memorial = JSON.parse(strFromU8(files["memorial.json"]));
    expect(memorial.fallen).toHaveLength(9);
    expect(strFromU8(files["memorial.json"])).not.toContain("טלפון לדוגמה");
    expect(JSON.parse(strFromU8(files["PERSONAL-DATA_contacts_and_transport.json"])).family_contacts).toEqual([expect.objectContaining({ fallen: "חלל/ה לדוגמה 1" })]);
    const sources = Object.keys(files).filter((k) => k.startsWith("sources/"));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((k) => k.startsWith("sources/1-ראשון/") && k.endsWith("דף מקורות לדוגמה.pdf"))).toBe(true);
    expect(strFromU8(files[sources.find((k) => k.endsWith(".pdf"))!].subarray(0, 4))).toBe("%PDF");
    await expect(toast(page, "הארכיון ירד")).toBeVisible();
  });
});

test.describe("mock build", () => {
  const signedIn = async (page: Page, role: "logistics" | "admin", global: boolean) => {
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    const email = `${role}@example.org`;
    const sb = new FakeSupabase({
      status: 200,
      body: {
        status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email, display_name: "חבר/ת צוות לדוגמה", global_admin: global,
        memberships: [{ edition_id: global ? null : 7, role, member_id: 5 }],
      },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    const session = await signIn(page, email);
    sb.token = session.access_token;
    return { sb, week, session };
  };

  test("logistics: the transports in one get_transports_for call; memorial times read-only, no family's contact asked for", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const { sb, week, session } = await signedIn(page, "logistics", false);
    const ride = week.lessons.find((l) => l.state === "closed" && l.transport !== "none" && l.approval === "approved")!;
    sb.answers.set("get_transports_for", [{ lesson_id: ride.id, pickup_address: "כתובת מהשרת לדוגמה", pickup_time: "07:00", driver_name: "נהג/ת מהשרת", driver_phone: null, arranged: false }]);
    await page.goto(`${mockUrl()}/logistics`);
    await expect(page.locator(`[data-transport-row="${ride.id}"]`)).toContainText("נהג/ת מהשרת");
    expect(sb.rpc.get("get_transports_for")).toEqual([{ p_edition: 7 }]);
    expect(sb.calls.find((c) => c.path === "/rest/v1/rpc/get_transports_for")!.auth).toBe(`Bearer ${session.access_token}`);
    // a lesson whose details did not come back says so — nothing is made up
    const other = page.locator("[data-transport-row]").filter({ hasNotText: "נהג/ת מהשרת" }).first();
    await expect(other).toContainText("פרטי ההסעה גלויים רק");
    expect(sb.rpc.get("get_transport_details")).toBeUndefined(); // never one lesson at a time here

    await nav(page).getByRole("link", { name: "זמני זיכרון" }).click();
    await expect(page.locator("[data-memorial-plan]").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "+ תוכנית" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "פרטי הקשר של המשפחה" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^הוספת זמן זיכרון/ })).toHaveCount(0);
    await expect(page.getByLabel("שיבוץ")).toHaveCount(0);
    await expect(page.getByText("את התוכניות ואת השיבוץ עושים המדריכים.")).toBeVisible();
    expect(sb.rpc.get("get_fallen_contacts")).toBeUndefined();
    expect(sb.calls.some((c) => c.path === "/rest/v1/fallen_contacts")).toBe(false);
  });

  test("a content member has no «לוגיסטיקה»: not in the header, and its address lands on the week", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the permissions");
    const week = demoWeek();
    week.edition.id = 7;
    const sb = new FakeSupabase({ status: 200, body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "content@example.org", display_name: "חבר/ת צוות לדוגמה", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] } });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    sb.token = (await signIn(page, "content@example.org")).access_token;
    await page.goto(`${mockUrl()}/logistics/transports`);
    await expect(page).toHaveURL(new RegExp(`${mockUrl()}/$`));
    await expect(nav(page).getByRole("link", { name: "לוגיסטיקה" })).toHaveCount(0);
    expect(sb.rpc.get("get_transports_for")).toBeUndefined();
  });

  test("the archive reads load_kk, the fallen, and each file through a signed URL — one it could not read is named", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire");
    const { sb, week } = await signedIn(page, "admin", true);
    const lesson = week.lessons.find((l) => l.id === 1)!;
    week.sourceFiles = [
      { id: 1, lesson_id: lesson.id, cover: false, speaker_id: null, fallen_id: null, storage_path: "7/1/00000000-0000-4000-8000-000000000001-a.pdf", display_name: "קובץ א.pdf", mime: "application/pdf", size_bytes: 9, page_count: 1, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z" },
      { id: 2, lesson_id: lesson.id, cover: false, speaker_id: null, fallen_id: null, storage_path: "7/1/00000000-0000-4000-8000-000000000002-b.pdf", display_name: "קובץ ב.pdf", mime: "application/pdf", size_bytes: 9, page_count: 1, uploaded_by: 1, uploaded_at: "2026-11-01T00:00:00Z" },
    ];
    sb.storageFiles.set(week.sourceFiles[0].storage_path, Buffer.from("%PDF-1.7 synthetic", "latin1"));
    sb.answers.set("load_kk", { tracks: [], groups: [], leaders: [], signups: [], orders: [] });
    sb.tables.set("fallen", [{ id: 3, name: "חלל/ה לדוגמה 3", gender: null, note: null, active: true }]);
    sb.answers.set("get_fallen_contacts", null);
    await page.goto(`${mockUrl()}/settings/edition`);
    await page.getByRole("checkbox", { name: "כולל קבצי המקורות" }).check();
    await expect(page.getByText("2 קבצים, כ-")).toBeVisible();
    const zip = await downloaded(page, () => page.getByRole("button", { name: /^הורדת הארכיון/ }).click());
    const files = unzipSync(new Uint8Array(zip.bytes));
    expect(Object.keys(files).filter((k) => k.startsWith("sources/"))).toEqual(["sources/1-ראשון/0830_1_קובץ א.pdf"]);
    expect(JSON.parse(strFromU8(files["sources.json"])).files.find((f: { id: number }) => f.id === 2)).toMatchObject({ not_read: true, in_zip: null });
    expect(JSON.parse(strFromU8(files["memorial.json"])).fallen).toEqual([{ id: 3, name: "חלל/ה לדוגמה 3", gender: null, note: null, active: true }]);
    expect(sb.rpc.get("load_kk")).toEqual([{ p_edition: 7 }]);
    expect(sb.rpc.get("get_fallen_contacts")).toEqual([{ p_fallen: 3 }]);
    expect(sb.storage.filter((s) => s.method === "POST" && s.path === "/storage/v1/object/sign/sources")).toHaveLength(1);
    await expect(page.getByRole("alert").filter({ hasText: "קובץ אחד לא נקרא ולא נכלל:" })).toContainText("קובץ ב.pdf");
  });
});
