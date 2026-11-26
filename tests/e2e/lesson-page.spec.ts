// The lesson page (/lesson/:id, the reset, phase 2) in a real browser: a lesson's whole way on one wide page — שיבוץ →
// סגירה → תשלום והסעה → הודעת סיכום → מקורות ומצגת → מלווה — each step with where it stands and only its own action.
// Demo build `?as=trainee`, every width: a speaker proposed from their page, the call's «הסכימה», closing — and the page
// moves on to the payment and the transport, asked for approval with the pickup's address and time, then only where it
// stands; the sources and the escort; never «איך עבר». A lesson someone else handles reads only; a refused request is
// asked again. Mock build: «שליחה לאישור» is set_payment, then set_transport_request with the pickup's minute on the
// lesson's day, by the contract's parameter names, with the member's token. The reset, phase 5: a closed lesson's
// «לאתר האורחים» (#guest) under the stepper — never a seventh step —, and «מקורות ומצגת» with its «מצגות» apart (a
// second file input; a PowerPoint file on the sources' input is refused for what it is); an archive's lesson, at every
// width, reads last year's transport and has no «לאתר האורחים». v20: the staff's driver form (StaffTransport → the board's
// DriverForm) with its two suggestion lists — load_rota read only once the form opens, a pick only fills the fields, the
// cohort contact's phone read through get_rota_contacts on that click, saved through set_transport_driver alone; and each
// presentation's place on the hall's computer («במחשב של האולם: …»), the very path of the week's zip, «לדף המצגות ‹» the
// week's page with no day in its address. Synthetic people and places only.
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoDayOwners, demoWeek } from "../../src/data/demoWeek";
import type { RotaData } from "../../src/data/rota";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { noSidewaysScroll } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const step = (page: Page, key: string) => page.locator(`[data-page-step="${key}"]`);

/** A step of the page, opened. */
async function open(page: Page, key: string) {
  const toggle = step(page, key).locator("h3 button");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return step(page, key);
}

/** The demo's lessons by place (src/data/demoWeek.ts): the ids the page's address takes. */
const lessonAt = (day: number, start: number) => demoWeek().lessons.find((l) => l.day === day && l.start_min === start && l.kind === "lesson")!.id;

test.describe("demo build — a trainee", () => {
  test("from a proposal to a closed lesson; then the payment and the transport, sent for approval; the sources and the escort", async ({ page }) => {
    // a speaker of nobody's, taken and proposed on my day (Sunday 17:30) from their page
    await page.goto(`${demoUrl()}/speakers/10?as=trainee`);
    await page.locator("#call").getByRole("button", { name: "אני מטפל/ת" }).click();
    await expect(toast(page, "המרצה בטיפולך")).toBeVisible();
    await page.locator('#placement [data-place-option="0:1050"]').getByRole("button", { name: "להציע כאן" }).click();
    await expect(toast(page, /הוצעה למשבצת/)).toBeVisible();
    await page.locator("#lessons").getByRole("link", { name: "לשיעור" }).click();
    await expect(page).toHaveURL(/\/lesson\/\d+\?step=place$/);

    // the header and the six steps: a draft's last four wait for the closing
    const header = page.locator("[data-lesson-header]");
    await expect(header).toContainText("יום ראשון");
    await expect(header).toContainText("17:30–19:00");
    await expect(header).toContainText("משבצת בתהליך");
    await expect(header).toContainText("היום של חניך/ה א׳ ו-חניך/ה ב׳");
    await expect(page.locator("[data-page-step]")).toHaveCount(6);
    await expect(page.locator("#guest")).toHaveCount(0); // a draft is not on the guests' site
    for (const k of ["pay", "msg", "sources", "escort"]) {
      await expect(step(page, k)).toHaveAttribute("data-state", "na");
      await expect(step(page, k)).toContainText("אחרי הסגירה");
    }
    await noSidewaysScroll(page);

    // the call: she agreed — closing is her card's
    const card = page.locator("[data-pitch-id]").filter({ hasText: "מרצה 10" });
    await card.getByRole("button", { name: "הסכימה", exact: true }).click();
    await expect(toast(page, /הסכימה/)).toBeVisible();
    await expect(step(page, "close")).toHaveAttribute("data-state", "open");
    await card.getByRole("button", { name: "המרצה אישרה את השעה — סגירה" }).click();
    await expect(toast(page, "השיעור נסגר")).toBeVisible();
    await expect(header).toContainText("שיעור סגור");
    await expect(step(page, "close")).toHaveAttribute("data-state", "done");
    // closed: what guests will see, below the steps — the six steps unchanged
    await expect(page.locator("[data-lesson-guest] #guest")).toBeVisible();
    await expect(page.locator("[data-page-step]")).toHaveCount(6);

    // closed here: the page moves on to the payment and the transport — the focus with it (the pressed button is gone)
    const pay = step(page, "pay");
    await expect(pay.locator("h3 button")).toHaveAttribute("aria-expanded", "true");
    await expect(pay.locator("h3 button")).toBeFocused();
    const form = pay.getByRole("form", { name: "בקשת תשלום והסעה" });
    await form.getByRole("radio", { name: "הלוך ושוב" }).check();
    await form.getByRole("radio", { name: "תשלום", exact: true }).check();
    await form.getByLabel("סכום בשקלים").fill("500");
    // the pickup is asked for with a transport
    await form.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect(form.getByText("צריך כתובת ושעת איסוף.")).toBeVisible();
    await form.getByLabel("כתובת איסוף").fill("כתובת לדוגמה 1");
    await form.getByLabel("שעת איסוף").fill("16:15");
    await expect(form.getByText("הנהג/ת נקבע/ת על ידי הצוות אחרי האישור.")).toBeVisible();
    await noSidewaysScroll(page);
    await form.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect(toast(page, "הבקשה נשלחה לאישור")).toBeVisible();
    // then only where it stands: what was asked, «ממתין לאישור», and a quiet way to change it
    await expect(pay.locator("[data-approval]")).toHaveAttribute("data-approval", "pending");
    await expect(pay).toContainText("ממתין לאישור");
    await expect(pay).toContainText("כתובת לדוגמה 1");
    await expect(pay).toContainText("16:15");
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
    await expect(pay.getByRole("button", { name: "שינוי הבקשה" })).toBeVisible();
    await expect(pay).toHaveAttribute("data-state", "waiting");
    // the form went with the send: the focus to where the request stands; «שינוי הבקשה» opens it at its first choice,
    // «ביטול» gives «שינוי הבקשה» the focus back
    await expect(pay.locator("[data-approval]")).toBeFocused();
    await pay.getByRole("button", { name: "שינוי הבקשה" }).click();
    const again = pay.getByRole("form", { name: "בקשת תשלום והסעה" });
    await expect(again.getByRole("radio").first()).toBeFocused();
    await again.getByRole("button", { name: "ביטול" }).click();
    await expect(pay.getByRole("button", { name: "שינוי הבקשה" })).toBeFocused();

    // the summary message waits: no template yet, and the request is not approved
    const msg = await open(page, "msg");
    await expect(msg).toContainText("עוד אי אפשר לשלוח");

    // the sources: what arrived from the speaker
    const sources = await open(page, "sources");
    await sources.getByRole("radio", { name: "דף מקורות", exact: true }).check();
    await sources.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(toast(page, "המקורות נשמרו")).toBeVisible();

    // the escort, from the trainees' list
    const escort = await open(page, "escort");
    await escort.getByLabel("מלווה מרשימת החניכים").selectOption({ index: 1 });
    await escort.getByRole("button", { name: "שמירה", exact: true }).click();
    await expect(toast(page, "המלווה נשמר/ה")).toBeVisible();
    await expect(step(page, "escort")).toHaveAttribute("data-state", "done");

    // «איך עבר» is after the week, never on this page
    await expect(page.getByText("איך עבר")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("an address with a step opens it; a lesson someone else handles reads only; a refused request is asked again", async ({ page }) => {
    // Sunday 10:00, «פרופ׳ מרצה 03» — «חניך/ה ג׳»'s, on my day
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 600)}?step=pay&as=trainee`);
    const pay = step(page, "pay");
    await expect(pay.locator("h3 button")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-lesson-header]")).toContainText("בטיפול: חניך/ה ג׳");
    await expect(pay).toContainText("לא התבקשו תשלום או הסעה.");
    await expect(pay.getByRole("form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /פתיחה מחדש/, includeHidden: true })).toHaveCount(0);
    await noSidewaysScroll(page);

    // Monday 10:00, «ד״ר מרצה 25» — mine, the request refused with a note: the form again, «בקשה מחדש»
    await page.goto(`${demoUrl()}/lesson/${lessonAt(1, 600)}?as=trainee`);
    const refused = step(page, "pay");
    await expect(refused).toHaveAttribute("data-state", "problem");
    await expect(refused.locator("h3 button")).toHaveAttribute("aria-expanded", "true"); // the first step left to do
    await expect(refused.locator("[data-approval]")).toHaveAttribute("data-approval", "rejected");
    await expect(refused).toContainText("לבדוק שוב את הסכום");
    await refused.getByLabel("סכום בשקלים").fill("250");
    await refused.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect(toast(page, "הבקשה נשלחה לאישור")).toBeVisible();
    await expect(refused.locator("[data-approval]")).toHaveAttribute("data-approval", "pending");

    // a lesson that is not there
    await page.goto(`${demoUrl()}/lesson/99999?as=trainee`);
    await expect(page.locator("[data-lesson-missing]")).toBeVisible();
    await expect(page.getByRole("link", { name: "להיום שלי" })).toBeVisible();
  });
});

test.describe("demo build — a trainee, «מקורות ומצגת» and the guests' part", () => {
  test("the sources' files are the sources; the presentations a part of their own, with their own input; a PowerPoint file is no source; #guest below the steps", async ({ page }) => {
    // Sunday 08:30, «ד״ר מרצה 01» — mine (member 2), with a source and a presentation in the demo
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 510)}?step=sources&as=trainee`);
    const sources = step(page, "sources");
    await expect(sources.locator("h3 button")).toHaveAttribute("aria-expanded", "true");
    const files = sources.getByRole("group", { name: "קבצי המקורות" });
    const decks = sources.locator("[data-lesson-presentations]");
    await expect(decks).toHaveAttribute("id", "presentations");
    await expect(decks.getByRole("list", { name: "המצגות של השיעור" })).toContainText("מצגת לדוגמה.pdf");
    await expect(files.getByRole("list", { name: "קבצים שהועלו" })).toContainText("דף מקורות לדוגמה.pdf");
    await expect(files).not.toContainText("מצגת לדוגמה.pdf"); // «הקבצים» lists the sources only
    // two inputs: the sources' and the presentations'
    await expect(sources.locator("input[type=file]")).toHaveCount(2);
    await expect(files.locator("input[type=file]")).toHaveCount(1);
    await expect(decks.locator("input[type=file]")).toHaveCount(1);
    // a PowerPoint file on the sources' input: refused before anything is sent, saying where it goes
    await files.locator("input[type=file]").setInputFiles({
      name: "מצגת.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: Buffer.from("PK synthetic, never opened"),
    });
    await expect(files.getByRole("list", { name: "העלאות" }).getByRole("alert")).toHaveText("קובץ PowerPoint הוא מצגת: מעלים אותו ב«העלאת מצגת», לא כמקור.");
    await expect(files.getByRole("list", { name: "קבצים שהועלו" })).not.toContainText("מצגת.pptx");
    await noSidewaysScroll(page);

    // «לאתר האורחים» (#guest): under the steps, never one of them
    await expect(page.locator("[data-page-step]")).toHaveCount(6);
    const guest = page.locator("[data-lesson-guest] #guest");
    await expect(guest).toBeVisible();
    const stepper = (await page.getByRole("list", { name: "שלבי השיעור" }).boundingBox())!;
    expect((await guest.boundingBox())!.y).toBeGreaterThanOrEqual(stepper.y + stepper.height);
    await expect(page.getByRole("list", { name: "שלבי השיעור" }).locator("#guest")).toHaveCount(0);

    // an address's #presentations opens «מקורות ומצגת» at that part, its focus there
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 510)}#presentations`);
    await expect(sources.locator("h3 button")).toHaveAttribute("aria-expanded", "true");
    await expect(decks).toBeFocused();
    await expect(decks).toBeInViewport();
  });

  test("v20: each presentation says its place on the hall's computer — «במחשב של האולם: <folder> / <name>», the very entry of the week's zip; «לדף המצגות ‹» is the week's page, no day in its address", async ({ page }) => {
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 510)}?step=sources&as=trainee#presentations`);
    const decks = page.locator("[data-lesson-presentations]");
    await expect(decks).toBeFocused();
    const deck = decks.getByRole("list", { name: "המצגות של השיעור" }).locator("[data-file-row]");
    await expect(deck).toHaveCount(1);
    // Sunday (folder «1-ראשון»), 08:30, the בית מדרש — then the file's own name
    await expect(deck.locator("[data-hall-line]")).toHaveText("במחשב של האולם: 1-ראשון / 0830_בית מדרש_מצגת לדוגמה.pdf");
    const hall = (await deck.locator("[data-hall-path]").getAttribute("data-hall-path"))!;
    expect(hall).toBe("1-ראשון/0830_בית מדרש_מצגת לדוגמה.pdf");
    // the folder and the name each isolated (a room or a name may be in Latin letters)
    expect(await deck.locator("[data-hall-path] bdi").allTextContents()).toEqual(["1-ראשון", "0830_בית מדרש_מצגת לדוגמה.pdf"]);
    const toPage = decks.getByRole("link", { name: "לדף המצגות ‹" });
    await expect(toPage).toHaveAttribute("href", "/presentations");
    expect((await toPage.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
    await toPage.click();
    await expect(page).toHaveURL(/\/presentations$/);
    // the week's zip holds that file at exactly that path, its bytes the file's
    const [d] = await Promise.all([page.waitForEvent("download"), page.locator("[data-week-zip]").getByRole("button", { name: "הורדת כל המצגות של השבוע" }).click()]);
    const files = unzipSync(new Uint8Array(await readFile((await d.path())!)));
    expect(Object.keys(files)).toContain(hall);
    expect(strFromU8(files[hall].subarray(0, 5))).toBe("%PDF-");
    // and its file only there: nowhere else under another name
    expect(Object.keys(files).filter((n) => n.endsWith("_מצגת לדוגמה.pdf"))).toEqual([hall]);
  });
});

test.describe("demo build — a trainee, on another pair's day", () => {
  test("the chooser's «הצע» asks first; «ביטול» gives that «הצע» the focus back; the list for the slot is this draft's", async ({ page }) => {
    // a speaker proposed on Monday — the other pair's day — from their page, after the Confirm
    await page.goto(`${demoUrl()}/speakers/6?as=trainee`);
    const monday = page.locator('#placement [data-place-day="1"]');
    await monday.locator("summary").click();
    await monday.locator("[data-place-option]").first().getByRole("button").click();
    await monday.getByRole("group", { name: "אישור" }).getByRole("button").first().click();
    await expect(toast(page, /הוצע(ה)? /)).toBeVisible();
    await page.locator("#lessons").getByRole("link", { name: "לשיעור" }).first().click();
    await expect(page).toHaveURL(/\/lesson\/(\d+)\?step=place$/);
    const id = Number(/\/lesson\/(\d+)/.exec(page.url())![1]);

    // one more speaker for the slot, from the chooser: asked first, it is the other pair's day
    const place = step(page, "place");
    await place.getByRole("button", { name: /הצעת מרצה/ }).click();
    const pick = place.getByRole("button", { name: "הצע", exact: true }).first();
    const picked = await pick.locator("xpath=ancestor::li[1]").getAttribute("data-chooser-speaker");
    await pick.click();
    const ask = place.getByRole("group", { name: "אישור" });
    await expect(ask).toContainText("היום הזה של חניך/ה ב׳ ו-חניך/ה ג׳");
    await ask.getByRole("button", { name: "ביטול" }).click();
    await expect(ask).toHaveCount(0);
    await expect(place.locator(`[data-chooser-speaker="${picked}"]`).getByRole("button", { name: "הצע", exact: true })).toBeFocused();
    // typing in the chooser's search after the cancel leaves the focus there (no stale «follow the row»)
    await place.getByRole("searchbox", { name: "חיפוש מרצה למשבצת" }).fill("מרצה");
    await expect(place.getByRole("searchbox", { name: "חיפוש מרצה למשבצת" })).toBeFocused();

    // she declined: the card leaves for «סירבו כאן», the chooser is back — and the focus in its search
    const decline = place.locator("[data-pitch-id]").filter({ hasText: "מרצה 06" }).getByRole("button", { name: "סירבה", exact: true });
    await decline.focus();
    await decline.press("Enter");
    await expect(place.getByRole("link", { name: /לכל המרצים שמתאימים למשבצת/ })).toBeVisible();
    await expect(place.getByRole("searchbox", { name: "חיפוש מרצה למשבצת" })).toBeFocused();
    // «לכל המרצים שמתאימים למשבצת» names this draft, not only its time (a parallel twin shares it)
    await expect(place.getByRole("link", { name: /לכל המרצים שמתאימים למשבצת/ })).toHaveAttribute("href", new RegExp(`[?&]lesson=${id}(&|$)`));
  });
});

test.describe("mock build", () => {
  test("«שליחה לאישור» is set_payment, then set_transport_request with the pickup's minute — the contract's names, the member's token", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    week.dayOwners = demoDayOwners();
    // Sunday 11:30, «הרב מרצה 05»: member 2's, closed, nothing asked yet
    const lesson = week.lessons.find((l) => l.day === 0 && l.start_min === 690 && l.state === "closed")!;
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "trainee@example.org", display_name: "חניך/ה א׳", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_transport_details", { pickup_address: null, pickup_time: null, pickup_min: null, driver_name: null, driver_phone: null, arranged: false });
    sb.answers.set("set_payment", null);
    sb.answers.set("set_transport_request", null);
    await sb.attach(page);
    const session = await signIn(page, "trainee@example.org");
    sb.token = session.access_token;
    await page.goto(`${mockUrl()}/lesson/${lesson.id}?step=pay`);
    const form = step(page, "pay").getByRole("form", { name: "בקשת תשלום והסעה" });
    await form.getByRole("radio", { name: "הלוך", exact: true }).check();
    await form.getByLabel("כתובת איסוף").fill("כתובת לדוגמה 2");
    await form.getByLabel("שעת איסוף").fill("10:15");
    await form.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_request")).toEqual([
      // 10:15 on the lesson's day: minute 615, before the 11:30 start
      { p_lesson: lesson.id, p_fields: { pickup_address: "כתובת לדוגמה 2", pickup_time: "10:15", pickup_min: 615 } },
    ]);
    expect(sb.rpc.get("set_payment")).toEqual([{ p_lesson: lesson.id, p_version: lesson.version, p_pay_amount: null, p_transport: "one_way" }]);
    // in that order: the request, then its pickup
    const order = sb.calls.map((c) => c.path).filter((p) => p === "/rest/v1/rpc/set_payment" || p === "/rest/v1/rpc/set_transport_request");
    expect(order).toEqual(["/rest/v1/rpc/set_payment", "/rest/v1/rpc/set_transport_request"]);
    expect(sb.rpc.get("get_transport_details")).toContainEqual({ p_lesson: lesson.id });
    for (const fn of ["set_payment", "set_transport_request", "get_transport_details"]) {
      for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
    // never the old screens' write of the whole details, never the driver's half
    expect(sb.rpc.get("set_transport_details")).toBeUndefined();
    expect(sb.rpc.get("set_transport_driver")).toBeUndefined();
  });

  test("the request went and its pickup did not: the form stays as typed, says so, and the pickup alone goes again", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    week.dayOwners = demoDayOwners();
    const lesson = week.lessons.find((l) => l.day === 0 && l.start_min === 690 && l.state === "closed")!;
    // what the database holds once set_payment went: the request waits for approval, still without its pickup
    const after = demoWeek();
    after.edition.id = 7;
    after.edition.kind = "real";
    after.dayOwners = demoDayOwners();
    Object.assign(after.lessons.find((l) => l.id === lesson.id)!, { approval: "pending", transport: "one_way", version: lesson.version + 1 });
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "trainee@example.org", display_name: "חניך/ה א׳", global_admin: false, memberships: [{ edition_id: 7, role: "content", member_id: 2 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_transport_details", { pickup_address: null, pickup_time: null, pickup_min: null, driver_name: null, driver_phone: null, arranged: false });
    sb.answers.set("set_payment", null);
    // set_transport_request: no answer yet — the call fails (the connection lost between the two)
    const read = sb.answers.get.bind(sb.answers);
    sb.answers.get = (fn: string) => (fn === "load_week" && sb.rpc.has("set_payment") ? after : read(fn));
    await sb.attach(page);
    const session = await signIn(page, "trainee@example.org");
    sb.token = session.access_token;
    await page.goto(`${mockUrl()}/lesson/${lesson.id}?step=pay`);
    const pay = step(page, "pay");
    const form = pay.getByRole("form", { name: "בקשת תשלום והסעה" });
    await form.getByRole("radio", { name: "הלוך", exact: true }).check();
    await form.getByLabel("כתובת איסוף").fill("כתובת לדוגמה 3");
    await form.getByLabel("שעת איסוף").fill("10:15");
    await form.getByRole("button", { name: "שליחה לאישור" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_request")?.length ?? 0).toBe(1);
    // the request is «ממתין» now — and the form is still there, as typed, saying what did not go
    await expect(pay.locator("[data-approval]")).toHaveAttribute("data-approval", "pending");
    await expect(form).toBeVisible();
    await expect(form.getByLabel("כתובת איסוף")).toHaveValue("כתובת לדוגמה 3");
    await expect(form.getByLabel("שעת איסוף")).toHaveValue("10:15");
    await expect(form.getByRole("alert")).toContainText("כתובת ושעת האיסוף לא נשמרו");
    // sent again: only the pickup (the request is already what the form says)
    sb.answers.set("set_transport_request", null);
    await form.getByRole("button", { name: "שמירת פרטי האיסוף" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_request")?.length ?? 0).toBe(2);
    expect(sb.rpc.get("set_transport_request")![1]).toEqual({ p_lesson: lesson.id, p_fields: { pickup_address: "כתובת לדוגמה 3", pickup_time: "10:15", pickup_min: 615 } });
    expect(sb.rpc.get("set_payment")).toHaveLength(1);
    await expect(toast(page, "פרטי האיסוף נשמרו")).toBeVisible();
    await expect(pay.getByRole("form", { name: "בקשת תשלום והסעה" })).toHaveCount(0);
  });
});

test.describe("mock build — an archive's lesson", () => {
  test("every width: the pay step reads last year's transport — no form, no driver —; no «לאתר האורחים» (an archive is last year's)", async ({ page }) => {
    const week = demoWeek();
    week.edition = { ...week.edition, id: 9, kind: "archive", label: "ארכיון לדוגמה" };
    const lesson = week.lessons.find((l) => l.day === 0 && l.start_min === 510 && l.state === "closed")!; // an approved transport
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "admin@example.org", display_name: "מדריך/ה לדוגמה", global_admin: true, memberships: [{ edition_id: null, role: "admin", member_id: 1 }] },
    });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_import_note", null);
    sb.answers.set("get_transport_details", { pickup_address: "כתובת לדוגמה", pickup_time: "07:30", pickup_min: 450, driver_name: "נהג/ת לדוגמה", driver_phone: null, arranged: true });
    await sb.attach(page);
    sb.token = (await signIn(page, "admin@example.org")).access_token;
    await page.goto(`${mockUrl()}/lesson/${lesson.id}?step=pay`);
    const pay = await open(page, "pay");
    const read = pay.locator("[data-transport-read]");
    await expect(read).toHaveAccessibleName("פרטי ההסעה");
    await expect(read).toContainText("כתובת לדוגמה");
    await expect(read).toContainText("נהג/ת לדוגמה");
    await expect(pay.getByRole("form")).toHaveCount(0);
    await expect(pay.locator("[data-staff-transport]")).toHaveCount(0);
    await expect(pay.getByRole("button", { name: /^עריכת (פרטי ההסעה|הנהג)/ })).toHaveCount(0);
    await expect(page.locator("#guest")).toHaveCount(0);
    await expect(page.locator("[data-page-step]")).toHaveCount(6);
    await noSidewaysScroll(page);
    for (const fn of ["set_transport_details", "set_transport_driver", "set_transport_request", "set_payment", "update_lesson"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
  });
});

test.describe("mock build — the staff's driver on the lesson page (v20)", () => {
  test("the board's suggestions in the driver's form: load_rota read only once it opens; a staff pick, then a cohort's — its contact's phone on that click; saved through set_transport_driver alone", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "one width is enough for the wire format");
    const week = demoWeek();
    week.edition.id = 7;
    week.edition.kind = "real";
    week.dayOwners = demoDayOwners();
    // Wednesday 10:00, approved: the driver is the staff's to set
    const lesson = week.lessons.find((l) => l.day === 3 && l.start_min === 600 && l.kind === "lesson" && l.state === "closed")!;
    expect(lesson.approval).toBe("approved");
    const sb = new FakeSupabase({
      status: 200,
      body: { status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: "logistics@example.org", display_name: "לוגיסטיקה (הדגמה)", global_admin: false, memberships: [{ edition_id: 7, role: "logistics", member_id: 5 }] },
    });
    const rota: RotaData = {
      // a name that does not say «מכינה» itself: the pick says «צוות מכינת …» (the owner's words, plan §ו)
      cohorts: [{ id: 2, edition_id: 7, letter: "ב", name: "לדוגמה ב", trainees: 10, diet_veg: null, diet_gf: null, diet_both: null, contact_name: "איש/אשת קשר לדוגמה ב", sort: 1, can_drive: true }],
      cohortDuties: [],
      presence: [{ cohort_id: 2, day: 3, shift: 0 }],
      groups: [],
      duties: [],
      assignments: [],
      staff: [{ id: 41, edition_id: 7, day: 3, start_min: 510, end_min: 870, member_id: 5, name: "לוגיסטיקה (הדגמה)", cohort_id: null, note: null }],
      prep: [],
    };
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    sb.answers.set("get_transport_details", { pickup_address: "כתובת לדוגמה", pickup_time: "08:45", pickup_min: 525, driver_name: null, driver_phone: null, arranged: false });
    sb.answers.set("load_rota", rota);
    sb.answers.set("get_rota_contacts", [{ cohort_id: 2, phone: "000-000-0077" }]);
    sb.answers.set("set_transport_driver", null);
    await sb.attach(page);
    const session = await signIn(page, "logistics@example.org");
    sb.token = session.access_token;
    await page.goto(`${mockUrl()}/lesson/${lesson.id}?step=pay`);
    const pay = await open(page, "pay");
    const details = pay.getByRole("group", { name: "פרטי ההסעה" });
    await expect(details).toContainText("08:45");
    await page.waitForLoadState("networkidle");
    expect(sb.rpc.get("load_rota")).toBeUndefined(); // not until the form opens
    await details.getByRole("button", { name: "עריכת הנהג/ת" }).click();
    const form = details.getByRole("form", { name: /^עריכת הנהג\/ת/ });
    const suggestions = form.locator("[data-driver-suggestions]");
    await expect(suggestions.locator("[data-suggest-staff]")).toHaveText([/^לוגיסטיקה \(הדגמה\)\s*08:30–14:30$/]);
    await expect(suggestions.locator("[data-suggest-cohort]")).toHaveText(["צוות מכינת לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב"]);
    expect(sb.rpc.get("load_rota")).toEqual([{ p_edition: 7 }]);
    expect(sb.rpc.get("get_rota_contacts")).toBeUndefined();
    await suggestions.locator("[data-suggest-staff]").click();
    await expect(form.getByLabel("שם הנהג/ת")).toHaveValue("לוגיסטיקה (הדגמה)");
    await suggestions.locator("[data-suggest-cohort]").click();
    await expect(form.getByLabel("טלפון הנהג/ת")).toHaveValue("000-000-0077");
    await expect(form.getByLabel("שם הנהג/ת")).toHaveValue("צוות מכינת לדוגמה ב — איש/אשת קשר: איש/אשת קשר לדוגמה ב");
    expect(sb.rpc.get("get_rota_contacts")).toEqual([{ p_edition: 7 }]);
    // typed by hand over the pick: what is in the fields is what goes
    await form.getByLabel("שם הנהג/ת").fill("נהג/ת לדוגמה");
    await form.getByRole("button", { name: "שמירה" }).click();
    await expect.poll(() => sb.rpc.get("set_transport_driver")?.length ?? 0).toBe(1);
    expect(sb.rpc.get("set_transport_driver")![0]).toEqual({ p_lesson: lesson.id, p_fields: { driver_name: "נהג/ת לדוגמה", driver_phone: "000-000-0077" } });
    for (const fn of ["set_transport_details", "set_transport_request", "set_payment"]) expect(sb.rpc.get(fn), fn).toBeUndefined();
    expect(sb.writes).toEqual([]);
    for (const fn of ["load_rota", "get_rota_contacts", "set_transport_driver"]) {
      for (const c of sb.calls.filter((x) => x.path === `/rest/v1/rpc/${fn}`)) expect(c.auth, fn).toBe(`Bearer ${session.access_token}`);
    }
  });
});
