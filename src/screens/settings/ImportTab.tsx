// «ייבוא» — last year's files (תשפ"ו) into the database, a global admin's (DESIGN «ייבוא תשפ"ו»; DECISIONS «ייבוא
// תשפ"ו»): what is imported (the candidates first; last year's two files in a fold) → the table (a paste
// from Excel, Google Sheets/Docs or Word; or an .xlsx/.docx read in the page) → the columns, said in one line («זיהינו:
// …»; «שינוי העמודות» folded, open while a required one is missing) — the escorts' column always asked outside it → the
// check against the pool, by itself once what it needs is there (the pool, and import_lookup for phones; debounced, one
// at a time, a stale answer dropped) → «מה ייכנס»: one sentence, «צריך להחליט» (only what holds «ייבוא» back: «עמום»,
// «כפולה», a cell's other name, a note to fix, the archive's name), and the rest folded with its defaults applied → one
// commit. Nothing raw is kept anywhere: the rows live in this component's state, and go when the commit succeeds, when
// «ניקוי» is pressed or when the page is left.
import { type ChangeEvent, type ClipboardEvent, Fragment, type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CommandError } from "../../data/commands";
import { ImportRowError, type ImportCommit, type ImportResult } from "../../data/imports";
import type { DataPort } from "../../data/port";
import { titlesOf } from "../../data/speakerRules";
import type { Category, Edition } from "../../domain/types";
import { errorMessage } from "../../errors";
import { candidatesPayload, contextOf, lookupFor, type MatchContext, previewCandidates, readCandidateSheet, resolvedRows } from "../../import/candidates";
import { gridFromClipboard } from "../../import/clipboard";
import { readDocx } from "../../import/docxRead";
import type { SpeakerEdit } from "../../import/edit";
import { answerSaves, type EscortAnswer, escortColumns, escortFills, escortLike, escortNames, escortsPayload, noteProblem, previewEscorts, readEscorts } from "../../import/escorts";
import { defaultMapping, type FieldDef, FIELDS, findHeaderRow, HEADER_SEARCH, headerKey, type ImportKind, type Mapping, setMapping } from "../../import/fields";
import { IMPORT_LIMITS } from "../../import/limits";
import { hasContact } from "../../import/phone";
import { type Choice, fillPlan, type Resolved, type SpeakerFill } from "../../import/match";
import { columnNames, dataRows, type HeaderAt } from "../../import/rows";
import { sampleGrid } from "../../import/sample";
import { defaultSourcesRule, type SourcesRule } from "../../import/sources";
import type { Grid, GridSource } from "../../import/table";
import {
  archivePayload, doubleGroups, type GroupDecision, type LineAs, openLines, phonesAfterChoices, planLessons, previewTrackingSpeakers, proposedCategory, readTracking, resolvedSpeakers,
  skippedRows, sourcesValuesOf, speakerAliases, topicsOf,
} from "../../import/tracking";
import { labelKey } from "../../data/importRules";
import { readXlsx, type XlsxBook } from "../../import/xlsxRead";
import { CandidatesReview, type DecideCounts, EscortsReview, TrackingReview } from "./importParts";
import { Badge, Button, CHOICE, CHOICE_OFF, CHOICE_ON, Confirm, Field, Fold, INPUT, Panel, useFocusBack, useSettings } from "./kit";

const DEFAULT_SOURCE: Record<ImportKind, string> = { candidates: "brainstorm-5786", tracking: "tracking-5786", escorts: "" };
const SOURCE_SAID: Record<GridSource, string> = { html: "מהדבקה", text: "מהדבקה", xlsx: "מקובץ Excel", docx: "מקובץ Word", sample: "מהנתונים לדוגמה" };
/** What each kind is called here, and the one line under it. */
const KIND_SAID: Record<ImportKind, { label: string; line: string }> = {
  candidates: { label: "רשימת מועמדים (מהסיעור)", line: "מרצים חדשים נכנסים למאגר, ומי שכבר שם מושלם/ת" },
  tracking: { label: "גיליון המעקב", line: "השיעורים של אשתקד נשמרים כמחזור בארכיון, והמרצים שלהם נכנסים למאגר או מושלמים" },
  escorts: { label: "קובץ המלווים", line: "לכל מרצה שבמאגר: ערוץ הקשר מהרשימה והערה משלך — שום מילה מהקובץ" },
};
/** The escorts' file: a header that is the phrases' («ניסוחים») by default — never an escorts' column (escortColumns). */
const PHRASES_HEADERS = new Set(["הערות", "ניסוחים", "איך פונים", "דרכי פנייה"].map(headerKey));
/** The check waits this long after the last change to what is read: one check for a mapping that has settled. */
const CHECK_DELAY_MS = 400;

/** The fields a kind cannot be checked without: the speaker's; the tracking sheet's «יום ושעה»; the escorts' phrases. */
const requiredOf = (k: ImportKind): FieldDef[] => [FIELDS[k][0], ...FIELDS[k].filter((f) => (k === "tracking" && f.key === "when") || (k === "escorts" && f.key === "phrases"))];
/** A field's label without its bracket («שם המרצה (התואר מופרד ממנו)» → «שם המרצה»). */
const short = (label: string) => label.replace(/\s*\(.*\)\s*$/, "");

interface Loaded {
  grid: Grid;
  source: GridSource;
  /** The file's name, said beside it — the file itself is not kept. */
  file?: string;
  /** An .xlsx's sheets (another may be chosen). */
  book?: XlsxBook;
  sheet?: number;
}

/** A refusal's Hebrew (a CommandError's code), or the generic line. */
const said = (e: unknown) => errorMessage(e instanceof CommandError ? e.code : null);

/**
 * «a · b · c» with each part kept whole on its line — a number never left at the end of one line and its words at the
 * start of the next (the text is the same: «a ·», « », «b»…); a part longer than the line still wraps inside itself.
 */
function Joined({ parts }: { parts: readonly string[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          <span className="inline-block max-w-full break-words">
            {p}
            {i < parts.length - 1 ? " ·" : ""}
          </span>
          {i < parts.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </>
  );
}

export function ImportTab({ data, editions, reload }: { data: DataPort; editions: Edition[]; reload: () => Promise<void> }) {
  const { notify, clear } = useSettings();
  const id = useId();
  const [kind, setKind] = useState<ImportKind | null>(null);
  const [table, setTable] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [headerRow, setHeaderRow] = useState<HeaderAt>(0);
  /** Which column the escorts' names are in, as the admin said (or «none») — always asked in the escorts' file, and in
   * the tracking sheet when a header or a first row looks like one (escortLike); never guessed. */
  const [escortAsked, setEscortAsked] = useState<number | "none" | null>(null);
  const [mapping, setMap] = useState<Mapping>([]);
  const [source, setSource] = useState("");
  const [genderFromTitle, setGenderFromTitle] = useState(true);
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [ctx, setCtx] = useState<{ match: MatchContext; categories: Category[] } | null>(null);
  /** The last check failed: said beside «לנסות שוב». */
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  /** The check's status line: «לנסות שוב» leaves the focus there (the button goes as the retry starts). */
  const statusRef = useRef<HTMLParagraphElement>(null);
  /** «צריך להחליט» as the last check's answer found it (null: taken from what waits at the next render). */
  const [decideSnap, setDecideSnap] = useState<ReadonlySet<string> | null>(null);
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [decisions, setDecisions] = useState<Map<number, GroupDecision>>(new Map());
  const [topics, setTopics] = useState<Map<string, number | null>>(new Map());
  const [sources, setSources] = useState<Map<string, SourcesRule>>(new Map());
  /** The escorts' file: each speaker's channel (from the list) and the admin's own note — all that is sent. */
  const [answers, setAnswers] = useState<Map<string, EscortAnswer>>(new Map());
  /** The trainees of the real editions (names only) — read at the check for the escorts' file, to say so beside a phrase that names one. */
  const [rosterNames, setRosterNames] = useState<string[]>([]);
  /** Another name of a speaker's cell (a line under it; in the candidates also one beside it): the admin's «מרצה נוסף/ת» / «שיוך מוסדי» / «לא לייבא». */
  const [lineAs, setLineAs] = useState<Map<string, LineAs>>(new Map());
  /** «עריכה»: a card's name, title and affiliation as the admin reads them — by a candidates' row's ref, a sheet speaker's key as read. */
  const [edits, setEdits] = useState<Map<string, SpeakerEdit>>(new Map());
  /** The pool speakers import_lookup was asked about — an edit (or a line made a speaker) that matches another is asked about too. */
  const lookedUp = useRef(new Set<number>());
  const [confirming, setConfirming] = useState(false);
  // «ביטול» takes the confirm (and its focus) away: «ייבוא» takes it back
  const focusBack = useFocusBack();
  const [committing, setCommitting] = useState(false);
  const [commitProblem, setCommitProblem] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: ImportKind; res: ImportResult; label: string | null } | null>(null);

  // the titles a name is split by (and checked against): the year's edition's, else the default four
  const titlesEdition = editions.find((e) => e.kind === "real" && e.status !== "archived") ?? editions.find((e) => e.kind === "real") ?? null;
  const titles = useMemo(() => titlesOf(titlesEdition?.settings), [titlesEdition]);
  /** A choice for a row (or a speaker); null takes it back. */
  const choose = (k: string, c: Choice | null) =>
    setChoices((cur) => {
      const n = new Map(cur);
      if (c) n.set(k, c);
      else n.delete(k);
      return n;
    });

  /**
   * The mapping a header row gives — never an escorts' column (escortColumns, whatever the header row). The escorts'
   * file also reads «הערות» / «ניסוחים» / «איך פונים» / «דרכי פנייה» as its phrases by itself.
   */
  const mappingFor = (k: ImportKind, grid: Grid, head: HeaderAt): Mapping => {
    const guard = escortColumns(grid, head);
    const header = head != null ? grid[head] : null;
    let m = defaultMapping(k, header, grid[0]?.length ?? 0);
    if (k === "escorts" && header && !m.includes("phrases")) m = m.map((f, i) => (f == null && PHRASES_HEADERS.has(headerKey(header[i] ?? "")) ? "phrases" : f));
    return m.map((f, i) => (guard.has(i) ? null : f));
  };
  /** A new table, or a new kind: the header row (the first of the first rows that looks like one) and the mapping start from what the table says. */
  const reset = (k: ImportKind | null, t: Loaded | null) => {
    const grid = t?.grid ?? [];
    const head = k ? findHeaderRow(k, grid) : null;
    setHeaderRow(head);
    setMap(k ? mappingFor(k, grid, head) : []);
    setEscortAsked(null);
    setCtx(null);
    setCheckProblem(null);
    setDecideSnap(null);
    setChoices(new Map());
    setDecisions(new Map());
    setAnswers(new Map());
    setLineAs(new Map());
    setEdits(new Map());
    setConfirming(false);
    setCommitProblem(null);
  };
  const load = (t: Loaded) => {
    setProblem(null);
    setResult(null);
    setTable(t);
    reset(kind, t);
  };
  const chooseKind = (k: ImportKind) => {
    setKind(k);
    setSource(DEFAULT_SOURCE[k]);
    setResult(null);
    reset(k, table);
  };
  /** «ניקוי»: the table and everything read from it go. */
  const drop = () => {
    setTable(null);
    setTyped("");
    setProblem(null);
    reset(kind, null);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault(); // never inserted, as HTML or as text: only the cells' text is read
    try {
      const { grid, source: from } = gridFromClipboard(e.clipboardData);
      if (grid.length === 0) setProblem("לא נמצאה טבלה בהדבקה. מעתיקים את התאים עצמם (לא רק את הכותרת) ומדביקים שוב.");
      else load({ grid, source: from });
    } catch (err) {
      setProblem(said(err));
    }
  };
  const readTyped = () => {
    try {
      const { grid } = gridFromClipboard({ getData: (t) => (t === "text/plain" ? typed : "") });
      if (grid.length === 0) setProblem("לא נמצאה טבלה בטקסט.");
      else load({ grid, source: "text" });
    } catch (err) {
      setProblem(said(err));
    }
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // the same file may be picked again; the File itself is not kept
    if (!f) return;
    setProblem(null);
    try {
      if (f.size > IMPORT_LIMITS.fileBytes) throw new CommandError("import_too_big");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const name = f.name.toLowerCase();
      if (name.endsWith(".xlsx")) {
        const book = readXlsx(bytes);
        const sheet = Math.max(0, book.sheets.findIndex((s) => !s.hidden));
        load({ grid: book.read(sheet), source: "xlsx", file: f.name, book, sheet });
      } else if (name.endsWith(".docx")) load({ grid: readDocx(bytes), source: "docx", file: f.name });
      else setProblem("אפשר להעלות קובץ xlsx (Excel) או docx (Word). קובץ אחר: מעתיקים ממנו את הטבלה ומדביקים.");
    } catch (err) {
      setProblem(said(err));
    }
  };
  const pickSheet = (i: number) => {
    if (!table?.book) return;
    try {
      load({ ...table, grid: table.book.read(i), sheet: i });
    } catch (err) {
      setProblem(said(err));
    }
  };

  const grid = table?.grid ?? [];
  const names = useMemo(() => columnNames(grid, headerRow), [grid, headerRow]);
  const rows = useMemo(() => dataRows(grid, headerRow), [grid, headerRow]);
  // the escorts' columns: the one the admin names — always asked in the escorts' file, and in the tracking sheet and the
  // candidates when a header or a first row speaks of escorts or trainees (DECISIONS «סבב חמישי», 5) — and, as a guard,
  // any found (a header in the header row, or one in the first rows). Never mapped, never read, whatever the mapping says.
  const foundEscort = useMemo(() => escortColumns(grid, headerRow), [grid, headerRow]);
  const askEscort = !!table && (kind === "escorts" || ((kind === "tracking" || kind === "candidates") && escortLike(grid, headerRow)));
  const escortCols = useMemo(() => (typeof escortAsked === "number" ? new Set([...foundEscort, escortAsked]) : foundEscort), [foundEscort, escortAsked]);
  const read = useMemo(() => mapping.map((f, i) => (escortCols.has(i) ? null : f)), [mapping, escortCols]);
  // the escorts' names — as the file writes them (and, for the escorts' file, as the rosters have them): read in the page
  // only, to say so beside a phrase that names one, and to propose «לא לייבא» for a speaker cell's line that does
  const escortsNamed = useMemo(() => [...escortNames(grid, headerRow, escortCols), ...(kind === "escorts" ? rosterNames : [])], [kind, grid, headerRow, escortCols, rosterNames]);

  // ---- what each kind reads (pure, in memory) — a cell's other names proposed «לא לייבא» when they name an escort
  const readOpts = { headerRow, titles, genderFromTitle, escorts: escortsNamed };
  const cand = useMemo(() => (kind === "candidates" && table ? readCandidateSheet(grid, read, readOpts).rows : null), [kind, table, grid, read, headerRow, titles, genderFromTitle, escortsNamed]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackBase = useMemo(() => (kind === "tracking" && table ? readTracking(grid, read, readOpts) : null), [kind, table, grid, read, headerRow, titles, genderFromTitle, escortsNamed]); // eslint-disable-line react-hooks/exhaustive-deps
  const esc = useMemo(() => (kind === "escorts" && table ? readEscorts(grid, read, { headerRow, titles }) : null), [kind, table, grid, read, headerRow, titles]);

  // once checked, the speaker cells' other names are read as the admin turned them
  const track = useMemo(
    () => (trackBase && ctx ? readTracking(grid, read, { ...readOpts, lineAs, edits }) : trackBase),
    [trackBase, ctx, lineAs, edits], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const candSheet = useMemo(
    () => (cand && ctx ? readCandidateSheet(grid, read, { ...readOpts, lineAs, edits }) : null),
    [cand, ctx, lineAs, edits], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const required = kind ? requiredOf(kind) : [];
  const missing = required.filter((f) => !read.includes(f.key));
  const mappedNeeded = !!kind && read.includes(FIELDS[kind][0].key); // the speaker's column: nothing is read without it
  const whenMissing = kind === "tracking" && !read.includes("when");
  const phrasesMissing = kind === "escorts" && !read.includes("phrases");
  const escortUnanswered = askEscort && escortAsked == null;
  /** What the check needs — the same as «בדיקה מול המאגר» needed: the required columns, and the escorts' question answered. */
  const ready = !!kind && !!table && mappedNeeded && !whenMissing && !phrasesMissing && !escortUnanswered;

  // ---- the check: by itself, CHECK_DELAY_MS after the last change to what is read (the mapping, the header row, the
  // escorts' answer, «מגדר מהתואר»), one at a time; an answer to an older reading is dropped. The archive's name, its
  // date and «מקור» are not read — they never start one.
  const runner = useRef<{ gen: number; busy: boolean; queued: number | null }>({ gen: 0, busy: false, queued: null });
  const check = async (gen: number) => {
    const stale = () => gen !== runner.current.gen;
    setCommitProblem(null);
    try {
      const pool = await data.imports.pool();
      if (stale()) return;
      const categories = kind === "tracking" ? (await data.settings.categories()).filter((c) => c.active) : [];
      if (stale()) return;
      const asked =
        kind === "candidates" ? lookupFor(cand ?? [], pool)
        : kind === "tracking"
          ? lookupFor(
              [
                ...(trackBase?.speakers ?? []).map((s) => ({ data: { key: s.key, phoneKey: s.phoneKey } })),
                // every row's phone: one that goes to its speaker only after the admin's choices is asked about too
                ...(trackBase?.rows ?? []).flatMap((r) => (r.phone?.key ? [{ data: { key: "", phoneKey: r.phone.key } }] : [])),
              ],
              pool,
            )
        : lookupFor((esc ?? []).filter((r) => !r.skip).map((r) => ({ data: { key: r.key, phoneKey: null } })), pool);
      const lookup = await data.imports.lookup(asked.speakerIds, asked.phoneKeys);
      if (stale()) return;
      const match = contextOf(pool, lookup);
      // the trainees of the real editions (names only): said beside a phrase that names one
      const rosters = kind === "escorts" ? await Promise.all(editions.filter((e) => e.kind === "real").map((e) => data.settings.roster(e.id))) : null;
      if (stale()) return;
      lookedUp.current = new Set(asked.speakerIds);
      if (trackBase) {
        setTopics(new Map(topicsOf(trackBase).map((t) => [t.key, proposedCategory(t.text, categories)])));
        setSources(new Map(sourcesValuesOf(trackBase).map((v) => [v.key, { kind: defaultSourcesRule(v.text).kind, print: defaultSourcesRule(v.text).print }])));
      }
      setLineAs(new Map());
      setEdits(new Map());
      if (rosters) {
        setRosterNames(rosters.flat().map((r) => r.full_name));
        // each speaker's channel starts as the one the phrases suggest («הצעה»); the note starts empty — never the file's
        setAnswers(new Map(previewEscorts(esc ?? [], match).filter((p) => p.status !== "skip").map((p) => [p.key, { channel: p.suggested, note: "" }])));
      }
      setChoices(new Map());
      setDecideSnap(null);
      setCtx({ match, categories });
    } catch (err) {
      if (!stale()) setCheckProblem(said(err));
    }
  };
  // the latest render's check: a run that starts later reads what is read now
  const checkNow = useRef(check);
  useLayoutEffect(() => {
    checkNow.current = check;
  });
  /** One check at a time: a newer reading waits for the one running, and the older answer is dropped (check's `stale`). */
  const run = async (gen: number) => {
    const r = runner.current;
    if (gen !== r.gen) return;
    if (r.busy) {
      r.queued = gen;
      return;
    }
    r.busy = true;
    try {
      await checkNow.current(gen);
    } finally {
      r.busy = false;
      const next = r.queued;
      r.queued = null;
      if (next != null) void run(next);
    }
  };
  // a change to what is read takes the check (and the choices made on it) away — and, when the check has what it needs,
  // starts the next one once the changes stop
  useEffect(() => {
    const r = runner.current;
    r.gen += 1;
    const gen = r.gen;
    setCtx(null);
    setConfirming(false);
    setCheckProblem(null);
    if (!ready) return;
    const t = window.setTimeout(() => void run(gen), CHECK_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [ready, cand, trackBase, esc]); // eslint-disable-line react-hooks/exhaustive-deps
  const checking = ready && !ctx && !checkProblem;

  // ---- the preview and the payload
  const candPreview = useMemo(() => (candSheet && ctx ? previewCandidates(candSheet.rows, ctx.match) : null), [candSheet, ctx]);
  // the sheet's speakers first (the pool, then each other), «כמו …» as the lessons' own speakers, then the lessons
  const allTrackSpeakers = useMemo(() => (track && ctx ? previewTrackingSpeakers(track, ctx.match) : null), [track, ctx]);
  const alias = useMemo(() => (allTrackSpeakers ? speakerAliases(allTrackSpeakers, choices) : new Map<string, string>()), [allTrackSpeakers, choices]);
  // the speakers left out: a row's phone goes to the one left (planLessons) — decided after the choices
  const skippedKeys = useMemo(
    () => new Set([...(allTrackSpeakers ? resolvedSpeakers(allTrackSpeakers, choices) : new Map())].filter(([, r]) => r?.action === "skip").map(([k]) => k as string)),
    [allTrackSpeakers, choices],
  );
  const plans = useMemo(
    () => (track && ctx ? planLessons(track, { decisions, categories: topics, sources, alias, skipped: skippedKeys }) : null),
    [track, ctx, decisions, topics, sources, alias, skippedKeys],
  );
  const usedKeys = useMemo(() => new Set((plans ?? []).filter((p) => !p.skip).flatMap((p) => p.speakerKeys)), [plans]);
  const trackSpeakers = useMemo(
    () => allTrackSpeakers?.filter((s) => !plans || usedKeys.has(alias.get(s.speaker.key) ?? s.speaker.key)) ?? null,
    [allTrackSpeakers, plans, usedKeys, alias],
  );
  // the phones the choices give (a row of two, one left): shown on the speaker before the commit, as the payload sends them
  const postPhones = useMemo(() => {
    const m = plans ? phonesAfterChoices(plans) : new Map<string, { value: string; key: string | null; row: number }>();
    for (const k of alias.keys()) m.delete(k);
    return m;
  }, [plans, alias]);
  // the lines still to decide — never one of a row left out anyway (it changes nothing)
  const lineSkipped = useMemo(() => (kind === "tracking" && track ? skippedRows(track, plans) : new Set<number>()), [kind, track, plans]);
  const lines = kind === "tracking" ? (track?.lines ?? []) : kind === "candidates" ? (candSheet?.lines ?? []) : [];
  const linesOpen = kind === "tracking" && track ? openLines(track, plans).length : kind === "candidates" ? lines.filter((l) => l.as == null).length : 0;
  const escPreview = useMemo(() => (esc && ctx ? previewEscorts(esc, ctx.match, escortsNamed) : null), [esc, ctx, escortsNamed]);

  // an edit (or a line made a speaker) may match a pool speaker import_lookup was not asked about: asked now, so that
  // what a match would fill is said right (the commit fills only what is empty in any case)
  useEffect(() => {
    if (!ctx || (kind !== "candidates" && kind !== "tracking")) return;
    const keys = kind === "candidates" ? (candSheet?.rows ?? []).map((r) => r.data) : (track?.speakers ?? []).map((x) => ({ key: x.key, phoneKey: null }));
    const ids = lookupFor(keys.flatMap((d) => (d ? [{ data: { key: d.key, phoneKey: null } }] : [])), ctx.match.pool).speakerIds.filter((n) => !lookedUp.current.has(n));
    if (ids.length === 0) return;
    for (const n of ids) lookedUp.current.add(n);
    void data.imports
      .lookup(ids, [])
      .then((more) => setCtx((cur) => (cur ? { ...cur, match: { ...cur.match, flags: new Map([...cur.match.flags, ...contextOf(cur.match.pool, more).flags]) } } : cur)))
      .catch((err) => notify("error", said(err)));
  }, [ctx, kind, candSheet, track]); // eslint-disable-line react-hooks/exhaustive-deps

  /** «עריכה» saved (or taken back): the choices made on what was read go — the card is matched again. */
  const edit = (keys: string[], e: SpeakerEdit | null, choiceKeys: string[]) => {
    setEdits((cur) => {
      const n = new Map(cur);
      for (const k of keys) {
        if (e) n.set(k, e);
        else n.delete(k);
      }
      return n;
    });
    setChoices((cur) => {
      const n = new Map(cur);
      for (const k of choiceKeys) n.delete(k);
      return n;
    });
    setConfirming(false);
  };
  const groups = useMemo(() => (track ? doubleGroups(track) : []), [track]);

  const labelTrim = labelKey(label);
  // compared as the commit compares it (app.label_key): quote marks and spaces aside
  const sameLabels = editions.filter((e) => labelTrim !== "" && labelKey(e.label) === labelTrim);
  const sameLabel = sameLabels.length === 1 ? sameLabels[0] : undefined;
  const archiveLabels = editions.filter((e) => e.kind === "archive").map((e) => e.label);
  const replacing = kind === "tracking" && sameLabel?.kind === "archive";
  const meta = { label: labelTrim, start_date: startDate || null, source: source.trim(), titles_from: titlesEdition?.id ?? null };
  const commit: ImportCommit | null = useMemo(() => {
    if (!ctx || !kind) return null;
    // another name of a cell not yet decided (a speaker, an affiliation, or neither?): nothing is sent
    if (linesOpen > 0) return null;
    if (kind === "candidates") {
      const p = candPreview && candidatesPayload(candPreview, choices, meta.source, meta.titles_from);
      return p ? { kind, payload: p } : null;
    }
    if (kind === "tracking") {
      const p = plans && trackSpeakers && archivePayload(plans, trackSpeakers, choices, meta);
      return p ? { kind, payload: p } : null;
    }
    const p = escPreview && escortsPayload(escPreview, choices, answers);
    return p ? { kind, payload: p } : null;
  }, [ctx, kind, candPreview, linesOpen, plans, trackSpeakers, track, choices, escPreview, answers, meta.label, meta.start_date, meta.source, meta.titles_from]); // eslint-disable-line react-hooks/exhaustive-deps

  const candResolved = useMemo(() => (candPreview ? resolvedRows(candPreview, choices) : null), [candPreview, choices]);
  const trackResolved = useMemo(() => (trackSpeakers ? resolvedSpeakers(allTrackSpeakers ?? [], choices) : null), [trackSpeakers, allTrackSpeakers, choices]);
  const undecidedCount =
    kind === "candidates" ? (candPreview ?? []).filter((r) => r.data && candResolved?.get(r.ref) == null).length
    : kind === "tracking" ? (trackSpeakers ?? []).filter((s) => trackResolved?.get(s.speaker.key) == null).length
    : (escPreview ?? []).filter((r) => r.status === "ambiguous" && answerSaves(answers.get(r.key)) && !choices.has(r.key)).length;
  const notesWrong = kind === "escorts" ? (escPreview ?? []).filter((r) => r.status !== "skip" && answers.get(r.key)?.channel && noteProblem(answers.get(r.key)!.note)).length : 0;
  const groupsOpen = kind === "tracking" ? groups.filter((g) => !decisions.has(g.id)).length : 0;
  // the archive's name: what is wrong with it (said in «צריך להחליט» and among the blockers)
  const labelProblems = [
    kind === "tracking" && hasContact(labelTrim) && "בשם המחזור יש טלפון או מייל — צריך שם אחר",
    kind === "tracking" && !labelTrim && "צריך שם למחזור בארכיון",
    kind === "tracking" && sameLabel && sameLabel.kind !== "archive" && "יש כבר מחזור פעיל בשם הזה — צריך שם אחר",
    kind === "tracking" && sameLabels.length > 1 && "יותר ממחזור אחד עונה לשם הזה (במירכאות ובגרשיים) — צריך שם אחר",
  ].filter((x): x is string => !!x);
  const blockers = [
    undecidedCount > 0 && (undecidedCount === 1 ? "מרצה אחד/ת «עמום/ה» מחכה להחלטה" : `${undecidedCount} מרצים «עמומים» מחכים להחלטה`),
    groupsOpen > 0 && (groupsOpen === 1 ? "קבוצת «כפולה» אחת מחכה להחלטה" : `${groupsOpen} קבוצות «כפולה» מחכות להחלטה`),
    linesOpen > 0 && (linesOpen === 1 ? "שם נוסף אחד בתא של מרצה מחכה להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)" : `${linesOpen} שמות נוספים בתאי המרצים מחכים להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)`),
    notesWrong > 0 && (notesWrong === 1 ? "בהערה של מרצה אחד/ת יש מה לתקן" : `בהערות של ${notesWrong} מרצים יש מה לתקן`),
    ...labelProblems,
    kind !== "escorts" && hasContact(source) && "במקור יש טלפון או מייל — צריך מקור אחר (ב«שינוי העמודות»)",
    kind !== "escorts" && !source.trim() && "צריך מקור למרצים החדשים (ב«שינוי העמודות»)",
  ].filter((x): x is string => !!x);
  const rowsInCommit =
    commit?.kind === "candidates" ? commit.payload.rows.length : commit?.kind === "tracking" ? commit.payload.lessons.length : commit?.kind === "escorts" ? commit.payload.rows.length : 0;

  // ---- «צריך להחליט»: what waits now, by id — «sp:<a row's ref, a card's first key as read>», «g:<group>», «l:<line>»,
  // «esc:<key>», «label»
  const waitingIds = new Set<string>();
  if (ctx && kind === "candidates") {
    for (const l of lines) if (l.as == null) waitingIds.add(`l:${l.id}`);
    for (const r of candPreview ?? []) if (r.data && candResolved?.get(r.ref) == null) waitingIds.add(`sp:${r.ref}`);
  } else if (ctx && kind === "tracking" && track) {
    for (const g of groups) if (!decisions.has(g.id)) waitingIds.add(`g:${g.id}`);
    for (const l of openLines(track, plans)) waitingIds.add(`l:${l.id}`);
    for (const s of trackSpeakers ?? []) if (trackResolved?.get(s.speaker.key) == null) waitingIds.add(`sp:${s.speaker.from[0]}`);
    if (labelProblems.length > 0) waitingIds.add("label");
  } else if (ctx && kind === "escorts") {
    for (const r of escPreview ?? []) {
      const a = answers.get(r.key);
      if ((r.status === "ambiguous" && answerSaves(a) && !choices.has(r.key)) || (r.status !== "skip" && a?.channel && noteProblem(a.note))) waitingIds.add(`esc:${r.key}`);
    }
  }
  // the set is the check's: taken once its answer is in, and kept while the admin decides (an item decided stays where
  // it is, showing its choice) — until the next check
  const decide = decideSnap ?? waitingIds;
  useEffect(() => {
    if (ctx && decideSnap == null) setDecideSnap(waitingIds);
  }, [ctx, decideSnap]); // eslint-disable-line react-hooks/exhaustive-deps
  const waitingTotal = undecidedCount + groupsOpen + linesOpen + notesWrong + (labelProblems.length > 0 ? 1 : 0);
  // what waits now but not in the check's «צריך להחליט» (it began to wait after the check: a channel chosen, a note
  // typed, a line made a speaker, the name cleared) — counted there and said so, never moved under the admin's hands
  const waitingElsewhere = [...waitingIds].filter((x) => !decide.has(x)).length;

  // ---- one sentence: what the commit would do, from what it is made of (the resolved choices, the plans)
  const summary = (() => {
    const fresh = (n: number) => (n === 1 ? "מרצה אחד/ת חדש/ה" : `${n} מרצים חדשים`);
    const filled = (n: number, alone: boolean) => (n === 1 ? "מרצה אחד/ת יושלם/תושלם" : alone ? `${n} מרצים יושלמו` : `${n} יושלמו`);
    // the result's own words for a speaker of the pool the commit fills nothing in
    const there = (n: number, alone: boolean) => (n === 1 ? "מרצה אחד/ת כבר במאגר" : alone ? `${n} מרצים כבר במאגר` : `${n} כבר במאגר`);
    const parts: (string | false)[] = [];
    const poolSpeaker = (n: number) => ctx?.match.pool.find((s) => s.id === n);
    /** «יושלם» only when a row merged into the speaker fills something (fillPlan — as its card says it), else «כבר במאגר». */
    const fills = (target: number, f: SpeakerFill | null) => {
      const t = poolSpeaker(target);
      return !!t && !!f && fillPlan(t, ctx?.match.flags.get(t.id), f).length > 0;
    };
    const say = (n: number, m: number, k: number) => parts.push(n > 0 && fresh(n), m > 0 && filled(m, n === 0), k > 0 && there(k, n === 0 && m === 0));
    const speakersOf = (rows: Iterable<{ action: Resolved | null | undefined; fill: SpeakerFill | null }>) => {
      let n = 0;
      const merged = new Map<number, boolean>();
      for (const { action: a, fill } of rows) {
        if (a?.action === "new" && a.as == null) n += 1;
        if (a?.action === "merge") merged.set(a.target, (merged.get(a.target) ?? false) || fills(a.target, fill));
      }
      const m = [...merged.values()].filter(Boolean).length;
      say(n, m, merged.size - m);
    };
    if (kind === "candidates" && candPreview && candResolved) {
      speakersOf(candPreview.filter((r) => r.data).map((r) => ({ action: candResolved.get(r.ref), fill: r.data })));
    } else if (kind === "tracking" && trackSpeakers && trackResolved) {
      if (plans) {
        const skippedSpeaker = (k: string) => trackResolved.get(k)?.action === "skip";
        const lessons = plans.filter((p) => !p.skip && !p.speakerKeys.every(skippedSpeaker)).length;
        parts.push(lessons === 1 ? "שיעור אחד" : `${lessons} שיעורים`);
      }
      // what its card offers a match to fill: its phone may be one the choices give it (postPhones)
      speakersOf(
        trackSpeakers.map(({ speaker: s }) => ({
          action: trackResolved.get(s.key),
          fill: { title: s.title, gender: s.gender, affiliation: s.affiliation, topics: [], phone: s.phone ?? postPhones.get(s.key)?.value ?? null, email: s.email, notes: null },
        })),
      );
    } else if (kind === "escorts" && escPreview) {
      // as escortsPayload sends them: a speaker of the pool whose answer saves something — «יושלם» when it fills what is empty
      let m = 0;
      let k = 0;
      for (const r of escPreview) {
        const a = answers.get(r.key);
        if (r.status === "skip" || !answerSaves(a)) continue;
        const c = choices.get(r.key);
        const t = r.status === "match" ? r.target : c?.action === "merge" ? poolSpeaker(c.target) : undefined;
        if (!t) continue;
        if (escortFills(t, ctx?.match.flags.get(t.id), a).length > 0) m += 1;
        else k += 1;
      }
      say(0, m, k);
    }
    parts.push(waitingTotal > 0 && (waitingTotal === 1 ? "1 מחכה להחלטה" : `${waitingTotal} מחכים להחלטה`));
    const said = parts.filter((x): x is string => !!x);
    return said.length ? said : ["אין מה לייבא"];
  })();

  // «מקור» is in «שינוי העמודות» (folded): what is wrong with it holds «ייבוא» back too
  const sourceProblem = kind !== "escorts" && (hasContact(source) || !source.trim());
  /** «לראשונה שמחכה להחלטה»: to the first that waits — opened if it is folded — and its decision focused. */
  const toFirstUndecided = () => {
    const el = document.querySelector<HTMLElement>("[data-undecided]");
    // nothing marked: what waits is a field beside the columns — the archive's name, typed before the check (so it is
    // not in «צריך להחליט»), else «מקור», folded in «שינוי העמודות» (opened for it)
    if (!el && (labelProblems.length > 0 || sourceProblem)) {
      const field = document.getElementById(labelProblems.length > 0 ? `${id}-label` : `${id}-source`);
      for (let d = field?.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
      field?.scrollIntoView({ block: "center" });
      field?.focus();
      return;
    }
    for (let d = el?.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
    el?.scrollIntoView({ block: "center" });
    // a field that lives elsewhere (the archive's name, beside the columns)
    const goto = el?.dataset.goto;
    if (goto) {
      document.getElementById(goto)?.focus();
      return;
    }
    // the decision itself — marked data-decide where a field comes before it (an open «עריכה» form, the escorts' channel
    // and note): a group's checked choice, else its first; else the row's first control
    const decide = el?.querySelector<HTMLElement>("[data-decide]");
    const target = decide?.matches("input, select")
      ? decide
      : (decide?.querySelector<HTMLElement>("input:checked:not(:disabled)") ??
        decide?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)") ??
        el?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)"));
    target?.focus();
  };
  // «צריך להחליט (N)»: N is what waits now, as the summary and the blockers count it — not only the check's set
  const decideCounts: DecideCounts = { waiting: waitingTotal, elsewhere: waitingElsewhere, toFirst: toFirstUndecided };

  const doCommit = async () => {
    if (!commit) return;
    clear();
    setCommitting(true);
    setCommitProblem(null);
    try {
      const res = await data.imports.commit(commit);
      setResult({ kind: commit.kind, res, label: commit.kind === "tracking" ? commit.payload.label : null });
      notify("ok", "הייבוא נשמר");
      drop(); // nothing raw stays — not even in this page's memory
      if (commit.kind === "tracking") await reload();
    } catch (err) {
      if (err instanceof ImportRowError) setCommitProblem(`שום דבר לא נשמר. שורה ${err.row}: ${errorMessage(err.reason)}`);
      else setCommitProblem(`שום דבר לא נשמר. ${said(err)}`);
    } finally {
      setCommitting(false);
      setConfirming(false);
    }
  };

  const kindChoice = (k: ImportKind) => (
    <div key={k} className="min-w-0">
      <label className={`${CHOICE} ${kind === k ? CHOICE_ON : CHOICE_OFF}`}>
        <input type="radio" name={`${id}-kind`} checked={kind === k} onChange={() => chooseKind(k)} aria-describedby={`${id}-kind-${k}`} className="accent-navy" />
        {KIND_SAID[k].label}
      </label>
      <p id={`${id}-kind-${k}`} className="mt-0.5 ps-1 text-xs text-ink-soft">
        {KIND_SAID[k].line}
      </p>
    </div>
  );
  // the columns as read: «שם המרצה ← «מרצה»» — only those mapped, in the kind's order
  const recognized = kind
    ? FIELDS[kind].flatMap((f) => {
        const cols = read.flatMap((k, i) => (k === f.key ? [`«${names[i]}»`] : []));
        return cols.length ? [`${short(f.label)} ← ${cols.join(", ")}`] : [];
      })
    : [];

  return (
    <>
      <Panel title="ייבוא תשפ״ו">
        <p className="text-sm text-ink-soft">הקובץ נקרא רק בדפדפן. נשמר רק מה שמאשרים — הכול או כלום, ואפשר להריץ שוב.</p>
        <fieldset className="mt-3 min-w-0">
          <legend className="mb-1 text-sm font-bold text-ink">מה מייבאים?</legend>
          {kindChoice("candidates")}
          {/* left as the admin leaves it — never closed by a choice: the arrows go on between the three radios */}
          <Fold title="קבצים של אשתקד" hint="גיליון המעקב, קובץ המלווים" size="sm" className="mt-1">
            <div className="flex flex-col gap-2">
              {kindChoice("tracking")}
              {kindChoice("escorts")}
            </div>
          </Fold>
        </fieldset>
      </Panel>

      {result && <ResultPanel r={result} />}

      {kind && (
        <Panel title="הטבלה" aside={table ? `${rows.length === 1 ? "שורה אחת" : `${rows.length} שורות`} ו-${grid[0]?.length ?? 0} עמודות ${SOURCE_SAID[table.source]}${table.file ? ` (${table.file})` : ""}` : undefined}>
          {!table ? (
            <div className="space-y-3">
              <Field
                id={`${id}-paste`}
                label="הדבקת טבלה"
                hint={
                  <>
                    מסמנים את הטבלה <span className="whitespace-nowrap">ב-Excel</span>, <span className="whitespace-nowrap">ב-Google Sheets</span>,{" "}
                    <span className="whitespace-nowrap">ב-Google Docs</span> או <span className="whitespace-nowrap">ב-Word</span>, מעתיקים, ומדביקים כאן (Ctrl+V). רק הטקסט של התאים נקרא.
                  </>
                }
              >
                <textarea
                  id={`${id}-paste`}
                  rows={3}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onPaste={onPaste}
                  aria-describedby={`${id}-paste-hint`}
                  className={`${INPUT} py-2`}
                  placeholder="הדביקו כאן את הטבלה"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                {typed.trim() && <Button onClick={readTyped}>קריאת הטקסט שהוקלד</Button>}
                {/* the input is 1px and clipped: the focus ring is drawn on the label that looks like the button */}
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-navy bg-card px-3 font-bold text-navy transition-colors duration-150 hover:bg-accent-soft sm:px-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
                  העלאת קובץ xlsx או docx
                  <input type="file" accept=".xlsx,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => void onFile(e)} className="sr-only" />
                </label>
                {data.mode === "demo" && (
                  <Button kind="quiet" onClick={() => load({ grid: sampleGrid(kind), source: "sample" })}>
                    מילוי בנתונים לדוגמה
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {table.book && table.book.sheets.length > 1 && (
                <div className="flex items-center gap-2">
                  <label htmlFor={`${id}-sheet`} className="text-sm font-semibold">
                    גיליון
                  </label>
                  <select id={`${id}-sheet`} value={table.sheet ?? 0} onChange={(e) => pickSheet(Number(e.target.value))} className={`${INPUT} w-auto`}>
                    {table.book.sheets.map((s, i) => (
                      <option key={i} value={i}>
                        {s.name}
                        {s.hidden ? " (מוסתר)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <Button onClick={drop}>ניקוי — טבלה אחרת</Button>
            </div>
          )}
          {problem && (
            <p role="alert" className="mt-2 text-sm text-bad">
              {problem}
            </p>
          )}
        </Panel>
      )}

      {kind && table && (
        <Panel title="העמודות">
          {askEscort && (
            <div data-undecided={escortAsked == null || undefined} className="mb-3 max-w-xl rounded-lg border border-accent/40 bg-accent-soft p-2.5">
              <label htmlFor={`${id}-escort`} className="mb-1 block text-sm font-semibold">
                באיזו עמודה שמות המלווים?
              </label>
              <select
                id={`${id}-escort`}
                value={escortAsked ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : e.target.value === "none" ? "none" : Number(e.target.value);
                  setEscortAsked(v);
                  if (typeof v === "number") setMap((cur) => cur.map((f, i) => (i === v ? null : f)));
                }}
                aria-describedby={`${id}-escort-hint`}
                className={INPUT}
              >
                <option value="">צריך לבחור</option>
                <option value="none">אין בקובץ עמודה כזו</option>
                {names.map((n, i) => (
                  <option key={i} value={i}>
                    {`${n}: ${rows.map((r) => r.cells[i]).filter(Boolean).slice(0, 2).join(" · ").slice(0, 60) || "ריקה"}`}
                  </option>
                ))}
              </select>
              <p id={`${id}-escort-hint`} className="mt-1 text-xs text-ink-soft">
                {kind === "escorts"
                  ? "לא מנחשים לבד. העמודה שנבחרת לא נקראת, והשמות שבה לא נשמרים. גם שום ניסוח מהקובץ לא נשמר — רק הערוץ שבוחרים לכל מרצה וההערה שכותבים."
                  : "בטבלה יש כותרת או שורה שמדברת על מלווים או חניכים. העמודה שנבחרת לא נקראת, והשמות שבה לא נשמרים; שם שלהם בתא של מרצה מוצע «לא לייבא»."}
              </p>
            </div>
          )}

          <div data-columns className="mb-3 space-y-1 text-sm">
            {missing.map((f) => (
              <p key={f.key} className="font-bold text-ink">
                צריך לבחור את העמודה של «{short(f.label)}» — ב«שינוי העמודות».
              </p>
            ))}
            <p className="break-words">
              {recognized.length ? (
                <>
                  {"זיהינו: "}
                  <Joined parts={recognized} />
                </>
              ) : (
                "לא זוהתה אף עמודה."
              )}
            </p>
          </div>

          {kind === "tracking" && (
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <Field
                id={`${id}-label`}
                label="שם המחזור בארכיון"
                hint={
                  sameLabel?.kind === "archive"
                    ? `מחזור בשם הזה כבר בארכיון («${sameLabel.label}») — הייבוא יחליף את כל השיעורים שלו (לא אם נכתב על אחד מהם «איך עבר»).`
                    : 'למשל: תשפ"ו. מירכאות או גרשיים — אותו שם.'
                }
              >
                <input id={`${id}-label`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className={INPUT} aria-describedby={`${id}-label-hint`} list={`${id}-archives`} />
                <datalist id={`${id}-archives`}>
                  {archiveLabels.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </Field>
              <Field id={`${id}-date`} label="תאריך הפתיחה של אשתקד (יום ראשון, לא חובה)">
                <input id={`${id}-date`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} />
              </Field>
            </div>
          )}

          <ColumnsFold missing={missing.length > 0} hint={kind === "escorts" ? "שורת הכותרות, מה כל עמודה" : "שורת הכותרות, מה כל עמודה, מקור, מגדר"}>
            <div className="mb-3 max-w-xl">
              <label htmlFor={`${id}-header`} className="mb-1 block text-sm font-semibold">
                שורת הכותרות
              </label>
              <select
                id={`${id}-header`}
                value={headerRow ?? ""}
                onChange={(e) => {
                  const head = e.target.value === "" ? null : Number(e.target.value);
                  setHeaderRow(head);
                  setEscortAsked(null);
                  setMap(mappingFor(kind, grid, head));
                }}
                aria-describedby={`${id}-header-hint`}
                className={INPUT}
              >
                <option value="">אין שורת כותרות — כל השורות הן נתונים</option>
                {grid.slice(0, HEADER_SEARCH).map((r, i) => (
                  <option key={i} value={i}>
                    {`שורה ${i + 1}: ${r.filter(Boolean).slice(0, 4).join(" · ").slice(0, 70)}`}
                  </option>
                ))}
              </select>
              <p id={`${id}-header-hint`} className="mt-1 text-xs text-ink-soft">
                {headerRow == null
                  ? "כל השורות נקראות כנתונים. אם יש שורת כותרות (בחמש השורות הראשונות) — בוחרים אותה כאן."
                  : headerRow > 0
                    ? `השורות שמעליה (${headerRow === 1 ? "שורה 1" : `שורות 1–${headerRow}`}: כותרת או הסבר) לא נקראות.`
                    : "אפשר לבחור שורה אחרת, אם מעל הכותרות יש כותרת או הסבר."}
              </p>
            </div>
            <ul aria-label="העמודות" className="grid gap-2 sm:grid-cols-2">
              {names.map((n, i) => {
                const escortCol = escortCols.has(i);
                const samples = escortCol ? [] : rows.map((r) => r.cells[i]).filter(Boolean).slice(0, 2);
                return (
                  <li key={i} className="min-w-0 rounded-lg border border-line bg-paper-light p-2.5">
                    <label htmlFor={`${id}-col-${i}`} className="block text-sm font-bold break-words text-navy">
                      {n}
                    </label>
                    <p className="mb-1 truncate text-xs text-ink-soft" title={samples.join(" · ")}>
                      {escortCol ? "שמות המלווים" : samples.length ? `לדוגמה: ${samples.join(" · ")}` : "ריקה"}
                    </p>
                    <select
                      id={`${id}-col-${i}`}
                      value={read[i] ?? ""}
                      disabled={escortCol}
                      onChange={(e) => setMap(setMapping(kind, mapping, i, e.target.value || null))}
                      className={INPUT}
                    >
                      <option value="">לא לייבא</option>
                      {FIELDS[kind].map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    {escortCol && <p className="mt-1 text-xs text-ink-soft">שמות המלווים לא מיובאים.</p>}
                  </li>
                );
              })}
            </ul>
            {kind !== "escorts" && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field id={`${id}-source`} label="מקור (נרשם למרצים החדשים)" hint="מאיפה הגיעו — לסינון ולבדיקה אחר כך.">
                  <input id={`${id}-source`} value={source} maxLength={60} onChange={(e) => setSource(e.target.value)} className={INPUT} dir="ltr" aria-describedby={`${id}-source-hint`} />
                </Field>
                <label className="inline-flex min-h-11 cursor-pointer items-start gap-2 self-end">
                  <input type="checkbox" checked={genderFromTitle} onChange={(e) => setGenderFromTitle(e.target.checked)} className="mt-1 size-5 accent-navy" />
                  <span>
                    מגדר מהתואר: הרב — זכר, הרבנית — נקבה (גם עם ד״ר) <Badge tone="accent">הצעה</Badge>
                    <span className="block text-xs text-ink-soft">בלי תואר כזה המגדר נשאר לא ידוע. לעולם לא מנחשים לפי שם.</span>
                  </span>
                </label>
              </div>
            )}
          </ColumnsFold>

          <div className="mt-3 space-y-1 text-sm">
            {escortUnanswered && <p className="text-ink-soft">צריך לומר באיזו עמודה שמות המלווים (או שאין).</p>}
            <p ref={statusRef} tabIndex={-1} role="status" className="text-ink-soft">
              {checking ? "בודקים מול המאגר…" : ctx ? "נבדק מול המאגר." : ""}
            </p>
            {checkProblem && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-bad">
                <span>{checkProblem}</span>
                <Button
                  onClick={() => {
                    // the button goes with the problem: the keyboard waits on the line that says how the check goes
                    statusRef.current?.focus();
                    setCheckProblem(null);
                    void run(runner.current.gen);
                  }}
                >
                  לנסות שוב
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}

      {ctx && kind && (
        <Panel title="מה ייכנס">
          <p data-summary="review" className="mb-3 font-bold text-navy">
            <Joined parts={summary} />
          </p>
          {kind === "candidates" && candPreview && candResolved && (
            <CandidatesReview
              rows={candPreview}
              pool={ctx.match}
              choices={choices}
              resolved={candResolved}
              onChoose={choose}
              titles={titles}
              escorts={escortsNamed}
              onEdit={(ref, e) => edit([ref], e, [ref])}
              lines={lines}
              onLine={(lineId, as) => setLineAs((cur) => new Map(cur).set(lineId, as))}
              decide={decide}
              counts={decideCounts}
            />
          )}
          {kind === "tracking" && track && trackSpeakers && (
            <TrackingReview
              read={track}
              groups={groups}
              decisions={decisions}
              onDecide={(g, d) => setDecisions((cur) => new Map(cur).set(g, d))}
              categories={ctx.categories}
              topics={topics}
              onTopic={(k, v) => setTopics((cur) => new Map(cur).set(k, v))}
              sources={sources}
              onSource={(k, v) => setSources((cur) => new Map(cur).set(k, v))}
              sourcesMapped={read.includes("sources")}
              plans={plans}
              speakers={trackSpeakers}
              pool={ctx.match}
              choices={choices}
              resolved={trackResolved ?? new Map()}
              onChoose={choose}
              postPhones={postPhones}
              titles={titles}
              escorts={escortsNamed}
              lines={lines}
              skipped={lineSkipped}
              onLine={(lineId, as) => setLineAs((cur) => new Map(cur).set(lineId, as))}
              onEdit={(from, e) => {
                const now = (allTrackSpeakers ?? []).filter((x) => x.speaker.from.some((k) => from.includes(k))).map((x) => x.speaker.key);
                edit(from, e, [...from, ...now]);
              }}
              decide={decide}
              counts={decideCounts}
              label={{ fieldId: `${id}-label`, text: label.trim(), problem: labelProblems[0] ?? null }}
            />
          )}
          {kind === "escorts" && escPreview && (
            <EscortsReview
              rows={escPreview}
              pool={ctx.match}
              names={escortsNamed}
              choices={choices}
              onChoose={choose}
              answers={answers}
              onAnswer={(k, a) => setAnswers((cur) => new Map(cur).set(k, a))}
              decide={decide}
              counts={decideCounts}
            />
          )}
        </Panel>
      )}

      {ctx && kind && (
        <Panel title="שמירה">
          <p data-summary="commit" className="mb-2 text-sm">
            <Joined parts={summary} />
            {kind === "tracking" && labelTrim && ` — במחזור «${labelTrim}»`}
            {replacing && ", במקום השיעורים שכבר שם"}
          </p>
          {blockers.length > 0 && (
            <ul className="mb-2 list-disc ps-5 text-sm text-ink-soft">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
              {(waitingTotal > 0 || sourceProblem) && (
                <li className="list-none">
                  <Button kind="quiet" onClick={toFirstUndecided}>
                    לראשונה שמחכה להחלטה
                  </Button>
                </li>
              )}
            </ul>
          )}
          {confirming ? (
            <Confirm
              // replacing an archive's lessons deletes them: styled as such, the focus on «ביטול» (a first import only adds)
              danger={replacing}
              text={
                replacing
                  ? `השיעורים שכבר במחזור «${sameLabel!.label}» יימחקו ויוחלפו בשיעורים מהגיליון הזה. אין ביטול — כדי לחזור, מייבאים שוב את הגיליון הקודם.`
                  : "לייבא? הכול נשמר בפעולה אחת."
              }
              confirm={replacing ? "כן, להחליף" : "ייבוא"}
              busy={committing}
              onConfirm={() => void doCommit()}
              onCancel={() => {
                setConfirming(false);
                focusBack.back();
              }}
            />
          ) : (
            <Button ref={focusBack.ref()} kind="primary" disabled={!commit || blockers.length > 0 || rowsInCommit === 0} onClick={() => setConfirming(true)}>
              ייבוא
            </Button>
          )}
          {commitProblem && (
            <p role="alert" className="mt-2 text-sm text-bad">
              {commitProblem}
            </p>
          )}
        </Panel>
      )}
    </>
  );
}

/**
 * «שינוי העמודות» — the header row, each column's field, «מקור» and «מגדר מהתואר», folded: open from the start when a
 * required column is missing, and opened when one goes missing later (the escorts' answer may take a column away) —
 * never closed under the admin's hands.
 */
function ColumnsFold({ missing, hint, children }: { missing: boolean; hint: string; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const d = wrap.current?.querySelector("details");
    if (missing && d && !d.open) d.open = true;
  }, [missing]);
  return (
    <div ref={wrap}>
      <Fold title="שינוי העמודות" hint={hint}>
        {children}
      </Fold>
    </div>
  );
}

/** «מרצה אחד/ת <one>» or «N <many>». */
const count = (n: number, one: string, many: string) => (n === 1 ? `מרצה אחד/ת ${one}` : `${n} ${many}`);

function ResultPanel({ r }: { r: { kind: ImportKind; res: ImportResult; label: string | null } }) {
  const { res } = r;
  const parts = [
    res.created > 0 && (res.created === 1 ? "נוסף/ה מרצה אחד/ת למאגר (ממתין/ה לאישור)" : `נוספו ${res.created} מרצים למאגר (ממתינים לאישור)`),
    res.merged > 0 && (res.merged === 1 ? "מרצה אחד/ת כבר במאגר" : `${res.merged} כבר במאגר`),
    res.filled > 0 && count(res.filled, "הושלם/ה בפרטים שהיו חסרים", "הושלמו בפרטים שהיו חסרים"),
    // a phone or an e-mail apart from a note (the escorts' file: «איך פונים»)
    res.contacts > 0 && (r.kind === "escorts" ? count(res.contacts, "קיבל/ה «איך פונים»", "קיבלו «איך פונים»") : count(res.contacts, "קיבל/ה טלפון או מייל", "קיבלו טלפון או מייל")),
    res.notes > 0 && count(res.notes, "קיבל/ה הערה", "קיבלו הערה"),
    r.kind === "tracking" &&
      `${res.lessons === 1 ? "שיעור אחד" : `${res.lessons} שיעורים`} במחזור «${r.label}»${res.replaced ? ` (במקום ${res.replaced === 1 ? "השיעור שהיה" : `${res.replaced} שהיו`})` : ""}`,
  ].filter(Boolean);
  return (
    <Panel title="הייבוא נשמר">
      <p role="status" className="text-sm">
        {parts.join(" · ") || "לא היה מה להוסיף או להשלים."}
      </p>
      {r.kind !== "escorts" && res.created > 0 && <p className="mt-1 text-sm text-ink-soft">המרצים החדשים ממתינים לאישור במסך «אישורים».</p>}
    </Panel>
  );
}
