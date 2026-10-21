// «ייבוא» — last year's files (תשפ"ו) into the database, a global admin's (DESIGN «ייבוא תשפ"ו»; DECISIONS «ייבוא
// תשפ"ו»): what is imported → the table (a paste from Excel, Google Sheets/Docs or Word; or an .xlsx/.docx read in the
// page) → which column is what → «בדיקה מול המאגר» (the pool, and import_lookup for phones) → the review (per kind:
// «כפולה» groups, topics → categories, the sources' words; the escorts' phrases) → the preview «חדש · תואם · עמום ·
// מדולג», a choice for every «עמום», «עריכה» of a speaker card read wrong (matched again) → one commit. Nothing raw is kept anywhere: the rows live in this component's
// state, and go when the commit succeeds, when «ניקוי» is pressed or when the page is left.
import { type ChangeEvent, type ClipboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { answerSaves, type EscortAnswer, escortColumns, escortLike, escortNames, escortsPayload, noteProblem, previewEscorts, readEscorts } from "../../import/escorts";
import { defaultMapping, FIELDS, findHeaderRow, HEADER_SEARCH, type ImportKind, KIND_LABEL, type Mapping, setMapping } from "../../import/fields";
import { IMPORT_LIMITS } from "../../import/limits";
import { hasContact } from "../../import/phone";
import type { Choice } from "../../import/match";
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
import { CandidatesPreview, DoubleGroups, EscortsPreview, LessonsPreview, LinesTable, SourcesTable, SpeakersPreview, TopicsTable } from "./importParts";
import { Badge, Button, Confirm, Field, INPUT, Panel, useSettings } from "./kit";

const DEFAULT_SOURCE: Record<ImportKind, string> = { candidates: "brainstorm-5786", tracking: "tracking-5786", escorts: "" };
const SOURCE_SAID: Record<GridSource, string> = { html: "מהדבקה", text: "מהדבקה", xlsx: "מקובץ Excel", docx: "מקובץ Word", sample: "מהנתונים לדוגמה" };

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
  const [checking, setChecking] = useState(false);
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());
  const [decisions, setDecisions] = useState<Map<number, GroupDecision>>(new Map());
  const [topics, setTopics] = useState<Map<string, number | null>>(new Map());
  const [sources, setSources] = useState<Map<string, SourcesRule>>(new Map());
  /** The escorts' file: each speaker's channel (from the list) and the admin's own note — all that is sent. */
  const [answers, setAnswers] = useState<Map<string, EscortAnswer>>(new Map());
  /** The trainees of the real editions (names only) — read at «בדיקה» for the escorts' file, to say so beside a phrase that names one. */
  const [rosterNames, setRosterNames] = useState<string[]>([]);
  /** Another name of a speaker's cell (a line under it; in the candidates also one beside it): the admin's «מרצה נוסף/ת» / «שיוך מוסדי» / «לא לייבא». */
  const [lineAs, setLineAs] = useState<Map<string, LineAs>>(new Map());
  /** «עריכה»: a card's name, title and affiliation as the admin reads them — by a candidates' row's ref, a sheet speaker's key as read. */
  const [edits, setEdits] = useState<Map<string, SpeakerEdit>>(new Map());
  /** The pool speakers import_lookup was asked about — an edit (or a line made a speaker) that matches another is asked about too. */
  const lookedUp = useRef(new Set<number>());
  const [confirming, setConfirming] = useState(false);
  // a busy button is disabled and loses the focus, and «ביטול» takes the confirm (and its focus) away: each gives it back —
  // to «בדיקה מול המאגר» when the check ends, to «ייבוא» when the confirm is cancelled
  const checkRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState<{ to: "check" | "import"; n: number } | null>(null);
  useEffect(() => {
    if (refocus) (refocus.to === "check" ? checkRef : importRef).current?.focus();
  }, [refocus]);
  const giveBack = (to: "check" | "import") => setRefocus((r) => ({ to, n: (r?.n ?? 0) + 1 }));
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

  /** The mapping a header row gives — never an escorts' column (escortColumns, whatever the header row). */
  const mappingFor = (k: ImportKind, grid: Grid, head: HeaderAt): Mapping => {
    const guard = escortColumns(grid, head);
    return defaultMapping(k, head != null ? grid[head] : null, grid[0]?.length ?? 0).map((f, i) => (guard.has(i) ? null : f));
  };
  /** A new table, or a new kind: the header row (the first of the first rows that looks like one) and the mapping start from what the table says. */
  const reset = (k: ImportKind | null, t: Loaded | null) => {
    const grid = t?.grid ?? [];
    const head = k ? findHeaderRow(k, grid) : null;
    setHeaderRow(head);
    setMap(k ? mappingFor(k, grid, head) : []);
    setEscortAsked(null);
    setCtx(null);
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

  // a change to what is read takes the check (and the choices made on it) away
  useEffect(() => {
    setCtx(null);
    setConfirming(false);
  }, [cand, trackBase, esc]);
  // once checked, the speaker cells' other names are read as the admin turned them
  const track = useMemo(
    () => (trackBase && ctx ? readTracking(grid, read, { ...readOpts, lineAs, edits }) : trackBase),
    [trackBase, ctx, lineAs, edits], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const candSheet = useMemo(
    () => (cand && ctx ? readCandidateSheet(grid, read, { ...readOpts, lineAs, edits }) : null),
    [cand, ctx, lineAs, edits], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const needed = kind ? FIELDS[kind][0] : null; // the speaker's column: nothing is read without it
  const mappedNeeded = !!needed && read.includes(needed.key);
  const whenMissing = kind === "tracking" && !read.includes("when");
  const phrasesMissing = kind === "escorts" && !read.includes("phrases");
  const escortUnanswered = askEscort && escortAsked == null;

  const check = async () => {
    const hadFocus = document.activeElement === checkRef.current;
    setChecking(true);
    setCommitProblem(null);
    try {
      const pool = await data.imports.pool();
      const categories = kind === "tracking" ? (await data.settings.categories()).filter((c) => c.active) : [];
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
      lookedUp.current = new Set(asked.speakerIds);
      if (trackBase) {
        setTopics(new Map(topicsOf(trackBase).map((t) => [t.key, proposedCategory(t.text, categories)])));
        setSources(new Map(sourcesValuesOf(trackBase).map((v) => [v.key, { kind: defaultSourcesRule(v.text).kind, print: defaultSourcesRule(v.text).print }])));
      }
      setLineAs(new Map());
      setEdits(new Map());
      const match = contextOf(pool, lookup);
      if (kind === "escorts") {
        // the trainees of the real editions (names only): said beside a phrase that names one
        const rosters = await Promise.all(editions.filter((e) => e.kind === "real").map((e) => data.settings.roster(e.id)));
        setRosterNames(rosters.flat().map((r) => r.full_name));
        // each speaker's channel starts as the one the phrases suggest («הצעה»); the note starts empty — never the file's
        setAnswers(new Map(previewEscorts(esc ?? [], match).filter((p) => p.status !== "skip").map((p) => [p.key, { channel: p.suggested, note: "" }])));
      }
      setChoices(new Map());
      setCtx({ match, categories });
    } catch (err) {
      notify("error", said(err));
    } finally {
      setChecking(false);
      if (hadFocus) giveBack("check");
    }
  };

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
  const blockers = [
    undecidedCount > 0 && (undecidedCount === 1 ? "מרצה אחד/ת «עמום/ה» מחכה להחלטה" : `${undecidedCount} מרצים «עמומים» מחכים להחלטה`),
    groupsOpen > 0 && (groupsOpen === 1 ? "קבוצת «כפולה» אחת מחכה להחלטה" : `${groupsOpen} קבוצות «כפולה» מחכות להחלטה`),
    linesOpen > 0 && (linesOpen === 1 ? "שם נוסף אחד בתא של מרצה מחכה להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)" : `${linesOpen} שמות נוספים בתאי המרצים מחכים להחלטה (מרצה נוסף/ת, שיוך מוסדי או לא לייבא)`),
    notesWrong > 0 && (notesWrong === 1 ? "בהערה של מרצה אחד/ת יש מה לתקן" : `בהערות של ${notesWrong} מרצים יש מה לתקן`),
    kind === "tracking" && hasContact(labelTrim) && "בשם המחזור יש טלפון או מייל — צריך שם אחר",
    kind !== "escorts" && hasContact(source) && "במקור יש טלפון או מייל — צריך מקור אחר",
    kind === "tracking" && !labelTrim && "צריך שם למחזור בארכיון",
    kind === "tracking" && sameLabel && sameLabel.kind !== "archive" && "יש כבר מחזור פעיל בשם הזה — צריך שם אחר",
    kind === "tracking" && sameLabels.length > 1 && "יותר ממחזור אחד עונה לשם הזה (במירכאות ובגרשיים) — צריך שם אחר",
    kind !== "escorts" && !source.trim() && "צריך מקור למרצים החדשים",
  ].filter((x): x is string => !!x);
  const rowsInCommit =
    commit?.kind === "candidates" ? commit.payload.rows.length : commit?.kind === "tracking" ? commit.payload.lessons.length : commit?.kind === "escorts" ? commit.payload.rows.length : 0;

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

  return (
    <>
      <Panel title="ייבוא תשפ״ו">
        <p className="text-sm text-ink-soft">
          הקבצים של אשתקד נקראים כאן, בדפדפן. שום קובץ ושום שורה גולמית לא נשמרים — לא במסד ולא במכשיר. רק מה שמאשרים בסוף נכתב, בפעולה אחת: הכול או כלום. אפשר
          להריץ שוב את אותו ייבוא: מרצה שכבר במאגר מושלם/ת ולא נוסף/ה שוב, ומחזור ארכיון באותו שם מוחלף.
        </p>
        <fieldset className="mt-3 min-w-0">
          <legend className="mb-1 text-sm font-semibold">מה מייבאים?</legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(KIND_LABEL) as ImportKind[]).map((k) => (
              <label key={k} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 ${kind === k ? "border-ink bg-ink/5 font-semibold" : "border-line bg-card"}`}>
                <input type="radio" name={`${id}-kind`} checked={kind === k} onChange={() => chooseKind(k)} className="accent-ink" />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
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
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 font-semibold hover:bg-line/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
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
        <Panel title="אילו עמודות הן מה">
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
          {askEscort && (
            <div data-undecided={escortAsked == null || undefined} className="mb-3 max-w-xl rounded-lg border border-accent/40 bg-accent-soft p-2.5">
              <label htmlFor={`${id}-escort`} className="mb-1 block text-sm font-semibold">
                באיזו עמודה שמות המלווים?
              </label>
              <select
                id={`${id}-escort`}
                data-decide
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
          <ul aria-label="העמודות" className="grid gap-2 sm:grid-cols-2">
            {names.map((n, i) => {
              const escortCol = escortCols.has(i);
              const samples = escortCol ? [] : rows.map((r) => r.cells[i]).filter(Boolean).slice(0, 2);
              return (
                <li key={i} className="min-w-0 rounded-lg border border-line bg-paper p-2.5">
                  <label htmlFor={`${id}-col-${i}`} className="block text-sm font-semibold break-words">
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {kind === "tracking" && (
              <>
                <Field
                  id={`${id}-label`}
                  label="שם המחזור בארכיון"
                  hint={
                    sameLabel?.kind === "archive"
                      ? `מחזור בשם הזה כבר בארכיון («${sameLabel.label}») — הייבוא יחליף את כל השיעורים שלו (לא אם נכתב על אחד מהם «איך עבר»).`
                      : 'למשל: תשפ"ו. נשמר כמחזור ארכיון, לקריאה בלבד לצוות. מירכאות או גרשיים — אותו שם.'
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
              </>
            )}
            {kind !== "escorts" && (
              <Field id={`${id}-source`} label="מקור (נרשם למרצים החדשים)" hint="מאיפה הגיעו — לסינון ולבדיקה אחר כך.">
                <input id={`${id}-source`} value={source} maxLength={60} onChange={(e) => setSource(e.target.value)} className={INPUT} dir="ltr" aria-describedby={`${id}-source-hint`} />
              </Field>
            )}
            {kind !== "escorts" && (
              <label className="inline-flex min-h-11 cursor-pointer items-start gap-2 self-end">
                <input type="checkbox" checked={genderFromTitle} onChange={(e) => setGenderFromTitle(e.target.checked)} className="mt-1 size-5 accent-ink" />
                <span>
                  מגדר מהתואר: הרב — זכר, הרבנית — נקבה <Badge tone="accent">הצעה</Badge>
                  <span className="block text-xs text-ink-soft">בלי תואר כזה המגדר נשאר לא ידוע. לעולם לא מנחשים לפי שם.</span>
                </span>
              </label>
            )}
            {kind === "tracking" && (
              <p className="text-sm sm:col-span-2">
                שעה לפני 06:30 שייכת ללילה שאחרי היום שנכתב («שלישי 00:30» ← ליל שלישי–רביעי) <Badge tone="accent">הצעה</Badge>
                <span className="block text-xs text-ink-soft">«ליל» ויום אחד בלבד לא נקרא — לא ברור איזה לילה. «ליל שלישי–רביעי» נקרא.</span>
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button ref={checkRef} kind="primary" busy={checking} busyLabel="בודק…" disabled={!mappedNeeded || whenMissing || phrasesMissing || escortUnanswered} onClick={() => void check()}>
              בדיקה מול המאגר
            </Button>
            {escortUnanswered && <span className="text-sm text-ink-soft">צריך לומר באיזו עמודה שמות המלווים (או שאין).</span>}
            {!mappedNeeded && needed && <span className="text-sm text-ink-soft">צריך לבחור את העמודה של «{needed.label}».</span>}
            {whenMissing && <span className="text-sm text-ink-soft">צריך לבחור את העמודה של «יום ושעה».</span>}
            {phrasesMissing && <span className="text-sm text-ink-soft">צריך לבחור עמודה של ניסוחים.</span>}
          </div>
        </Panel>
      )}

      {kind === "tracking" && ctx && track && (
        <>
          {groups.length > 0 && <DoubleGroups groups={groups} read={track} decisions={decisions} onDecide={(g, d) => setDecisions(new Map(decisions).set(g, d))} />}
          <TopicsTable read={track} categories={ctx.categories} value={topics} onChange={(k, v) => setTopics(new Map(topics).set(k, v))} />
          <SourcesTable read={track} value={sources} onChange={(k, v) => setSources(new Map(sources).set(k, v))} />
        </>
      )}

      {ctx && (kind === "tracking" || kind === "candidates") && lines.length > 0 && (
        <LinesTable lines={lines} skipped={lineSkipped} onChoose={(lineId, as) => setLineAs((cur) => new Map(cur).set(lineId, as))} />
      )}
      {ctx && kind === "candidates" && candPreview && candResolved && (
        <CandidatesPreview
          rows={candPreview}
          pool={ctx.match}
          choices={choices}
          resolved={candResolved}
          onChoose={choose}
          titles={titles}
          escorts={escortsNamed}
          onEdit={(ref, e) => edit([ref], e, [ref])}
        />
      )}
      {ctx && kind === "tracking" && trackSpeakers && (
        <>
          <SpeakersPreview
            rows={trackSpeakers}
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
          />
          {plans ? <LessonsPreview plans={plans} categories={ctx.categories} speakers={trackSpeakers} choices={choices} /> : <Panel title="השיעורים"><p className="text-ink-soft">אחרי ההחלטה על כל קבוצות «כפולה» יופיעו כאן השיעורים.</p></Panel>}
        </>
      )}
      {ctx && kind === "escorts" && escPreview && (
        <EscortsPreview
          rows={escPreview}
          pool={ctx.match}
          names={escortsNamed}
          choices={choices}
          onChoose={choose}
          answers={answers}
          onAnswer={(k, a) => setAnswers((cur) => new Map(cur).set(k, a))}
        />
      )}

      {ctx && kind && (
        <Panel title="שמירה">
          {blockers.length > 0 ? (
            <ul className="mb-2 list-disc ps-5 text-sm text-ink-soft">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
              {(undecidedCount > 0 || groupsOpen > 0 || linesOpen > 0 || notesWrong > 0) && (
                <li className="list-none">
                  <Button
                    kind="quiet"
                    onClick={() => {
                      const el = document.querySelector<HTMLElement>("[data-undecided]");
                      el?.scrollIntoView({ block: "center" });
                      // the decision itself (data-decide) — a group's checked choice, else its first; not a field before it
                      const decide = el?.querySelector<HTMLElement>("[data-decide]");
                      const target = decide?.matches("input, select")
                        ? decide
                        : (decide?.querySelector<HTMLElement>("input:checked:not(:disabled)") ??
                          decide?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)") ??
                          el?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled)"));
                      target?.focus();
                    }}
                  >
                    לראשונה שמחכה להחלטה
                  </Button>
                </li>
              )}
            </ul>
          ) : (
            <p className="mb-2 text-sm text-ink-soft">
              {kind === "tracking"
                ? `${rowsInCommit === 1 ? "שיעור אחד" : `${rowsInCommit} שיעורים`} במחזור «${labelTrim}»`
                : kind === "candidates"
                  ? rowsInCommit === 1
                    ? "שורה אחת למאגר"
                    : `${rowsInCommit} שורות למאגר`
                  : rowsInCommit === 1
                    ? "מרצה אחד/ת יושלם/תושלם"
                    : `${rowsInCommit} מרצים יושלמו`}
              {replacing && " — במקום השיעורים שכבר שם"}.
            </p>
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
                giveBack("import");
              }}
            />
          ) : (
            <Button ref={importRef} kind="primary" disabled={!commit || blockers.length > 0 || rowsInCommit === 0} onClick={() => setConfirming(true)}>
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
