// «מצגות» (/presentations) in a real browser — the team's page for the hall's computer, which is not signed in: someone
// downloads the presentations and copies them there on a USB stick. v20 (plan §ז, DECISIONS «גרסה 20» ז): ONE download for
// the whole week — «0-השבוע/» (the week's decks, once) and a folder per day, «1-ראשון/» … «5-חמישי/», each with its files
// «HHMM_<room>_<name>», its «סדר-היום.txt» and, where a lesson has a link only, «links.txt» (UTF-8 with a BOM, CRLF) — and
// the day tabs, the room chips, the day's list and the per-day zip and marker are gone on purpose. Demo build, every width:
// the page (the download card, the week's deck and its place in «0-השבוע», «חסרות» folded, each a link to its lesson page,
// an old `?day=&room=` address opening it, a PDF in a new tab, Word refused for the week's deck); the zip unzipped here —
// its folders, the deck once, the texts, every lesson's file under its `entryPrefix`, a night lesson in the folder of the
// day before with «ליל ראשון–שני» on its line; this device's one marker per week («ההורדה האחרונה במכשיר הזה», «עלו מאז
// ההורדה: N» with each file's folder, name and «הורדה» under that name, «שיעור זז מאז ההורדה — מורידים שוב» — ids and
// fingerprints, never a name); a PowerPoint file uploaded from the lesson page, its place on the hall's computer there
// the zip's own path; logistics download and read only; a trainee uploads from the lesson page alone. Mock build: an upload
// goes to Storage first, with the member's token, then register_source_file with p_kind «presentation» and no page count
// (the week's deck on the cover path, p_lesson null); a download and the zip go through ONE batch sign and a GET per file,
// the bytes as stored; above 250MB the week comes in parts under the same paths; logistics never register; the week is
// read again every two minutes while the tab is visible, and on «רענון».
// Synthetic files and names only (the demo's PDFs are made in the browser; a pptx here is a few bytes, never opened).
import { readFile } from "node:fs/promises";
import { expect, type Download, type Locator, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { demoWeek, seedDemoPresentations, seedDemoSources } from "../../src/data/demoWeek";
import { PPTX } from "../../src/data/sourceRules";
import { entryPrefix, nameFingerprint, presentationsZipKey } from "../../src/domain/presentations";
import type { Day } from "../../src/domain/time";
import { errorMessage } from "../../src/errors";
import { israelDay } from "../../src/exports/download";
import { EXPECTED_SCHEMA_VERSION } from "../../src/lib/schema";
import { goSection, noSidewaysScroll, sectionLink } from "./helpers";
import { FakeSupabase, signIn } from "./mock";

const demoUrl = () => process.env.E2E_DEMO_URL!;
const mockUrl = () => process.env.E2E_MOCK_URL!;

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const zipCard = (page: Page) => page.locator("[data-week-zip]");
const zipButton = (page: Page) => zipCard(page).getByRole("button", { name: "הורדת כל המצגות של השבוע", exact: true });
const lessonPart = (page: Page) => page.locator("[data-lesson-presentations]");

/** The demo's lessons by place (src/data/demoWeek.ts): the ids the rows carry. */
const lessonAt = (day: number, start: number, kind: "lesson" | "memorial" = "lesson", room = 1) =>
  demoWeek().lessons.find((l) => l.kind === kind && l.day === day && l.start_min === start && l.room_id === room)!.id;
const ROOMS: Record<number, string> = { 1: "בית מדרש", 2: "כיתת בית מדרש" };

/** The demo's presentations (seedDemoPresentations, after the four sources): Sunday 08:30's, Tuesday 16:00 room 2's, the week's. */
const SUNDAY_DECK = 5;
const TUESDAY_DECK = 6;
const WEEK_DECK = 7;
const WEEK_DECK_NAME = "המצגת המלווה לשבוע (לדוגמה).pdf";
/** Their paths in the week's zip — as the escort's page and the lesson page name them (src/domain/presentationNames.ts). */
const WEEK_PATH = `0-השבוע/${WEEK_DECK_NAME}`;
const SUNDAY_PATH = "1-ראשון/0830_בית מדרש_מצגת לדוגמה.pdf";
const TUESDAY_PATH = "3-שלישי/1600_כיתת בית מדרש_שקפים לדוגמה.pdf";
/** Each day's order, always; the texts are written first, the days in order. */
const ORDERS = ["1-ראשון", "2-שני", "3-שלישי", "4-רביעי", "5-חמישי"].map((d) => `${d}/סדר-היום.txt`);

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

/** The lesson file entries of a zip: not the week's folder, not a text. */
const lessonFiles = (names: string[]) => names.filter((n) => !n.startsWith("0-השבוע/") && !n.endsWith(".txt"));

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

const zipName = (what: string, edition = 1) => `volozhin-presentations-${what}-edition-${edition}-${israelDay()}.zip`;
/** This device's memory of the week's download (localStorage), as the page wrote it. */
const marker = (page: Page, edition = 1) => page.evaluate((k) => localStorage.getItem(k), presentationsZipKey(edition));
/** Every key of a presentations zip marker this device holds. */
const markerKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("volozhin-presentations-zip:")).sort());
/** The paths a list shows (data-hall-path), in its order. */
const hallPaths = (list: Locator) => list.locator("[data-hall-path]").evaluateAll((els) => els.map((e) => e.getAttribute("data-hall-path")));

test.describe("demo build — the staff", () => {
  test("the week's page: no day tabs, rooms or day list any more; the download card, the week's deck in «0-השבוע», «חסרות» folded — each a link to its lesson page; a PDF in a new tab, Word refused for the week's deck; an old address with ?day= and ?room= opens it", async ({ page }) => {
    await page.goto(demoUrl());
    await goSection(page, "מצגות");
    await expect(page).toHaveURL(/\/presentations$/);
    await expect(page.locator("[data-presentations]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "מצגות", level: 2 })).toBeVisible();
    // v20 (plan §ז «מה יוצא»): the day tabs, the room chips and the day's list are gone — and with them the uploads of
    // a lesson here (a lesson's presentation is uploaded on its lesson page)
    await expect(page.getByRole("navigation", { name: "ימי השבוע" })).toHaveCount(0);
    for (const gone of ["[data-day-tab]", "[data-room]", "[data-presentation-row]", "[data-day-zip]", "[data-zip-room]", "[data-night]"]) await expect(page.locator(gone), gone).toHaveCount(0);
    await expect(page.locator('[data-upload-presentation]:not([data-upload-presentation="week"])')).toHaveCount(0);

    // the download card: the week's three files, their size; the hall's folders said
    const card = zipCard(page);
    await expect(card.getByRole("heading", { name: "הורדה למחשב של האולם", level: 3 })).toBeVisible();
    await expect(card).toHaveAttribute("data-total-bytes", String(640_000 + 410_000 + 220_000));
    await expect(card).toContainText("3 מצגות · כ-1.2 MB");
    await expect(card).toContainText("המצגת של השבוע בתיקייה «0-השבוע»");
    await expect(card).toContainText("המלווה של כל שיעור רואה בדף שלו/ה באיזו תיקייה הקובץ, ובמה השם שלו מתחיל.");
    await expect(zipButton(page)).toBeVisible();
    expect((await zipButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator("[data-since-download]")).toHaveCount(0); // nothing downloaded on this device yet

    // the week's deck: its place on the hall's computer — the week's folder, once
    const deck = page.locator("[data-week-presentation]");
    await expect(deck.getByRole("heading", { name: "המצגת של השבוע" })).toBeVisible();
    await expect(deck).toContainText("בכל החדרים, בין השיעורים — בהורדה, בתיקייה «0-השבוע»");
    const deckRow = deck.locator(`[data-file-row="${WEEK_DECK}"]`);
    await expect(deckRow).toContainText(WEEK_DECK_NAME);
    await expect(deckRow.locator("[data-hall-line]")).toHaveText(`במחשב של האולם: 0-השבוע / ${WEEK_DECK_NAME}`);
    await expect(deckRow.locator("[data-hall-path]")).toHaveAttribute("data-hall-path", WEEK_PATH);
    await expect(deck.locator('[data-upload-presentation="week"]')).toBeVisible();

    // «חסרות»: folded, one lesson — Tuesday 16:00 in the בית מדרש, «מצגת» marked and nothing uploaded — a link to its page
    const expected = lessonAt(2, 960, "lesson", 1);
    const missing = page.locator("[data-missing-presentations]");
    await expect(missing.locator("summary")).toContainText("חסרות");
    await expect(missing.locator("summary")).toContainText("1");
    const missingRow = missing.locator(`[data-missing-row="${expected}"]`);
    await expect(missingRow).toBeHidden();
    await missing.locator("summary").click();
    await expect(missing).toContainText("שיעורים שסומן בהם שיש מצגת, והיא עוד לא הועלתה. מעלים אותה בעמוד השיעור, ב«מקורות ומצגת».");
    await expect(missing.getByRole("list", { name: "מצגות חסרות" }).locator("[data-missing-row]")).toHaveCount(1);
    await expect(missingRow).toContainText("יום שלישי 16:00–17:15 · בית מדרש");
    await expect(missingRow).toContainText("מצגת צפויה — עוד לא הועלתה");
    const toLesson = missingRow.getByRole("link");
    await expect(toLesson).toHaveAttribute("href", `/lesson/${expected}?step=sources#presentations`);
    expect((await toLesson.boundingBox())!.height).toBeGreaterThanOrEqual(44);
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
    const open = deckRow.locator(`[data-presentation-file="${WEEK_DECK}"]`);
    await expect(open).toHaveAttribute("data-action", "open");
    await expect(open).toHaveText("פתיחה");
    const [tab] = await Promise.all([page.context().waitForEvent("page"), open.click()]);
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[][] }).__opened);
    expect(opened).toEqual([[expect.stringMatching(/^blob:/), "_blank", "noopener,noreferrer"]]);
    const head = await page.evaluate(async (u) => new TextDecoder().decode((await (await fetch(u)).arrayBuffer()).slice(0, 5)), opened[0][0]);
    expect(head).toBe("%PDF-");
    await tab.close();

    // Word for the week's deck: refused in the browser, in its own words
    await deck.locator("input[type=file]").setInputFiles({ name: "מסמך.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK synthetic") });
    await expect(deck.getByRole("alert")).toHaveText(errorMessage("week_presentation_bad_file"));
    await expect(deck.locator("[data-file-row]")).toHaveCount(1);

    // «חסרות»'s link: the lesson page, at its presentations, the focus there
    await toLesson.click();
    await expect(page).toHaveURL(new RegExp(`/lesson/${expected}\\?step=sources#presentations$`));
    await expect(lessonPart(page)).toBeFocused();
    await expect(lessonPart(page)).toContainText("מצגת צפויה — עוד לא הועלתה");

    // an address of before (a day and a room in the query) opens the week's page as it is
    await page.goto(`${demoUrl()}/presentations?day=2&room=2`);
    await expect(page.locator("[data-presentations]")).toBeVisible();
    await expect(zipButton(page)).toBeVisible();
    await expect(page.locator("[data-day-tab], [data-room]")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("the week's zip: «0-השבוע/» once, a folder per day with «סדר-היום.txt» and «links.txt» only where a lesson has a link only, every lesson's file under its prefix — a night lesson's in the day before's folder; this device remembers it, a file uploaded since is «עלו מאז ההורדה» with its folder, name and «הורדה»", async ({ page }, info) => {
    await recordDownloadNames(page);
    // first a night lesson's presentation, on its lesson page: Sunday 00:30 — after midnight, its column's folder
    const night = lessonAt(0, 1470);
    await page.goto(`${demoUrl()}/lesson/${night}?step=sources#presentations`);
    await expect(lessonPart(page)).toBeFocused();
    await lessonPart(page).locator("input[type=file]").setInputFiles(pdfFile("מצגת לילה לדוגמה.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    const nightPath = `${entryPrefix(0, 1470, ROOMS[1])}מצגת לילה לדוגמה.pdf`;
    expect(nightPath).toBe("1-ראשון/2430_בית מדרש_מצגת לילה לדוגמה.pdf");
    await expect(lessonPart(page).locator("[data-hall-line]")).toHaveText("במחשב של האולם: 1-ראשון / 2430_בית מדרש_מצגת לילה לדוגמה.pdf");
    // to the week's page within the tab (the demo keeps the upload in memory)
    await lessonPart(page).getByRole("link", { name: "לדף המצגות ‹" }).click();
    await expect(page).toHaveURL(/\/presentations$/);
    await expect(zipCard(page)).toContainText("4 מצגות");
    await expect(page.locator("[data-since-download]")).toHaveCount(0);
    // a phone may download, and is told a computer is better: below 1024px with no fine pointer (the reader's rule). A
    // touch tablet's pointer is the browser build's emulation — the rule is read from the page, the phone and the desktop pinned
    const computer = await page.evaluate(() => matchMedia("(min-width: 1024px), (pointer: fine)").matches);
    if (info.project.name !== "tablet") expect(computer).toBe(info.project.name === "desktop");
    await expect(zipCard(page).getByText("עדיף במחשב")).toBeVisible({ visible: !computer });

    const first = await downloaded(page, () => zipButton(page).click());
    expect(first.d.suggestedFilename()).toBe(zipName("week"));
    const z = entries(first.bytes);
    // the texts first (each day's order; Sunday's links), then the week's deck, then the days' files in their order
    expect(z.names).toEqual([ORDERS[0], "1-ראשון/links.txt", ...ORDERS.slice(1), WEEK_PATH, SUNDAY_PATH, nightPath, TUESDAY_PATH]);
    // the folders: the week's, then one per day
    expect([...new Set(z.names.map((n) => n.split("/")[0]))].sort()).toEqual(["0-השבוע", "1-ראשון", "2-שני", "3-שלישי", "4-רביעי", "5-חמישי"]);
    // the week's deck exactly once, in «0-השבוע/» only
    expect(z.names.filter((n) => n.endsWith(WEEK_DECK_NAME))).toEqual([WEEK_PATH]);
    expect(z.names.filter((n) => n.startsWith("0-השבוע/"))).toEqual([WEEK_PATH]);
    // links.txt only where a lesson has a link only (Sunday 10:00)
    expect(z.names.filter((n) => n.endsWith("/links.txt"))).toEqual(["1-ראשון/links.txt"]);
    // every lesson's file under its lesson's prefix: the day column's folder, the start, the room (entryPrefix — the escort's page's)
    const week = demoWeek();
    const byPlace = [
      { l: week.lessons.find((x) => x.id === lessonAt(0, 510))!, name: "מצגת לדוגמה.pdf" },
      { l: week.lessons.find((x) => x.id === night)!, name: "מצגת לילה לדוגמה.pdf" },
      { l: week.lessons.find((x) => x.id === lessonAt(2, 960, "lesson", 2))!, name: "שקפים לדוגמה.pdf" },
    ];
    expect(lessonFiles(z.names).sort()).toEqual(byPlace.map(({ l, name }) => `${entryPrefix(l.day as Day, l.start_min, ROOMS[l.room_id])}${name}`).sort());
    for (const n of [WEEK_PATH, SUNDAY_PATH, nightPath, TUESDAY_PATH]) expect(strFromU8(z.files[n].subarray(0, 5)), n).toBe("%PDF-");

    // each day's order: UTF-8 with a BOM, CRLF — Sunday's in full: the week's deck with its folder, the day's files by
    // their names in this folder, the night's lesson with «ליל ראשון–שני» on its line
    const orders = ORDERS.map((n) => textLines(z.files[n]));
    expect(orders[0]).toEqual([
      "סדר היום — יום ראשון · TBD · הדגמה",
      `המצגת של השבוע — ${WEEK_PATH}`,
      "",
      "08:30–09:45 · בית מדרש · ד״ר מרצה 01 · פתיחת השבוע (לדוגמה) — 0830_בית מדרש_מצגת לדוגמה.pdf",
      "10:00–11:15 · בית מדרש · פרופ׳ מרצה 03 · שיעור לדוגמה 2 — קישור: https://slides.example/presentation-demo",
      "11:30–12:45 · בית מדרש · הרב מרצה 05 · שיעור לדוגמה 3 — בלי מצגת",
      "13:00–13:15 · בית מדרש · זמן זיכרון",
      "14:15–14:30 · בית מדרש · זמן זיכרון",
      "14:30–15:45 · בית מדרש · מרצה 07 · שיעור לדוגמה 4 — בלי מצגת",
      "00:30–01:45 · ליל ראשון–שני · בית מדרש · ד״ר מרצה 02 · שיעור לדוגמה 6 — 2430_בית מדרש_מצגת לילה לדוגמה.pdf",
    ]);
    for (const [i, d] of ["ראשון", "שני", "שלישי", "רביעי", "חמישי"].entries()) {
      expect(orders[i][0]).toBe(`סדר היום — יום ${d} · TBD · הדגמה`);
      expect(orders[i][1]).toBe(`המצגת של השבוע — ${WEEK_PATH}`);
    }
    // Tuesday: the two rooms at 16:00 — the one expected and not there, the other's file
    expect(orders[2].filter((l) => l.startsWith("16:00–17:15"))).toEqual([
      expect.stringMatching(/^16:00–17:15 · בית מדרש · .+ — מצגת צפויה — עוד לא הועלתה$/),
      expect.stringMatching(/^16:00–17:15 · כיתת בית מדרש · .+ — 1600_כיתת בית מדרש_שקפים לדוגמה\.pdf$/),
    ]);
    expect(textLines(z.files["1-ראשון/links.txt"])).toEqual(["קישורים למצגות — יום ראשון · TBD · הדגמה", "", "10:00 · פרופ׳ מרצה 03 · https://slides.example/presentation-demo"]);
    await expect(toast(page, "ירדו 4 מצגות")).toBeVisible();
    await expect(zipButton(page)).toBeFocused();

    // this device remembers the download — one marker for the week (no day, no room): each file's id and a fingerprint
    // of its path, never a name
    const since = page.locator("[data-since-download]");
    await expect(since).toContainText(/ההורדה האחרונה במכשיר הזה: \d{2}:\d{2}$/);
    await expect(since).not.toContainText("עלו מאז");
    expect(await markerKeys(page)).toEqual([presentationsZipKey(1)]);
    const raw = (await marker(page))!;
    const m = JSON.parse(raw) as { at: string; names: Record<string, number> };
    expect(Object.keys(m).sort()).toEqual(["at", "names"]);
    const nightId = Number(Object.keys(m.names).find((id) => ![SUNDAY_DECK, TUESDAY_DECK, WEEK_DECK].includes(Number(id))));
    expect(m.names).toEqual({ [SUNDAY_DECK]: nameFingerprint(SUNDAY_PATH), [TUESDAY_DECK]: nameFingerprint(TUESDAY_PATH), [WEEK_DECK]: nameFingerprint(WEEK_PATH), [nightId]: nameFingerprint(nightPath) });
    for (const word of ["מצגת", "שקפים", ".pdf", "ראשון", "בית מדרש"]) expect(raw).not.toContain(word);

    // a presentation uploaded after it — the missing one, from «חסרות» on its lesson page
    const expected = lessonAt(2, 960, "lesson", 1);
    const missing = page.locator("[data-missing-presentations]");
    await missing.locator("summary").click();
    await missing.locator(`[data-missing-row="${expected}"]`).getByRole("link").click();
    await expect(lessonPart(page)).toBeFocused();
    await lessonPart(page).locator("input[type=file]").setInputFiles(pdfFile("מצגת מאוחרת לדוגמה.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    const latePath = "3-שלישי/1600_בית מדרש_מצגת מאוחרת לדוגמה.pdf";
    await expect(lessonPart(page).locator("[data-hall-path]")).toHaveAttribute("data-hall-path", latePath);
    await lessonPart(page).getByRole("link", { name: "לדף המצגות ‹" }).click();
    await expect(page).toHaveURL(/\/presentations$/);
    // «עלו מאז ההורדה: 1» — its folder, its name and «הורדה»; nothing missing any more; the week's deck is not new
    await expect(since.locator("[data-new-since-list]").getByRole("status")).toHaveText("עלו מאז ההורדה: 1");
    const fresh = since.getByRole("list", { name: "עלו מאז ההורדה" });
    expect(await hallPaths(fresh)).toEqual([latePath]);
    await expect(fresh.locator("[data-entry-row]")).toContainText("3-שלישי / 1600_בית מדרש_מצגת מאוחרת לדוגמה.pdf");
    await expect(since.locator("[data-moved-since]")).toHaveCount(0);
    await expect(page.locator("[data-missing-presentations]")).toHaveCount(0);
    await expect(page.locator("[data-week-presentation] [data-new-since]")).toHaveCount(0);
    await expect(zipCard(page)).toContainText("5 מצגות");
    // «הורדה»: that one file, under its name in the zip — to copy into its folder beside the rest
    const save = fresh.getByRole("button", { name: "הורדה" });
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const one = await downloaded(page, () => save.click());
    expect((await downloadNames(page)).at(-1)).toBe("1600_בית מדרש_מצגת מאוחרת לדוגמה.pdf"); // after the zip's own
    expect(["1600_בית מדרש_מצגת מאוחרת לדוגמה.pdf", "download"]).toContain(one.d.suggestedFilename()); // headless Chromium: «download»
    expect(one.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(since.locator("[data-new-since-list]").getByRole("status")).toHaveText("עלו מאז ההורדה: 1"); // one file is not the week

    // downloaded again: it is in the zip, in its place, and nothing is new any more
    const second = entries((await downloaded(page, () => zipButton(page).click())).bytes);
    expect(lessonFiles(second.names)).toEqual([SUNDAY_PATH, nightPath, latePath, TUESDAY_PATH]);
    expect(textLines(second.files[ORDERS[2]]).filter((l) => l.startsWith("16:00–17:15 · בית מדרש"))).toEqual([expect.stringMatching(/ — 1600_בית מדרש_מצגת מאוחרת לדוגמה\.pdf$/)]);
    await expect(toast(page, "ירדו 5 מצגות")).toBeVisible();
    await expect(since).not.toContainText("עלו מאז");
    await expect(page.locator("[data-new-since]")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("what this device remembers: a file its last download did not hold is «עלו מאז ההורדה» with its place and «הורדה», the week's deck «חדש מאז ההורדה»; a path changed since says «שיעור זז מאז ההורדה — מורידים שוב»; the week again replaces the marker", async ({ page }) => {
    await recordDownloadNames(page);
    await page.goto(`${demoUrl()}/presentations`);
    await expect(zipButton(page)).toBeVisible();
    // as a download of 20.11, 14:05 (Israel) would have left it: Sunday's file under another path — its lesson moved
    // since — and nothing else (the week's deck and Tuesday's came later)
    const at = "2026-11-20T12:05:00.000Z";
    const moved = "1-ראשון/1000_בית מדרש_מצגת לדוגמה.pdf";
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [presentationsZipKey(1), JSON.stringify({ at, names: { [SUNDAY_DECK]: nameFingerprint(moved) } })] as const);
    await page.reload();

    const since = page.locator("[data-since-download]");
    await expect(since).toContainText("ההורדה האחרונה במכשיר הזה: 20.11, 14:05");
    const movedNote = since.locator("[data-moved-since]");
    await expect(movedNote).toHaveAttribute("role", "status");
    await expect(movedNote).toContainText("שיעור זז מאז ההורדה — מורידים שוב");
    await expect(movedNote).toContainText("במחשב של האולם מחליפים את כל התיקיות בהורדה החדשה.");
    await expect(since.locator("[data-new-since-list]").getByRole("status")).toHaveText("עלו מאז ההורדה: 2");
    // in the zip's order — the week's deck, then Tuesday's — each with its folder and name
    const fresh = since.getByRole("list", { name: "עלו מאז ההורדה" });
    expect(await hallPaths(fresh)).toEqual([WEEK_PATH, TUESDAY_PATH]);
    await expect(fresh.locator(`[data-entry-row="${TUESDAY_DECK}"]`)).toContainText("3-שלישי / 1600_כיתת בית מדרש_שקפים לדוגמה.pdf");
    await expect(fresh.locator(`[data-entry-row="${SUNDAY_DECK}"]`)).toHaveCount(0); // it was there: it moved, it is not new
    await expect(page.locator(`[data-week-presentation] [data-file-row="${WEEK_DECK}"] [data-new-since]`)).toHaveText("חדש מאז ההורדה");
    // each «הורדה» is named by its file's place for a screen reader
    const save = fresh.locator(`[data-entry-download="${TUESDAY_DECK}"]`);
    const describedBy = (await save.getAttribute("aria-describedby"))!;
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveAttribute("data-hall-path", TUESDAY_PATH);
    const got = await downloaded(page, () => save.click());
    expect(await downloadNames(page)).toEqual(["1600_כיתת בית מדרש_שקפים לדוגמה.pdf"]);
    expect(["1600_כיתת בית מדרש_שקפים לדוגמה.pdf", "download"]).toContain(got.d.suggestedFilename());
    expect(got.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await noSidewaysScroll(page);

    // the week downloaded: the marker replaced — the three files' ids and their paths' fingerprints, nothing moved or new
    await downloaded(page, () => zipButton(page).click());
    await expect(toast(page, "ירדו 3 מצגות")).toBeVisible();
    await expect(since.locator("[data-moved-since]")).toHaveCount(0);
    await expect(since.locator("[data-new-since-list]")).toHaveCount(0);
    await expect(page.locator("[data-new-since]")).toHaveCount(0);
    await expect(since).not.toContainText("20.11");
    const m = JSON.parse((await marker(page))!) as { at: string; names: Record<string, number> };
    expect(m.names).toEqual({ [SUNDAY_DECK]: nameFingerprint(SUNDAY_PATH), [TUESDAY_DECK]: nameFingerprint(TUESDAY_PATH), [WEEK_DECK]: nameFingerprint(WEEK_PATH) });
    expect(Date.parse(m.at)).toBeGreaterThan(Date.parse(at));
    expect(await markerKeys(page)).toEqual([presentationsZipKey(1)]);

    // a marker someone edited, or another kind of value: no marker — never «a file came»
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ at: "not a time", names: { 5: "x" } })), presentationsZipKey(1));
    await page.reload();
    await expect(zipButton(page)).toBeVisible();
    await expect(page.locator("[data-since-download]")).toHaveCount(0);
  });

  test("a PowerPoint file from the lesson page's «מצגות»: its place on the hall's computer, downloaded there under its own name; «לדף המצגות ‹» is the week's page, the file at that very path in the zip; its removal asked once", async ({ page }) => {
    const l = lessonAt(0, 690); // Sunday 11:30, nothing uploaded
    await recordDownloadNames(page);
    await page.goto(`${demoUrl()}/lesson/${l}?step=sources#presentations`);
    const part = lessonPart(page);
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
    // its place on the hall's computer: the folder of the lesson's day, its start and room, then its own name
    const hall = "1-ראשון/1130_בית מדרש_מצגת השיעור לדוגמה.pptx";
    await expect(list.locator("[data-hall-line]")).toHaveText("במחשב של האולם: 1-ראשון / 1130_בית מדרש_מצגת השיעור לדוגמה.pptx");
    await expect(list.locator("[data-hall-path]")).toHaveAttribute("data-hall-path", hall);
    // on the lesson page itself, the «טרם התקבלו» line needs no link to it
    await expect(part.getByRole("status")).toContainText("המקורות עדיין מסומנים «טרם התקבלו».");
    await expect(part.getByRole("link", { name: "לעמוד השיעור ‹" })).toHaveCount(0);

    // «הורדה»: fetched, then handed over under its Hebrew name — not the stored ASCII one
    const file = list.locator("[data-presentation-file]");
    await expect(file).toHaveAttribute("data-action", "download");
    await expect(file).toHaveText("הורדה");
    const got = await downloaded(page, () => file.click());
    expect(await downloadNames(page)).toEqual(["מצגת השיעור לדוגמה.pptx"]);
    expect(["מצגת השיעור לדוגמה.pptx", "download"]).toContain(got.d.suggestedFilename()); // headless Chromium: «download»
    expect(got.bytes.toString()).toBe("PK synthetic pptx, never opened");

    // «לדף המצגות ‹»: the week's page — no day, no room in the address any more (v20)
    const toPage = part.getByRole("link", { name: "לדף המצגות ‹" });
    await expect(toPage).toHaveAttribute("href", "/presentations");
    await toPage.click();
    await expect(page).toHaveURL(/\/presentations$/);
    // in the week's zip at exactly the path the lesson page said, its bytes as uploaded; the day's order names it
    const z = entries((await downloaded(page, () => zipButton(page).click())).bytes);
    expect(z.names).toContain(hall);
    expect(strFromU8(z.files[hall])).toBe("PK synthetic pptx, never opened");
    expect(textLines(z.files[ORDERS[0]])).toContain("11:30–12:45 · בית מדרש · הרב מרצה 05 · שיעור לדוגמה 3 — 1130_בית מדרש_מצגת השיעור לדוגמה.pptx");

    // back on the lesson page, «הסרה»: asked once — «ביטול» gives it the focus back; «כן, להסיר» removes it, the part keeps the focus
    await page.goBack();
    await expect(list).toContainText("מצגת השיעור לדוגמה.pptx");
    await list.getByRole("button", { name: "הסרה" }).click();
    const confirm = part.getByRole("group", { name: "אישור" });
    await expect(confirm).toHaveText(/להסיר את המצגת «מצגת השיעור לדוגמה\.pptx»\?/);
    await confirm.getByRole("button", { name: "ביטול" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(list.getByRole("button", { name: "הסרה" })).toBeFocused();
    await list.getByRole("button", { name: "הסרה" }).click();
    await confirm.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(toast(page, "המצגת הוסרה")).toBeVisible();
    await expect(list).toHaveCount(0);
    await expect(part).toContainText("לא הועלתה מצגת לשיעור הזה.");
    await expect(part).toBeFocused();
    await noSidewaysScroll(page);
  });
});

test.describe("demo build — logistics and a trainee", () => {
  test("logistics: download and read — the week's zip, the week's deck, «חסרות»; no input, no «הסרה», no «מצגות בלי שיעור»", async ({ page }) => {
    await page.goto(`${demoUrl()}/?as=logistics`);
    await expect(page).toHaveURL(/\/logistics$/);
    await goSection(page, "מצגות");
    await expect(page).toHaveURL(/\/presentations$/);
    await expect(page.locator("[data-presentations]")).toBeVisible();
    await expect(page.locator("[data-week-presentation]")).toContainText(WEEK_DECK_NAME);
    await expect(page.locator(`[data-presentation-file="${WEEK_DECK}"]`)).toBeVisible();
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await expect(page.locator("[data-upload-presentation]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "הסרה" })).toHaveCount(0);
    await expect(page.locator("[data-orphan-presentations]")).toHaveCount(0);
    const missing = page.locator("[data-missing-presentations]");
    await missing.locator("summary").click();
    await expect(missing.locator("[data-missing-row]")).toHaveCount(1);

    const got = await downloaded(page, () => zipButton(page).click());
    expect(got.d.suggestedFilename()).toBe(zipName("week"));
    const z = entries(got.bytes);
    expect(z.names).toEqual([ORDERS[0], "1-ראשון/links.txt", ...ORDERS.slice(1), WEEK_PATH, SUNDAY_PATH, TUESDAY_PATH]);
    // this mode's week has a date: each day's order says it
    expect(textLines(z.files[ORDERS[0]])[0]).toMatch(/^סדר היום — יום ראשון · \d{1,2}\.\d{1,2}\.\d{4} · הדגמה$/);
    await expect(toast(page, "ירדו 3 מצגות")).toBeVisible();
    await expect(page.locator("[data-since-download]")).toContainText("ההורדה האחרונה במכשיר הזה");
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("a trainee: not in their header, the page by address — no upload there (the week's deck is the instructor's); uploads to a lesson from its page, removes their own uploads only", async ({ page }) => {
    await page.goto(`${demoUrl()}/presentations?as=trainee`);
    await expect(page.locator("[data-presentations]")).toBeVisible();
    await expect(sectionLink(page, "מצגות")).toHaveCount(0);
    const deck = page.locator("[data-week-presentation]");
    await expect(deck).toContainText(WEEK_DECK_NAME);
    await expect(deck.locator("[data-upload-presentation]")).toHaveCount(0);
    await expect(deck.getByRole("button", { name: "הסרה" })).toHaveCount(0); // the instructor's
    await expect(page.locator("input[type=file]")).toHaveCount(0); // a lesson's presentation is uploaded on its lesson page
    await expect(page.locator("[data-orphan-presentations]")).toHaveCount(0);
    await expect(zipButton(page)).toBeVisible();

    // Sunday 08:30's deck is theirs (member 2 uploaded it): theirs to remove, on the lesson page
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 510)}?step=sources#presentations`);
    await expect(lessonPart(page).locator(`[data-file-row="${SUNDAY_DECK}"]`).getByRole("button", { name: "הסרה" })).toBeVisible();
    await expect(lessonPart(page).locator(`[data-file-row="${SUNDAY_DECK}"] [data-hall-path]`)).toHaveAttribute("data-hall-path", SUNDAY_PATH);
    // Sunday 14:30 — another trainee's lesson: any content member uploads to a closed lesson
    await page.goto(`${demoUrl()}/lesson/${lessonAt(0, 870)}?step=sources#presentations`);
    await expect(lessonPart(page)).toBeFocused();
    await lessonPart(page).locator("input[type=file]").setInputFiles(pdfFile("מצגת לדוגמה של חניך.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    const mine = lessonPart(page).getByRole("list", { name: "המצגות של השיעור" });
    await expect(mine).toContainText("מצגת לדוגמה של חניך.pdf");
    await expect(mine.getByRole("button", { name: "הסרה" })).toBeVisible();
    await expect(mine.locator("[data-hall-path]")).toHaveAttribute("data-hall-path", "1-ראשון/1430_בית מדרש_מצגת לדוגמה של חניך.pdf");
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
  test("an upload from the lesson page: Storage first with the member's token, then register_source_file — kind «presentation», no page count; the week's deck on the cover path; a download by ONE batch sign, saved under its Hebrew name", async ({ page }, info) => {
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

    await page.goto(`${mockUrl()}/lesson/${l}?step=sources#presentations`);
    await expect(lessonPart(page)).toBeFocused();
    await lessonPart(page).locator("input[type=file]").setInputFiles(pptx("מצגת לדוגמה חדשה.pptx"));
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

    // the week's deck, on the week's page: an admin's, on the cover path — p_lesson null
    await page.goto(`${mockUrl()}/presentations`);
    await page.locator('[data-upload-presentation="week"] input[type=file]').setInputFiles(pdfFile("מצגת לשבוע לדוגמה.pdf"));
    await expect(toast(page, "המצגת הועלתה")).toBeVisible();
    const cover = sb.storage.filter((c) => c.method === "POST" && c.path.startsWith("/storage/v1/object/sources/7/cover/"));
    expect(cover).toHaveLength(1);
    expect(cover[0].contentType).toBe("application/pdf");
    expect(sb.rpc.get("register_source_file")![1]).toEqual({ p_edition: 7, p_lesson: null, p_path: cover[0].path.slice("/storage/v1/object/sources/".length), p_display_name: "מצגת לשבוע לדוגמה.pdf", p_pages: null, p_kind: "presentation" });

    // the file as the next load_week has it, on its lesson page: «הורדה» — ONE batch sign, a GET of the signed URL, its own name
    week.sourceFiles.push({
      id: 50, lesson_id: l, cover: false, kind: "presentation", speaker_id: 5, fallen_id: null, storage_path: path, display_name: "מצגת לדוגמה חדשה.pptx", mime: PPTX,
      size_bytes: 31, page_count: null, uploaded_by: 1, uploaded_at: "2026-11-20T10:00:00.000Z",
    });
    sb.storageFiles.set(path, Buffer.from("PK synthetic pptx, never opened"));
    await page.goto(`${mockUrl()}/lesson/${l}?step=sources#presentations`);
    const row = lessonPart(page).locator('[data-file-row="50"]');
    await expect(row.locator("[data-hall-path]")).toHaveAttribute("data-hall-path", "1-ראשון/1130_בית מדרש_מצגת לדוגמה חדשה.pptx");
    const signsBefore = sb.storage.filter((c) => c.path === "/storage/v1/object/sign/sources").length;
    const got = await downloaded(page, () => row.locator('[data-presentation-file="50"]').click());
    expect(await downloadNames(page)).toEqual(["מצגת לדוגמה חדשה.pptx"]);
    expect(["מצגת לדוגמה חדשה.pptx", "download"]).toContain(got.d.suggestedFilename()); // headless Chromium: «download»
    expect(got.bytes.toString()).toBe("PK synthetic pptx, never opened");
    const signs = sb.storage.filter((c) => c.path === "/storage/v1/object/sign/sources").slice(signsBefore);
    expect(signs.map((c) => [c.body, c.auth])).toEqual([[{ expiresIn: 600, paths: [path] }, bearer]]);
    expect(sb.storage.some((c) => c.method === "GET" && c.path === `/storage/v1/object/sign/sources/${path}`)).toBe(true);
    expect(sb.storage.some((c) => c.path.includes("/object/public/"))).toBe(false);
  });

  test("logistics: the week's zip through one batch sign and a GET per file, the bytes as stored; a file since «עלו מאז ההורדה», its «הורדה» one sign under its zip name; never an upload or a registration", async ({ page }, info) => {
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
    await recordDownloadNames(page);

    await page.goto(`${mockUrl()}/presentations`);
    await expect(page.locator(`[data-presentation-file="${WEEK_DECK}"]`)).toBeVisible();
    await expect(page.locator("input[type=file]")).toHaveCount(0);
    const got = await downloaded(page, () => zipButton(page).click());
    expect(got.d.suggestedFilename()).toBe(zipName("week", 7));
    const signs = () => sb.storage.filter((c) => c.path === "/storage/v1/object/sign/sources");
    // the plan's order: the week's deck, then the days' files
    expect(signs().map((c) => [c.body, c.auth])).toEqual([[{ expiresIn: 600, paths: [pathOf(WEEK_DECK), pathOf(SUNDAY_DECK), pathOf(TUESDAY_DECK)] }, bearer]]);
    const z = entries(got.bytes);
    expect(z.names).toEqual([ORDERS[0], "1-ראשון/links.txt", ...ORDERS.slice(1), WEEK_PATH, SUNDAY_PATH, TUESDAY_PATH]);
    expect(strFromU8(z.files[WEEK_PATH])).toBe(`%PDF-1.4 synthetic file ${WEEK_DECK}`);
    expect(strFromU8(z.files[SUNDAY_PATH])).toBe(`%PDF-1.4 synthetic file ${SUNDAY_DECK}`);
    expect(strFromU8(z.files[TUESDAY_PATH])).toBe(`%PDF-1.4 synthetic file ${TUESDAY_DECK}`);
    for (const id of [WEEK_DECK, SUNDAY_DECK, TUESDAY_DECK]) expect(sb.storage.filter((c) => c.method === "GET" && c.path === `/storage/v1/object/sign/sources/${pathOf(id)}`)).toHaveLength(1);

    // another member's upload since, as the next load_week has it: «עלו מאז ההורדה: 1», and its «הורדה» — one sign, its zip name
    const late = { id: 51, lesson_id: lessonAt(0, 690), cover: false, kind: "presentation" as const, speaker_id: 5, fallen_id: null, storage_path: `7/${lessonAt(0, 690)}/00000000-0000-4000-9000-000000000051-deck-51.pptx`, display_name: "מצגת חדשה לדוגמה.pptx", mime: PPTX, size_bytes: 31, page_count: null, uploaded_by: 1, uploaded_at: "2026-11-21T10:00:00.000Z" };
    week.sourceFiles.push(late);
    sb.storageFiles.set(late.storage_path, Buffer.from("PK synthetic pptx, never opened"));
    await page.locator("[data-refresh]").click();
    const since = page.locator("[data-since-download]");
    await expect(since.locator("[data-new-since-list]").getByRole("status")).toHaveText("עלו מאז ההורדה: 1");
    const fresh = since.getByRole("list", { name: "עלו מאז ההורדה" });
    expect(await hallPaths(fresh)).toEqual(["1-ראשון/1130_בית מדרש_מצגת חדשה לדוגמה.pptx"]);
    const before = signs().length;
    const one = await downloaded(page, () => fresh.locator(`[data-entry-download="${late.id}"]`).click());
    expect((await downloadNames(page)).at(-1)).toBe("1130_בית מדרש_מצגת חדשה לדוגמה.pptx"); // after the zip's own
    expect(one.bytes.toString()).toBe("PK synthetic pptx, never opened");
    expect(signs().slice(before).map((c) => [c.body, c.auth])).toEqual([[{ expiresIn: 600, paths: [late.storage_path] }, bearer]]);
    expect(sb.rpc.get("register_source_file")).toBeUndefined();
    expect(sb.storage.filter((c) => c.method !== "GET" && c.path !== "/storage/v1/object/sign/sources")).toEqual([]); // no upload, no delete
    expect(sb.storage.some((c) => c.path.includes("/object/public/"))).toBe(false);
  });

  test("above 250MB the week comes in parts — the week's deck, then each day, under the same paths; a part too big lists its files, each «הורדה» under its zip name; each part adds to this device's marker", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "the wire is the same at every width: one run is enough");
    const week = presentationsWeek();
    const MB = 1024 * 1024;
    // the rows' sizes (what the plan counts — the bytes served are a few): Sunday's 200MB, Tuesday's 260MB alone, the week's 1MB
    for (const [id, size] of [[SUNDAY_DECK, 200 * MB], [TUESDAY_DECK, 260 * MB], [WEEK_DECK, MB]] as const) week.sourceFiles.find((f) => f.id === id)!.size_bytes = size;
    const sb = new FakeSupabase({ status: 200, body: member("admin", 1) });
    sb.answers.set("editions", [week.edition]);
    sb.answers.set("load_week", week);
    for (const f of week.sourceFiles) sb.storageFiles.set(f.storage_path, Buffer.from(`%PDF-1.4 synthetic file ${f.id}`));
    await sb.attach(page);
    const session = await signIn(page, "admin@example.org");
    sb.token = session.access_token;
    const pathOf = (id: number) => week.sourceFiles.find((f) => f.id === id)!.storage_path;
    await recordDownloadNames(page);

    await page.goto(`${mockUrl()}/presentations`);
    const card = zipCard(page);
    await expect(card).toHaveAttribute("data-total-bytes", String(461 * MB));
    await expect(card.locator("[data-zip-parts]").getByRole("alert")).toHaveText("כל המצגות של השבוע יחד גדולות מדי לקובץ אחד (כ-461 MB). מורידים בחלקים: כל חלק הוא תיקייה, ומעתיקים את כולן לאותו מקום.");
    await expect(zipButton(page)).toHaveCount(0);
    const parts = card.getByRole("list", { name: "חלקי ההורדה" }).locator("[data-zip-part]");
    expect(await parts.evaluateAll((els) => els.map((e) => e.getAttribute("data-zip-part")))).toEqual(["decks", "day0", "day1", "day2", "day3", "day4"]);
    await expect(card.locator('[data-zip-part="decks"]')).toContainText("המצגת של השבוע (0-השבוע)");
    await expect(card.locator('[data-zip-part="day0"]')).toContainText("יום ראשון (1-ראשון)");
    await expect(card.locator('[data-zip-part="day1"]')).toContainText("עוד אין מצגות ליום הזה — בקובץ רק סדר היום");
    // Tuesday's part is more than one file may be: no button, its files one by one
    const tuesday = card.locator('[data-zip-part="day2"]');
    await expect(tuesday.locator("[data-zip-download]")).toHaveCount(0);
    await expect(tuesday).toContainText("גם החלק הזה גדול מדי לקובץ אחד. מורידים כל קובץ לבד, ומעתיקים לתיקייה שלו:");
    expect(await hallPaths(tuesday.getByRole("list", { name: "הקבצים של יום שלישי" }))).toEqual([TUESDAY_PATH]);

    // Sunday's part: its folder alone — the order, the links, its file — under the week's paths
    const sunday = await downloaded(page, () => card.locator('[data-zip-download="day0"]').click());
    expect(sunday.d.suggestedFilename()).toBe(zipName("day1", 7));
    expect(entries(sunday.bytes).names).toEqual([ORDERS[0], "1-ראשון/links.txt", SUNDAY_PATH]);
    await expect(toast(page, "ירדה מצגת אחת")).toBeVisible();
    await expect(card.locator('[data-zip-download="day0"]')).toBeFocused();
    expect(JSON.parse((await marker(page, 7))!).names).toEqual({ [SUNDAY_DECK]: nameFingerprint(SUNDAY_PATH) });
    // what the parts not yet downloaded hold counts as «עלו מאז» — the residual DECISIONS «גרסה 20» ז.12 names
    const since = page.locator("[data-since-download]");
    await expect(since.locator("[data-new-since-list]").getByRole("status")).toHaveText("עלו מאז ההורדה: 2");

    // the week's deck: «0-השבוע/» alone; the marker gains it, keeps Sunday's
    const decks = await downloaded(page, () => card.locator('[data-zip-download="decks"]').click());
    expect(decks.d.suggestedFilename()).toBe(zipName("week-decks", 7));
    expect(entries(decks.bytes).names).toEqual([WEEK_PATH]);
    expect(JSON.parse((await marker(page, 7))!).names).toEqual({ [SUNDAY_DECK]: nameFingerprint(SUNDAY_PATH), [WEEK_DECK]: nameFingerprint(WEEK_PATH) });
    await expect(since.locator("[data-new-since-list]").getByRole("status")).toHaveText("עלו מאז ההורדה: 1");

    // Monday's part, with no file: its order alone
    const monday = await downloaded(page, () => card.locator('[data-zip-download="day1"]').click());
    expect(entries(monday.bytes).names).toEqual([ORDERS[1]]);
    await expect(toast(page, "ירד סדר היום")).toBeVisible();

    // Tuesday's file on its own, under its name in the zip
    const one = await downloaded(page, () => tuesday.locator(`[data-entry-download="${TUESDAY_DECK}"]`).click());
    expect(await downloadNames(page)).toEqual([zipName("day1", 7), zipName("week-decks", 7), zipName("day2", 7), "1600_כיתת בית מדרש_שקפים לדוגמה.pdf"]);
    expect(one.bytes.toString()).toBe(`%PDF-1.4 synthetic file ${TUESDAY_DECK}`);
    // each part signed its own files, one batch each
    expect(sb.storage.filter((c) => c.path === "/storage/v1/object/sign/sources").map((c) => (c.body as { paths: string[] }).paths)).toEqual([[pathOf(SUNDAY_DECK)], [pathOf(WEEK_DECK)], [pathOf(TUESDAY_DECK)]]);
    await noSidewaysScroll(page);
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
    await expect(zipCard(page)).toBeVisible();
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

// ------------------------------------------------------------------ the review of phase 5 (22.11), on v20's page

test.describe("demo build — the review", () => {
  test("an upload keeps the focus on its input — the week's deck, the lesson page — and there the «טרם התקבלו» line points below", async ({ page }) => {
    await page.goto(`${demoUrl()}/presentations`);
    // the input holds the focus once the picker closes: never disabled while busy (aria-disabled), so it keeps it
    const deck = page.locator("[data-week-presentation]");
    const deckPick = deck.locator("input[type=file]");
    await deckPick.focus();
    await deckPick.setInputFiles(pdfFile("מצגת שבוע לדוגמה.pdf"));
    await expect(deck).toContainText("מצגת שבוע לדוגמה.pdf");
    await expect(deckPick).toBeFocused();
    // a second deck of the week: in «0-השבוע» too, beside the first
    await expect(deck.locator("[data-hall-path]")).toHaveCount(2);
    expect(await hallPaths(deck)).toEqual([WEEK_PATH, "0-השבוע/מצגת שבוע לדוגמה.pdf"]);

    // the lesson page's «מצגות»: the same — and the choice the line speaks of is right below it, in the same step
    const late = lessonAt(0, 690);
    await page.goto(`${demoUrl()}/lesson/${late}?step=sources#presentations`);
    const part = lessonPart(page);
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

  test("not one file of the week came: no zip, an error and each file's place with «הורדה» — never «ירדו 0 מצגות», no marker on this device", async ({ page }) => {
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
    const failed = zipCard(page).locator("[data-zip-failed]");
    await expect(failed.getByRole("alert")).toHaveText("3 קבצים לא ירדו. מורידים כל אחד כאן, ומעתיקים לתיקייה שלו:");
    expect(await hallPaths(failed.getByRole("list", { name: "לא ירדו" }))).toEqual([WEEK_PATH, SUNDAY_PATH, TUESDAY_PATH]);
    await expect(failed.locator("[data-entry-download]")).toHaveCount(3);
    await expect(zipButton(page)).toBeFocused();
    await expect(page.getByText(/ירדו 0 מצגות/)).toHaveCount(0);
    await expect(page.locator("[data-since-download]")).toHaveCount(0);
    expect(await marker(page)).toBeNull();
    expect(await markerKeys(page)).toEqual([]);
    expect(downloads).toBe(0);
    await noSidewaysScroll(page);
  });

  test("the last presentation left without a lesson removed: the fold goes, the page's heading takes the focus", async ({ page }, info) => {
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
    // no longer in the zip: the card counts the two others
    await expect(zipCard(page)).toContainText("2 מצגות");
    const fold = page.locator("[data-orphan-presentations]");
    await fold.locator("summary").click();
    await expect(fold).toContainText("שקפים לדוגמה.pdf");
    await expect(fold).toContainText("השיעור נפתח מחדש");
    await expect(fold.locator("[data-hall-line]")).toHaveCount(0); // not in the download: no place on the hall's computer
    await fold.getByRole("button", { name: "הסרה" }).click();
    await fold.getByRole("button", { name: "כן, להסיר" }).click();
    await expect(toast(page, "המצגת הוסרה")).toBeVisible();
    await expect(fold).toHaveCount(0);
    await expect(page.locator("#presentations-title")).toBeFocused();
    await noSidewaysScroll(page);
  });

  test("a presentation expected and not there: «מעלים אותה כאן» only to whoever is given the upload", async ({ page }) => {
    const expected = lessonAt(2, 960, "lesson", 1);
    await page.goto(`${demoUrl()}/lesson/${expected}?step=sources#presentations`);
    const part = lessonPart(page);
    await expect(part).toBeFocused();
    await expect(part.locator("p").filter({ hasText: "סומן שיש מצגת" })).toHaveText("סומן שיש מצגת, ועוד לא הועלתה. מעלים אותה כאן, או ממלאים «קישור למצגת» למטה.");
    await expect(part.locator("input[type=file]")).toHaveCount(1);
    await page.goto(`${demoUrl()}/lesson/${expected}?as=logistics&step=sources#presentations`);
    await expect(part).toBeFocused();
    await expect(part.locator("p").filter({ hasText: "סומן שיש מצגת" })).toHaveText("סומן שיש מצגת, ועוד לא הועלתה.");
    await expect(part.locator("input[type=file]")).toHaveCount(0);
  });
});
