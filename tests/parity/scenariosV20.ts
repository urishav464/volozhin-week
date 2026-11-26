// v20's scenario (docs/CONTRACT.md «v20»): escort_view's `presentation` — the state of the lesson's row on the
// presentations page (src/domain/presentations.ts): the CURRENT lead speaker's presentation file, else a presentation
// link, else one the sources expect (presentation / sheet_presentation), else none; a memorial slot none — every step
// pinned (`is`), so a twin that agrees with the other on a WRONG answer still fails. The rota has no parity (no engine:
// DemoRota and src/testing/rotaCases.ts hold it to the SQL). Synthetic only.
import { PPTX, type Step } from "./fixture";

/** The escort's lessons by their place (day|start-end|room) and their presentation's state. */
const states = (...xs: [string, string][]) => xs.map(([at, s]) => `${at}:${s}`).join(" ; ");
const L1 = "1|510-600|בית מדרש";
const L2 = "1|600-690|בית מדרש";
const L3 = "2|510-600|בית מדרש";
const SLOT = "0|780-795|בית מדרש";

export const V20: Record<string, Step[]> = {
  "v20 the escort's page says what presentation each lesson has — the current lead's file, else a link, else one expected, else none; a memorial slot none": [
    { as: "A", propose: "אלפא", cell: [1, 510, 600], is: "ok" },
    { as: "A", close: "אלפא", at: [1, 510], is: "ok" },
    { as: "A", propose: "בטא", cell: [1, 600, 690], is: "ok" },
    { as: "A", close: "בטא", at: [1, 600], is: "ok" },
    { as: "A", propose: "גמא", cell: [2, 510, 600], is: "ok" },
    { as: "A", close: "גמא", at: [2, 510], is: "ok" },
    { as: "A", escort: [1, 510], trainee: "חניכה לדוגמה", selfIntro: false, is: "ok" },
    { as: "A", escort: [1, 600], trainee: "חניכה לדוגמה", selfIntro: false, is: "ok" },
    { as: "A", escort: [2, 510], trainee: "חניכה לדוגמה", selfIntro: false, is: "ok" },
    // a memorial slot with its plan placed and a liaison: on the page, and none (it has no presentation to show)
    { as: "admin", saveFallen: null, name: "חלל/ה לבדיקה א", is: "ok" },
    { as: "E", addSlot: [0, 780, 795], is: "ok" },
    { as: "E", addPlan: "חלל/ה לבדיקה א", is: "ok" },
    { as: "E", placePlan: "חלל/ה לבדיקה א", at: [0, 780], is: "ok" },
    { as: "E", escort: [0, 780], trainee: "חניכה לדוגמה", selfIntro: false, is: "ok" },
    { as: "E", issue: "escort", trainee: "חניכה לדוגמה", name: "e1", is: "ok" },
    // the one key the page gained, beside the old ones
    {
      anon: "escortView", token: "e1", part: "lessonKeys",
      is: "date,day,driver,duty_notes,end_min,escort_note,kind,lesson_id,phone,presentation,room,self_intro,speaker,start_min,ticks,title,transport",
    },
    // nothing yet: none everywhere
    { anon: "escortView", token: "e1", part: "presentation", is: states([SLOT, "none"], [L1, "none"], [L2, "none"], [L3, "none"]) },
    // a link alone; one expected (a sheet and a presentation); the lead's file
    { as: "A", sources: [1, 600], kind: "presentation", print: "none", url: "https://example.org/slides-for-the-test", inReader: false, is: "ok" },
    { as: "A", sources: [2, 510], kind: "sheet_presentation", print: "before", inReader: true, is: "ok" },
    { as: "A", store: [1, 510], file: "deck", mime: PPTX, is: "ok" },
    { as: "A", register: "deck", kind: "presentation", is: "ok" },
    { anon: "escortView", token: "e1", part: "presentation", is: states([SLOT, "none"], [L1, "file"], [L2, "link"], [L3, "missing"]) },
    // a file beats a link; a source file is no presentation (still missing)
    { as: "A", sources: [1, 510], kind: "presentation", print: "none", url: "https://example.org/another-link", inReader: false, is: "ok" },
    { as: "A", store: [2, 510], file: "sheet", is: "ok" },
    { as: "A", register: "sheet", pages: 2, is: "ok" },
    { anon: "escortView", token: "e1", part: "presentation", is: states([SLOT, "none"], [L1, "file"], [L2, "link"], [L3, "missing"]) },
    // reopened: the lesson leaves the page; closed for another speaker, the old deck is a previous speaker's — none
    { as: "A", reopen: [1, 510], is: "ok" },
    { anon: "escortView", token: "e1", part: "presentation", is: states([SLOT, "none"], [L2, "link"], [L3, "missing"]) },
    { as: "A", propose: "פלונית אלמונית", at: [1, 510], is: "ok" },
    { as: "A", close: "פלונית אלמונית", at: [1, 510], is: "ok" },
    { as: "A", escort: [1, 510], trainee: "חניכה לדוגמה", selfIntro: false, is: "ok" },
    { anon: "escortView", token: "e1", part: "presentation", is: states([SLOT, "none"], [L1, "none"], [L2, "link"], [L3, "missing"]) },
    // the new lead's own deck: file again
    { as: "A", store: [1, 510], file: "deck2", mime: PPTX, is: "ok" },
    { as: "A", register: "deck2", kind: "presentation", is: "ok" },
    { anon: "escortView", token: "e1", part: "presentation", is: states([SLOT, "none"], [L1, "file"], [L2, "link"], [L3, "missing"]) },
  ],
};
