// «מצגות» (/presentations, the reset, phase 5) in a real browser — the team's page to upload, check and download the
// day's presentations: the hall's computer is not signed in, so every morning someone downloads «כל המצגות של היום» and
// copies it there on a USB stick. Demo build, every width: the day tabs and the room chips in the address (the room kept
// on this device), each row's state («מצגת» / «קישור למצגת» / «מצגת צפויה — עוד לא הועלתה» / «בלי מצגת» / «זמן זיכרון»,
// never a name), the week's deck, a PDF opening in a new tab, a link in a new tab, a file of the wrong type refused for
// what it is; the zip — unzipped here: its entries named and ordered as the day runs, the week's deck first, «סדר-היום.txt»
// and «links.txt» (UTF-8 with a BOM, CRLF), a room's zip with that room's files only — and this device's memory of the
// download, a later upload marked «חדש מאז ההורדה»; a PowerPoint file uploaded from the lesson page's «מצגות», downloaded
// under its Hebrew name, its removal asked once; logistics read and download, with no input and no «הסרה»; a trainee
// opens the page by address and uploads to a lesson, never the week's deck. Mock build: an upload goes to Storage first,
// with the member's token, then register_source_file with p_kind «presentation» and no page count (the week's deck on the
// cover path, p_lesson null); a download and the zip go through ONE batch sign and a GET per file, the bytes as stored;
// logistics never register; the week is read again every two minutes while the tab is visible, and on «רענון».
// Synthetic files and names only (the demo's PDFs are made in the browser; a pptx here is a few bytes, never opened).
import { readFile } from "node:fs/promises";
import { expect, type Download, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoWeek, seedDemoPresentations, seedDemoSources } from "../../src/data/demoWeek";
import { PPTX } from "../../src/data/sourceRules";
import { errorMessage } from "../../src/errors";
import { israelDay } from "../../src/exports/download";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { goSection, noSidewaysScroll, sectionLink } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const row = (page: Page, lessonId: number) => page.locator(`[data-presentation-row="${lessonId}"]`);
const zipButton = (page: Page) => page.locator("[data-day-zip]").getByRole("button", { name: "הורדת כל המצגות של היום" });
/** With a room chip chosen, the card names the room (the review): its button, its heading, its line. */
const roomZipButton = (page: Page, room: string) => page.locator("[data-day-zip]").getByRole("button", { name: `הורדת המצגות של ${room}`, exact: true });

/** The demo's lessons by place (src/data/demoWeek.ts): the ids the rows carry. */
const lessonAt = (day: number, start: number, kind: "lesson" | "memorial" = "lesson", room = 1) =>
  demoWeek().lessons.find((l) => l.kind === kind && l.day === day && l.start_min === start && l.room_id === room)!.id;

/** The demo's presentations (seedDemoPresentations, after the four sources): Sunday 08:30's, Tuesday 16:00 room 2's, the week's. */
const SUNDAY_DECK = 5;
const TUESDAY_DECK = 6;
const WEEK_DECK = 7;
const WEEK_DECK_NAME = "המצגת המלווה לשבוע (לדוגמה).pdf";

const pptx = (name: string) => ({ name, mimeType: PPTX, buffer: Buffer.from("PK synthetic pptx, never opened") });
const pdfFile = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% synthetic, never opened\n") });

/** A download and its bytes. */
async function downloaded(page: Page, click: () => Promise<void>): Promise<{ d: Download; bytes: Buffer }> {
  const [d] = await Promise.all([page.waitForEvent("download"), click()]);
  return { d, bytes: await readFile((await d.path())!) };
}

/** A zip's entries in its own order (fflate reads the central directory in order), the names as stored. */
function entries(zip: Buffer): { names: string[]; files: Record<string, Uint8Array> } {
  const files = unzipSync(new Uint8Array(zip));
  return { names: Object.keys(files), files };
}

/** A text file of the zip: UTF-8 with a BOM (its three bytes — a decoder drops them), CRLF lines. */
function textLines(bytes: Uint8Array): string[] {
  expect([...bytes.subarray(0, 3)], "UTF-8 with a BOM").toEqual([0xef, 0xbb, 0xbf]);
  const text = strFromU8(bytes.subarray(3));
  expect(text.endsWith("\r\n")).toBe(true);
  expect(text.replace(/\r\n/g, "")).not.toContain("\n"); // every line ends CRLF
  return text.split("\r\n").slice(0, -1);
}

/**
 * The names the page hands its downloads under — the `download` of each link it clicks (src/exports/download.ts). A
 * Hebrew name is the person's file name in a browser; headless Chromium alone saves it as «download» (download.ts says
 * so, and keeps its own files' names ASCII), so the name is read where the page gives it.
 */
async function recordDownloadNames(page: Page) {
  await page.addInitScript(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      const w = window as unknown as { __downloadNames?: string[] };
      if (this.hasAttribute("download")) (w.__downloadNames ??= []).push(this.download);
      return click.call(this);
    };
  });
}
const downloadNames = (page: Page) => page.evaluate(() => (window as unknown as { __downloadNames?: string[] }).__downloadNames ?? []);

const zipName = (what: string) => `volozhin-presentations-${what}-edition-1-${israelDay()}.zip`;

test.describe("demo build — the staff", () => {
  test("the day tabs and the room chips in the address — the room kept on this device —, each row's state, the week's deck, a PDF and a link in a new tab, a wrong type refused for what it is", async ({ page }) => {
    await page.goto(demoUrl());
    await goSection(page, "מצגות");
    await expect(page).toHaveURL(/\/presentations$/);
    await expect(page.locator("[data-presentations]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "מצגות", level: 2 })).toBeVisible();

    // the week's date is TBD in the demo: the page opens on Sunday
    const tabs = page.getByRole("navigation", { name: "ימי השבוע" }).locator("[data-day-tab]");
    await expect(tabs).toHaveText(["ראשון", "שני", "שלישי", "רביעי", "חמישי"]);
    await expect(page.locator('[data-day-tab="0"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-room]")).toHaveCount(0); // one room on Sunday: no chips

    // Sunday's rows in the day's order: a file, a link, none, the two memorial times (nameless), none, the night's none
    const rows = page.locator("[data-presentation-row]");
    const sunday = [lessonAt(0, 510), lessonAt(0, 600), lessonAt(0, 690), lessonAt(0, 780, "memorial"), lessonAt(0, 855, "memorial"), lessonAt(0, 870), lessonAt(0, 1470)];
    expect(await rows.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-presentation-row"))))).toEqual(sunday);
    expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-state")))).toEqual(["file", "link", "none", "memorial", "memorial", "none", "none"]);
    // 00:30 under Sunday is the night after it: said as the guests' schedule says it (the review)
    await expect(row(page, sunday[6]).locator("[data-night]")).toHaveText("ליל ראשון–שני");
    await expect(page.locator("[data-presentation-row] [data-night]")).toHaveCount(1);
    const opening = row(page, sunday[0]);
    await expect(opening).toContainText("ד״ר מרצה 01 · פתיחת השבוע (לדוגמה)");
    await expect(opening).toContainText("מצגת לדוגמה.pdf");
    await expect(opening).toContainText("PDF");
    await expect(opening.getByRole("link", { name: "ד״ר מרצה 01 · פתיחת השבוע (לדוגמה)" })).toHaveAttribute("href", `/lesson/${sunday[0]}?step=sources#presentations`);
    const open = opening.locator(`[data-presentation-file="${SUNDAY_DECK}"]`);
    await expect(open).toHaveAttribute("data-action", "open");
    await expect(open).toHaveText("פתיחה");
    const link = row(page, sunday[1]).getByRole("link", { name: "פתיחת הקישור" });
    await expect(row(page, sunday[1])).toContainText("קישור למצגת");
    await expect(link).toHaveAttribute("href", "https://slides.example/presentation-demo");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(row(page, sunday[2])).toContainText("בלי מצגת");
    for (const m of [sunday[3], sunday[4]]) {
      await expect(row(page, m)).toContainText("זמן זיכרון");
      await expect(row(page, m)).not.toContainText("חלל/ה"); // never a name
      await expect(row(page, m).locator("input[type=file]")).toHaveCount(0);
    }

    // the week's deck, and the day's zip: the deck and Sunday's file, their size
    const deck = page.locator("[data-week-presentation]");
    await expect(deck.getByRole("heading", { name: "המצגת של השבוע" })).toBeVisible();
    await expect(deck.locator(`[data-file-row="${WEEK_DECK}"]`)).toContainText(WEEK_DECK_NAME);
    await expect(deck.locator('[data-upload-presentation="week"]')).toBeVisible();
    await expect(page.locator("[data-day-zip]")).toHaveAttribute("data-total-bytes", String(640_000 + 220_000));
    await expect(page.locator("[data-day-zip]")).toContainText("2 מצגות · כ-0.8 MB");
    await expect(page.getByRole("heading", { name: "המצגות של יום ראשון" })).toBeVisible();
    await noSidewaysScroll(page);

    // a PDF opens in a new tab, from the file itself. What the tab then shows is the browser's: CI's headless shell has
    // no PDF viewer (it downloads, the tab's address stays empty), so the test reads what was asked of window.open and
    // the file at that address.
    await page.evaluate(() => {
      const w = window as unknown as { __opened: string[][] };
      w.__opened = [];
      const real = window.open.bind(window);
      window.open = ((...args: Parameters<typeof window.open>) => {
        w.__opened.push(args.map(String));
        return real(...args);
      }) as typeof window.open;
    });
    const [tab] = await Promise.all([page.context().waitForEvent("page"), open.click()]);
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[][] }).__opened);
    expect(opened).toEqual([[expect.stringMatching(/^blob:/), "_blank", "noopener,noreferrer"]]);
    const head = await page.evaluate(async (u) => new TextDecoder().decode((await (await fetch(u)).arrayBuffer()).slice(0, 5)), opened[0][0]);
    expect(head).toBe("%PDF-");
    await tab.close();

    // the wrong type for a lesson; Word for the week's deck — each refused in the browser, in its own words
    await row(page, sunday[2]).locator("input[type=file]").setInputFiles({ name: "הערות.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic") });
    await expect(row(page, sunday[2]).getByRole("alert")).toHaveText(errorMessage("presentation_bad_file"));
    await deck.locator("input[type=file]").setInputFiles({ name: "מסמך.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK synthetic") });
    await expect(deck.getByRole("alert")).toHaveText(errorMessage("week_presentation_bad_file"));
    await expect(row(page, sunday[2])).toHaveAttribute("data-state", "none");

    // Tuesday: two rooms at 16:00 — the expected one not uploaded yet, the other's file
    await page.locator('[data-day-tab="2"]').click();
    await expect(page).toHaveURL(/\/presentations\?day=2$/);
    await expect(page.locator('[data-day-tab="2"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-day-tab="0"]')).not.toHaveAttribute("aria-current", "page");
    const bm = lessonAt(2, 960, "lesson", 1);
    const parallel = lessonAt(2, 960, "lesson", 2);
    expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-state")))).toEqual(["none", "none", "memorial", "memorial", "missing", "file"]);
    await expect(row(page, bm)).toContainText("מצגת צפויה — עוד לא הועלתה");
    await expect(row(page, parallel)).toContainText("שקפים לדוגמה.pdf");
    const chips = page.getByRole("group", { name: "חדר" });
    await expect(chips.getByRole("button")).toHaveText(["כל החדרים", "בית מדרש", "כיתת בית מדרש"]);
    await expect(page.locator('[data-room="all"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-room="2"]').click();
    await expect(page).toHaveURL(/\/presentations\?day=2&room=2$/);
    await expect(page.locator('[data-room="2"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-room="all"]')).toHaveAttribute("aria-pressed", "false");
    await expect(rows).toHaveCount(1);
    await expect(row(page, parallel)).toBeVisible();
    await expect(page.locator("[data-day-zip]")).toHaveAttribute("data-total-bytes", String(410_000 + 220_000));
    // the card says the zip is that room's — never «כל המצגות של היום» for one room (the review)
    const card = page.locator("[data-day-zip]");
    await expect(card.getByRole("heading", { level: 3 })).toHaveText("המצגות של יום שלישי · כיתת בית מדרש");
    await expect(roomZipButton(page, "כיתת בית מדרש")).toBeVisible();
    await expect(zipButton(page)).toHaveCount(0);
    await expect(card.locator("[data-zip-room]")).toHaveText("בקובץ רק כיתת בית מדרש והמצגת של השבוע. לכל החדרים בוחרים «כל החדרים».");
    await noSidewaysScroll(page);

    // the room is this device's choice: the page opened again without it takes it back into the address — and the
    // card still says so
    await page.goto(`${demoUrl()}/presentations?day=2`);
    await expect(page).toHaveURL(/\/presentations\?day=2&room=2$/);
    await expect(page.locator('[data-room="2"]')).toHaveAttribute("aria-pressed", "true");
    await expect(roomZipButton(page, "כיתת בית מדרש")).toBeVisible();
    await page.locator('[data-room="all"]').click();
    await expect(page).toHaveURL(/\/presentations\?day=2$/);
    await expect(rows).toHaveCount(6);
    await expect(zipButton(page)).toBeVisible();
    await expect(card.getByRole("heading", { level: 3 })).toHaveText("המצגות של יום שלישי");
    await expect(card.locator("[data-zip-room]")).toHaveCount(0);
    await page.goto(`${demoUrl()}/presentations?day=2`);
    await expect(page.locator('[data-room="all"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\/presentations\?day=2$/);
  });

  test("the day's zip: the week's deck first, then the day in its order, with «סדר-היום.txt» and «links.txt»; this device remembers it, a later upload is «חדש מאז ההורדה»; a room's zip has that room's files", async ({ page }, info) => {
    await page.goto(`${demoUrl()}/presentations`);
    await expect(page.locator("[data-since-download]")).toHaveCount(0);
    // a phone may download, and is told a computer is better
    await expect(page.locator("[data-day-zip]").getByText("עדיף במחשב")).toBeVisible({ visible: info.project.name === "phone" });

    const first = await downloaded(page, () => zipButton(page).click());
    expect(first.d.suggestedFilename()).toBe(zipName("day1"));
    const z = entries(first.bytes);
    expect(z.names).toEqual(["סדר-היום.txt", "links.txt", `0000_השבוע_${WEEK_DECK_NAME}`, "0830_בית מדרש_מצגת לדוגמה.pdf"]);
    for (const n of z.names.slice(2)) expect(strFromU8(z.files[n].subarray(0, 5)), n).toBe("%PDF-");
    const order = textLines(z.files["סדר-היום.txt"]);
    expect(order[0]).toBe("סדר היום — יום ראשון · TBD · הדגמה");
    expect(order[1]).toBe(`המצגת של השבוע — 0000_השבוע_${WEEK_DECK_NAME}`);
    expect(order[2]).toBe("");
    expect(order.slice(3)).toEqual([
      "08:30–09:45 · בית מדרש · ד״ר מרצה 01 · פתיחת השבוע (לדוגמה) — 0830_בית מדרש_מצגת לדוגמה.pdf",
      "10:00–11:15 · בית מדרש · פרופ׳ מרצה 03 · שיעור לדוגמה 2 — קישור: https://slides.example/presentation-demo",
      "11:30–12:45 · בית מדרש · הרב מרצה 05 · שיעור לדוגמה 3 — בלי מצגת",
      "13:00–13:15 · בית מדרש · זמן זיכרון",
      "14:15–14:30 · בית מדרש · זמן זיכרון",
      "14:30–15:45 · בית מדרש · מרצה 07 · שיעור לדוגמה 4 — בלי מצגת",
      "00:30–01:45 · בית מדרש · ד״ר מרצה 02 · שיעור לדוגמה 6 — בלי מצגת",
    ]);
    expect(textLines(z.files["links.txt"])).toEqual(["קישורים למצגות — יום ראשון · TBD · הדגמה", "", "10:00 · פרופ׳ מרצה 03 · https://slides.example/presentation-demo"]);
    await expect(toast(page, "ירדו 2 מצגות")).toBeVisible();
    await expect(zipButton(page)).toBeFocused();

    // this device remembers the download (localStorage, per edition and day) — the newest upload it held, by the server's clock
    const since = page.locator("[data-since-download]");
    await expect(since).toContainText(/ההורדה האחרונה במכשיר הזה: \d{2}:\d{2}/);
    await expect(since).not.toContainText("עלו מאז");
    const marker = JSON.parse((await page.evaluate(() => localStorage.getItem("volozhin-presentations-zip:1:0")))!);
    expect(marker).toMatchObject({ upTo: "2026-11-16T11:00:00Z", room: null });

    // a presentation uploaded after it: marked on its row and counted under the button
    const late = lessonAt(0, 690);
    await row(page, late).locator("input[type=file]").setInputFiles(pdfFile("מצגת מאוחרת לדוגמה.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    await expect(row(page, late)).toHaveAttribute("data-state", "file");
    await expect(row(page, late).locator("[data-new-since]")).toHaveText("חדש מאז ההורדה");
    await expect(row(page, lessonAt(0, 510)).locator("[data-new-since]")).toHaveCount(0);
    await expect(page.locator("[data-week-presentation] [data-new-since]")).toHaveCount(0);
    await expect(since.getByRole("status")).toHaveText(/^עלו מאז ההורדה ב-\d{2}:\d{2}: 1$/);
    // its sources are still «טרם התקבלו»: the page says how to mark «מצגת», on the lesson page
    await expect(row(page, late).getByRole("status")).toContainText("המקורות עדיין מסומנים «טרם התקבלו». אם יש רק מצגת, מסמנים «מצגת» בעמוד השיעור.");
    await expect(row(page, late).getByRole("link", { name: "לעמוד השיעור ‹" })).toHaveAttribute("href", `/lesson/${late}?step=sources`);
    await expect(page.locator("[data-day-zip]")).toContainText("3 מצגות");

    // downloaded again: it is in the zip, in its place, and nothing is new any more
    const second = entries((await downloaded(page, () => zipButton(page).click())).bytes);
    expect(second.names).toEqual(["סדר-היום.txt", "links.txt", `0000_השבוע_${WEEK_DECK_NAME}`, "0830_בית מדרש_מצגת לדוגמה.pdf", "1130_בית מדרש_מצגת מאוחרת לדוגמה.pdf"]);
    expect(textLines(second.files["סדר-היום.txt"])).toContain("11:30–12:45 · בית מדרש · הרב מרצה 05 · שיעור לדוגמה 3 — 1130_בית מדרש_מצגת מאוחרת לדוגמה.pdf");
    await expect(toast(page, "ירדו 3 מצגות")).toBeVisible();
    await expect(page.locator("[data-new-since]")).toHaveCount(0);
    await expect(since).not.toContainText("עלו מאז");

    // Tuesday's כיתת בית מדרש alone: the week's deck and that room's file — no links.txt (no link there)
    await page.locator('[data-day-tab="2"]').click();
    await expect(page.locator("[data-since-download]")).toHaveCount(0); // another day: its own memory
    await page.locator('[data-room="2"]').click();
    await expect(page).toHaveURL(/\/presentations\?day=2&room=2$/);
    const room = await downloaded(page, () => roomZipButton(page, "כיתת בית מדרש").click());
    expect(room.d.suggestedFilename()).toBe(zipName("day3-room2"));
    const r = entries(room.bytes);
    expect(r.names).toEqual(["סדר-היום.txt", `0000_השבוע_${WEEK_DECK_NAME}`, "1600_כיתת בית מדרש_שקפים לדוגמה.pdf"]);
    expect(textLines(r.files["סדר-היום.txt"])).toEqual([
      "סדר היום — יום שלישי · TBD · הדגמה · כיתת בית מדרש",
      `המצגת של השבוע — 0000_השבוע_${WEEK_DECK_NAME}`,
      "",
      "16:00–17:15 · כיתת בית מדרש · ד״ר מרצה 17 · שיעור לדוגמה 16 — 1600_כיתת בית מדרש_שקפים לדוגמה.pdf",
    ]);
    await expect(toast(page, "ירדו 2 מצגות")).toBeVisible();
    await expect(page.locator("[data-since-download]")).toContainText("(רק כיתת בית מדרש)");
    await noSidewaysScroll(page);
  });

  test("a PowerPoint file from the lesson page's «מצגות»: on the day's list with «הורדה», downloaded under its own name; its removal asked once", async ({ page }) => {
    const l = lessonAt(0, 690); // Sunday 11:30, nothing uploaded
    await recordDownloadNames(page);
    await page.goto(`${demoUrl()}/lesson/${l}?step=sources#presentations`);
    const part = page.locator("[data-lesson-presentations]");
    await expect(part).toBeFocused();
    await expect(part).toContainText("בלי מצגת");
    await expect(part).toContainText("לא הועלתה מצגת לשיעור הזה.");
    // the step has two inputs: on the sources' one a PowerPoint file is refused for what it is — its place is «מצגות»
    const sources = page.locator('[data-page-step="sources"]').getByRole("group", { name: "קבצי המקורות" });
    await sources.locator("input[type=file]").setInputFiles(pptx("מצגת השיעור לדוגמה.pptx"));
    await expect(sources.getByRole("alert")).toHaveText(errorMessage("pptx_source"));
    await expect(part.locator("input[type=file]")).toHaveCount(1);
    await part.locator("input[type=file]").setInputFiles(pptx("מצגת השיעור לדוגמה.pptx"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    const list = part.getByRole("list", { name: "המצגות של השיעור" });
    await expect(list).toContainText("מצגת השיעור לדוגמה.pptx");
    await expect(list).toContainText("PowerPoint");
    await expect(part).toContainText("מצגת");
    await expect(list.getByRole("button", { name: "הורדה" })).toHaveAttribute("data-action", "download");
    // on the lesson page itself, the «טרם התקבלו» line needs no link to it
    await expect(part.getByRole("status")).toContainText("המקורות עדיין מסומנים «טרם התקבלו».");
    await expect(part.getByRole("link", { name: "לעמוד השיעור ‹" })).toHaveCount(0);

    // «לדף המצגות ‹»: the lesson's day and room
    await part.getByRole("link", { name: "לדף המצגות ‹" }).click();
    await expect(page).toHaveURL(/\/presentations\?day=0&room=1$/);
    const r = row(page, l);
    await expect(r).toHaveAttribute("data-state", "file");
    const file = r.locator("[data-presentation-file]");
    await expect(file).toHaveAttribute("data-action", "download");
    await expect(file).toHaveText("הורדה");
    // fetched, then handed over under its Hebrew name — not the stored ASCII one
    const got = await downloaded(page, () => file.click());
    expect(await downloadNames(page)).toEqual(["מצגת השיעור לדוגמה.pptx"]);
    expect(["מצגת השיעור לדוגמה.pptx", "download"]).toContain(got.d.suggestedFilename()); // headless Chromium: «download»
    expect(got.bytes.toString()).toBe("PK synthetic pptx, never opened");

    // «הסרה»: asked once — «ביטול» gives it the focus back; «כן, להסיר» removes it and the list keeps the focus
    await r.getByRole("button", { name: "הסרה" }).click();
    const confirm = r.getByRole("group", { name: "אישור" });
    await expect(confirm).toHaveText(/להסיר את המצגת «מצגת השיעור לדוגמה\.pptx»\?/);
    await confirm.getByRole("button", { name: "ביטול" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(r.getByRole("button", { name: "הסרה" })).toBeFocused();
    await r.getByRole("button", { name: "הסרה" }).click();
    await confirm.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(toast(page, "המצגת הוסרה")).toBeVisible();
    await expect(r).toHaveAttribute("data-state", "none");
    await expect(page.getByRole("list", { name: "השיעורים של היום" })).toBeFocused();
    await noSidewaysScroll(page);
  });
});

test.describe("demo build — logistics and a trainee", () => {
  test("logistics: the day's list, the week's deck and the zip — no input, no «הסרה»", async ({ page }) => {
    await page.goto(`${demoUrl()}/?as=logistics`);
    await expect(page).toHaveURL(/\/logistics$/);
    await goSection(page, "מצגות");
    await expect(page).toHaveURL(/\/presentations$/);
    await expect(page.locator("[data-presentations]")).toBeVisible();
    await expect(page.locator(`[data-presentation-file="${SUNDAY_DECK}"]`)).toBeVisible();
    await expect(page.locator("[data-week-presentation]")).toContainText(WEEK_DECK_NAME);
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await expect(page.locator("[data-upload-presentation]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "הסרה" })).toHaveCount(0);
    const z = entries((await downloaded(page, () => zipButton(page).click())).bytes);
    expect(z.names).toEqual(["סדר-היום.txt", "links.txt", `0000_השבוע_${WEEK_DECK_NAME}`, "0830_בית מדרש_מצגת לדוגמה.pdf"]);
    await page.locator('[data-day-tab="2"]').click();
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await expect(page.locator(`[data-presentation-file="${TUESDAY_DECK}"]`)).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("a trainee: not in their header, the page by address — uploads to a lesson, never the week's deck; removes their own uploads only", async ({ page }) => {
    await page.goto(`${demoUrl()}/presentations?as=trainee`);
    await expect(page.locator("[data-presentations]")).toBeVisible();
    await expect(sectionLink(page, "מצגות")).toHaveCount(0);
    const deck = page.locator("[data-week-presentation]");
    await expect(deck).toContainText(WEEK_DECK_NAME);
    await expect(deck.locator("[data-upload-presentation]")).toHaveCount(0);
    await expect(deck.getByRole("button", { name: "הסרה" })).toHaveCount(0); // the instructor's
    // Sunday 08:30's deck is theirs (member 2 uploaded it): theirs to remove
    await expect(row(page, lessonAt(0, 510)).getByRole("button", { name: "הסרה" })).toBeVisible();
    for (const id of [lessonAt(0, 510), lessonAt(0, 600), lessonAt(0, 690)]) await expect(row(page, id).locator(`[data-upload-presentation="${id}"] input[type=file]`)).toHaveCount(1);
    await expect(row(page, lessonAt(0, 780, "memorial")).locator("input[type=file]")).toHaveCount(0);
    const l = lessonAt(0, 870); // Sunday 14:30 — another trainee's lesson: any content member uploads to a closed lesson
    await row(page, l).locator("input[type=file]").setInputFiles(pdfFile("מצגת לדוגמה של חניך.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    await expect(row(page, l)).toHaveAttribute("data-state", "file");
    await expect(row(page, l).getByRole("button", { name: "הסרה" })).toBeVisible();
    await noSidewaysScroll(page);
  });
});

// ------------------------------------------------------------------ the mock build: the wire

function presentationsWeek() {
  const week = demoWeek();
  week.edition.id = 7;
  week.edition.kind = "real";
  seedDemoSources(week);
  seedDemoPresentations(week);
  return week;
}

function member(role: "admin" | "logistics", memberId: number) {
  return {
    status: "ok", schema_version: EXPECTED_SCHEMA_VERSION, email: `${role}@example.org`, display_name: `${role} (לדוגמה)`, global_admin: false,
    memberships: [{ edition_id: 7, role, member_id: memberId }],
  };
}

test.describe("mock build", () => {
  test("an upload: Storage first with the member's token, then register_source_file — kind «presentation», no page count; the week's deck on the cover path; a download by ONE batch sign, saved under its Hebrew name", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the wire is the same at every width: one run is enough");
    const week = presentationsWeek();
    const sb = new FakeSupabase({ status: 200, body: member("admin", 1) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    const l = lessonAt(0, 690);
    sb.answers.set("register_source_file", {
      id: 50, lesson_id: l, cover: false, kind: "presentation", speaker_id: 5, fallen_id: null, storage_path: "x", display_name: "מצגת לדוגמה חדשה.pptx", mime: PPTX,
      size_bytes: 31, page_count: null, uploaded_by: 1, uploaded_at: "2026-11-20T10:00:00.000Z",
    });
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    const bearer = `Bearer ${session.access_token}`;
    await recordDownloadNames(page);

    await page.goto(`${mockUrl()}/presentations`);
    await row(page, l).locator("input[type=file]").setInputFiles(pptx("מצגת לדוגמה חדשה.pptx"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    const ups = sb.storage.filter((c) => c.method === "POST" && c.path.startsWith("/storage/v1/object/sources/"));
    expect(ups).toHaveLength(1);
    expect(ups[0].path).toMatch(new RegExp(`^/storage/v1/object/sources/7/${l}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]+\\.pptx$`));
    expect([ups[0].auth, ups[0].contentType, ups[0].cacheControl]).toEqual([bearer, PPTX, "private, no-store"]);
    const path = ups[0].path.slice("/storage/v1/object/sources/".length);
    expect(sb.rpc.get("register_source_file")).toEqual([{ p_edition: 7, p_lesson: l, p_path: path, p_display_name: "מצגת לדוגמה חדשה.pptx", p_pages: null, p_kind: "presentation" }]);
    // in that order: the object first, then its row
    const at = (p: string) => sb.calls.findIndex((c) => c.path === p);
    expect(at(ups[0].path)).toBeLessThan(at("/rest/v1/rpc/register_source_file"));
    expect(sb.calls.filter((c) => c.path === "/rest/v1/rpc/register_source_file").every((c) => c.auth === bearer)).toBe(true);

    // the week's deck: an admin's, on the cover path — p_lesson null
    await page.locator('[data-upload-presentation="week"] input[type=file]').setInputFiles(pdfFile("מצגת לשבוע לדוגמה.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    const cover = sb.storage.filter((c) => c.method === "POST" && c.path.startsWith("/storage/v1/object/sources/7/cover/"));
    expect(cover).toHaveLength(1);
    expect(cover[0].contentType).toBe("application/pdf");
    expect(sb.rpc.get("register_source_file")![1]).toEqual({ p_edition: 7, p_lesson: null, p_path: cover[0].path.slice("/storage/v1/object/sources/".length), p_display_name: "מצגת לשבוע לדוגמה.pdf", p_pages: null, p_kind: "presentation" });

    // the file as the next load_week has it, then «הורדה»: ONE batch sign, a GET of the signed URL, its own name
    week.sourceFiles.push({
      id: 50, lesson_id: l, cover: false, kind: "presentation", speaker_id: 5, fallen_id: null, storage_path: path, display_name: "מצגת לדוגמה חדשה.pptx", mime: PPTX,
      size_bytes: 31, page_count: null, uploaded_by: 1, uploaded_at: "2026-11-20T10:00:00.000Z",
    });
    sb.storageFiles.set(path, Buffer.from("PK synthetic pptx, never opened"));
    await page.locator("[data-refresh]").click();
    await expect(row(page, l)).toHaveAttribute("data-state", "file");
    const signsBefore = sb.storage.filter((c) => c.path === "/storage/v1/object/sign/sources").length;
    const got = await downloaded(page, () => row(page, l).locator('[data-presentation-file="50"]').click());
    expect(await downloadNames(page)).toEqual(["מצגת לדוגמה חדשה.pptx"]);
    expect(["מצגת לדוגמה חדשה.pptx", "download"]).toContain(got.d.suggestedFilename()); // headless Chromium: «download»
    expect(got.bytes.toString()).toBe("PK synthetic pptx, never opened");
    const signs = sb.storage.filter((c) => c.path === "/storage/v1/object/sign/sources").slice(signsBefore);
    expect(signs.map((c) => [c.body, c.auth])).toEqual([[{ expiresIn: 600, paths: [path] }, bearer]]);
    expect(sb.storage.some((c) => c.method === "GET" && c.path === `/storage/v1/object/sign/sources/${path}`)).toBe(true);
    expect(sb.storage.some((c) => c.path.includes("/object/public/"))).toBe(false);
  });

  test("logistics: the zip through one batch sign and a GET per file, the bytes as stored; never an upload or a registration", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the wire is the same at every width: one run is enough");
    const week = presentationsWeek();
    const sb = new FakeSupabase({ status: 200, body: member("logistics", 5) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    for (const f of week.sourceFiles) sb.storageFiles.set(f.storage_path, Buffer.from(`%PDF-1.4 synthetic file ${f.id}`));
    await sb.attach(page);
    const session = await signIn(page, "logistics@example.org");
    sb.token = session.access_token;
    const bearer = `Bearer ${session.access_token}`;
    const pathOf = (id: number) => week.sourceFiles.find((f) => f.id === id)!.storage_path;

    await page.goto(`${mockUrl()}/presentations`);
    await expect(page.locator(`[data-presentation-file="${SUNDAY_DECK}"]`)).toBeVisible();
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    const got = await downloaded(page, () => zipButton(page).click());
    const signs = sb.storage.filter((c) => c.path === "/storage/v1/object/sign/sources");
    expect(signs.map((c) => [c.body, c.auth])).toEqual([[{ expiresIn: 600, paths: [pathOf(WEEK_DECK), pathOf(SUNDAY_DECK)] }, bearer]]);
    const z = entries(got.bytes);
    expect(z.names).toEqual(["סדר-היום.txt", "links.txt", `0000_השבוע_${WEEK_DECK_NAME}`, "0830_בית מדרש_מצגת לדוגמה.pdf"]);
    expect(strFromU8(z.files[`0000_השבוע_${WEEK_DECK_NAME}`])).toBe(`%PDF-1.4 synthetic file ${WEEK_DECK}`);
    expect(strFromU8(z.files["0830_בית מדרש_מצגת לדוגמה.pdf"])).toBe(`%PDF-1.4 synthetic file ${SUNDAY_DECK}`);
    expect(sb.rpc.get("register_source_file")).toBeUndefined();
    expect(sb.storage.filter((c) => c.method !== "GET" && c.path !== "/storage/v1/object/sign/sources")).toEqual([]); // no upload, no delete
  });

  test("the week again every two minutes while the tab is visible, never while it is hidden; «רענון» at once", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "timers, not layout: one run is enough");
    const week = presentationsWeek();
    const sb = new FakeSupabase({ status: 200, body: member("admin", 1) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    await sb.attach(page);
    sb.token = (await signIn(page, "admin@example.org")).access_token;
    await page.clock.install();
    await page.goto(`${mockUrl()}/presentations`);
    await expect(page.locator("[data-presentation-row]").first()).toBeVisible();
    const loads = () => sb.count("/rest/v1/rpc/load_week");
    const start = loads();

    await page.clock.runFor(120_000);
    await expect.poll(loads).toBe(start + 1);
    // hidden (another tab in front): the two minutes pass with no read
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
    await page.clock.runFor(240_000);
    await page.waitForTimeout(200);
    expect(loads()).toBe(start + 1);
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }));
    await page.clock.runFor(120_000);
    await expect.poll(loads).toBe(start + 2);

    // «רענון»: at once, its busy label while it reads
    await page.locator("[data-refresh]").click();
    await expect.poll(loads).toBe(start + 3);
    await expect(page.locator("[data-refresh]")).toHaveText("רענון");
  });
});

// ------------------------------------------------------------------ the review of phase 5 (22.11)

test.describe("demo build — the review", () => {
  test("an upload keeps the focus on its input — a lesson's row, the week's deck, the lesson page — and there the «טרם התקבלו» line points below", async ({ page }) => {
    await page.goto(`${demoUrl()}/presentations`);
    // the input holds the focus once the picker closes: never disabled while busy (aria-disabled), so it keeps it
    const late = lessonAt(0, 690);
    const pick = row(page, late).locator("input[type=file]");
    await pick.focus();
    await pick.setInputFiles(pdfFile("מצגת לדוגמה למיקוד.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    await expect(row(page, late)).toHaveAttribute("data-state", "file");
    await expect(pick).toBeFocused();
    const deck = page.locator("[data-week-presentation]");
    const deckPick = deck.locator("input[type=file]");
    await deckPick.focus();
    await deckPick.setInputFiles(pdfFile("מצגת שבוע לדוגמה.pdf"));
    await expect(deck).toContainText("מצגת שבוע לדוגמה.pdf");
    await expect(deckPick).toBeFocused();

    // the lesson page's «מצגות»: the same — and the choice the line speaks of is right below it, in the same step
    await page.goto(`${demoUrl()}/lesson/${late}?step=sources#presentations`);
    const part = page.locator("[data-lesson-presentations]");
    await expect(part).toBeFocused();
    const partPick = part.locator("input[type=file]");
    await partPick.focus();
    await partPick.setInputFiles(pdfFile("מצגת לדוגמה למיקוד.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    await expect(part.getByRole("list", { name: "המצגות של השיעור" })).toContainText("מצגת לדוגמה למיקוד.pdf");
    await expect(partPick).toBeFocused();
    await expect(part.getByRole("status")).toContainText("המקורות עדיין מסומנים «טרם התקבלו». אם יש רק מצגת, מסמנים «מצגת» למטה, ב«מה התקבל מהמרצה».");
    const choice = page.locator('[data-page-step="sources"]').getByRole("group", { name: "מה התקבל מהמרצה" });
    await expect(choice).toBeVisible();
    expect((await choice.boundingBox())!.y).toBeGreaterThan((await part.getByRole("status").boundingBox())!.y);
    await noSidewaysScroll(page);
  });

  test("not one file of the day came: no zip, an error and the names — never «ירדו 0 מצגות», no marker on this device", async ({ page }) => {
    // every file's address answers 403 (the demo's files are blob: addresses)
    await page.addInitScript(() => {
      const real = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
        String(input instanceof Request ? input.url : input).startsWith("blob:") ? Promise.resolve(new Response(null, { status: 403 })) : real(input, init);
    });
    await page.goto(`${demoUrl()}/presentations`);
    let downloads = 0;
    page.on("download", () => downloads++);
    await zipButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "אף מצגת לא ירדה" })).toContainText("אף מצגת לא ירדה. בודקים את החיבור ומנסים שוב.");
    await expect(page.locator("[data-day-zip]").getByRole("alert")).toContainText(`לא ירדו: ${WEEK_DECK_NAME}, מצגת לדוגמה.pdf`);
    await expect(zipButton(page)).toBeFocused();
    await expect(page.getByText(/ירדו 0 מצגות/)).toHaveCount(0);
    await expect(page.locator("[data-since-download]")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("volozhin-presentations-zip:1:0"))).toBeNull();
    expect(downloads).toBe(0);
  });

  test("the last presentation left without a lesson removed: the fold goes, the day's list heading takes the focus", async ({ page }, info) => {
    // Tuesday 16:00 in כיתת בית מדרש (its deck «שקפים לדוגמה.pdf») reopened from the grid's panel — within the tab
    await page.goto(demoUrl());
    if (info.project.name !== "desktop") await page.getByRole("tab", { name: "שלישי" }).click();
    await page.locator(`[data-lesson-id="${lessonAt(2, 960, "lesson", 2)}"]`).click();
    const panel = page.getByRole("dialog", { name: "שיעור סגור" });
    await panel.getByText("פעולות נוספות").click();
    await panel.getByRole("button", { name: "פתיחה מחדש (חזרה לטיוטה)" }).click(); // nothing of its stages to lose: no question
    const draft = page.getByRole("dialog", { name: "משבצת בתהליך" });
    await expect(draft).toBeVisible();
    await draft.getByRole("button", { name: "סגירה", exact: true }).click();
    await goSection(page, "מצגות");
    await page.locator('[data-day-tab="2"]').click();
    const fold = page.locator("[data-orphan-presentations]");
    await fold.locator("summary").click();
    await expect(fold).toContainText("שקפים לדוגמה.pdf");
    await fold.getByRole("button", { name: "הסרה" }).click();
    await fold.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(toast(page, "המצגת הוסרה")).toBeVisible();
    await expect(fold).toHaveCount(0);
    await expect(page.locator("#day-list-title")).toBeFocused();
    await noSidewaysScroll(page);
  });

  test("a presentation expected and not there: «מעלים אותה כאן» only to whoever is given the upload", async ({ page }) => {
    const expected = lessonAt(2, 960, "lesson", 1);
    await page.goto(`${demoUrl()}/lesson/${expected}?step=sources#presentations`);
    const part = page.locator("[data-lesson-presentations]");
    await expect(part).toBeFocused();
    await expect(part.locator("p").filter({ hasText: "סומן שיש מצגת" })).toHaveText("סומן שיש מצגת, ועוד לא הועלתה. מעלים אותה כאן, או ממלאים «קישור למצגת» למטה.");
    await expect(part.locator("input[type=file]")).toHaveCount(1);
    await page.goto(`${demoUrl()}/lesson/${expected}?as=logistics&step=sources#presentations`);
    await expect(part).toBeFocused();
    await expect(part.locator("p").filter({ hasText: "סומן שיש מצגת" })).toHaveText("סומן שיש מצגת, ועוד לא הועלתה.");
    await expect(part.locator("input[type=file]")).toHaveCount(0);
  });
});
