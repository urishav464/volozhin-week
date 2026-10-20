// «ייבוא» — last year's files (תשפ"ו) into the database, a global admin's (DESIGN «ייבוא תשפ"ו»; DECISIONS «ייבוא
// תשפ"ו»): what is imported → the table (a paste from Excel, Google Sheets/Docs or Word; or an .xlsx/.docx read in the
// page) → which column is what → «בדיקה מול המאגר» (the pool, and import_lookup for phones) → the review (per kind:
// «כפולה» groups, topics → categories, the sources' words; the escorts' phrases) → the preview «חדש · תואם · עמום ·
// מדולג», a choice for every «עמום» → one commit. Nothing raw is kept anywhere: the rows live in this component's
// state, and go when the commit succeeds, when «ניקוי» is pressed or when the page is left.
import { type ChangeEvent, type ClipboardEvent, useEffect, useId, useMemo, useState } from "react";
import { CommandError } from "../../data/commands";
import { ImportRowError, type ImportCommit, type ImportResult } from "../../data/imports";
import type { DataPort } from "../../data/port";
import { titlesOf } from "../../data/speakerRules";
import type { Category, Edition } from "../../domain/types";
import { errorMessage } from "../../errors";
import { candidatesPayload, contextOf, lookupFor, type MatchContext, previewCandidates, readCandidates } from "../../import/candidates";
import { gridFromClipboard } from "../../import/clipboard";
import { readDocx } from "../../import/docxRead";
import { ESCORT_COLUMN, escortsPayload, phrasesOf, previewEscorts, readEscorts } from "../../import/escorts";
import { defaultMapping, FIELDS, type ImportKind, KIND_LABEL, looksLikeHeader, type Mapping, setMapping } from "../../import/fields";
import { IMPORT_LIMITS } from "../../import/limits";
import type { Choice } from "../../import/match";
import { columnNames, dataRows } from "../../import/rows";
import { sampleGrid } from "../../import/sample";
import { defaultSourcesRule, type SourcesRule } from "../../import/sources";
import type { Grid, GridSource } from "../../import/table";
import { archivePayload, doubleGroups, type GroupDecision, planLessons, previewTrackingSpeakers, proposedCategory, readTracking, sourcesValuesOf, topicsOf } from "../../import/tracking";
import { readXlsx, type XlsxBook } from "../../import/xlsxRead";
import { CandidatesPreview, DoubleGroups, EscortsPreview, LessonsPreview, PhrasesTable, SourcesTable, SpeakersPreview, TopicsTable } from "./importParts";
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
  const [headerRow, setHeaderRow] = useState(true);
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
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
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

  /** A new table, or a new kind: the header row and the mapping start from what the table says. */
  const reset = (k: ImportKind | null, t: Loaded | null) => {
    const grid = t?.grid ?? [];
    const head = !!k && grid.length > 0 && looksLikeHeader(k, grid[0]);
    setHeaderRow(head);
    setMap(k ? defaultMapping(k, head ? grid[0] : null, grid[0]?.length ?? 0) : []);
    setCtx(null);
    setChoices(new Map());
    setDecisions(new Map());
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

  // ---- what each kind reads (pure, in memory)
  const readOpts = { headerRow, titles, genderFromTitle };
  const cand = useMemo(() => (kind === "candidates" && table ? readCandidates(grid, mapping, readOpts) : null), [kind, table, grid, mapping, headerRow, titles, genderFromTitle]); // eslint-disable-line react-hooks/exhaustive-deps
  const track = useMemo(() => (kind === "tracking" && table ? readTracking(grid, mapping, readOpts) : null), [kind, table, grid, mapping, headerRow, titles, genderFromTitle]); // eslint-disable-line react-hooks/exhaustive-deps
  const esc = useMemo(() => (kind === "escorts" && table ? readEscorts(grid, mapping, { headerRow, titles }) : null), [kind, table, grid, mapping, headerRow, titles]);
  const phrases = useMemo(() => (esc ? phrasesOf(esc) : []), [esc]);

  // a change to what is read takes the check (and the choices made on it) away
  useEffect(() => {
    setCtx(null);
    setConfirming(false);
  }, [cand, track, esc]);

  const needed = kind ? FIELDS[kind][0] : null; // the speaker's column: nothing is read without it
  const mappedNeeded = !!needed && mapping.includes(needed.key);
  const whenMissing = kind === "tracking" && !mapping.includes("when");
  const phrasesMissing = kind === "escorts" && !mapping.includes("phrases");

  const check = async () => {
    setChecking(true);
    setCommitProblem(null);
    try {
      const pool = await data.imports.pool();
      const categories = kind === "tracking" ? (await data.settings.categories()).filter((c) => c.active) : [];
      const asked =
        kind === "candidates" ? lookupFor(cand ?? [], pool)
        : kind === "tracking" ? lookupFor((track?.speakers ?? []).map((s) => ({ data: { key: s.key, phoneKey: s.phoneKey } })), pool)
        : lookupFor((esc ?? []).filter((r) => !r.skip).map((r) => ({ data: { key: r.key, phoneKey: null } })), pool);
      const lookup = await data.imports.lookup(asked.speakerIds, asked.phoneKeys);
      if (track) {
        setTopics(new Map(topicsOf(track).map((t) => [t.key, proposedCategory(t.text, categories)])));
        setSources(new Map(sourcesValuesOf(track).map((v) => [v.key, { kind: defaultSourcesRule(v.text).kind, print: defaultSourcesRule(v.text).print }])));
      }
      if (kind === "escorts") setTicked(new Set(phrases.filter((p) => p.contact && !p.money).map((p) => p.key)));
      setChoices(new Map());
      setCtx({ match: contextOf(pool, lookup), categories });
    } catch (err) {
      notify("error", said(err));
    } finally {
      setChecking(false);
    }
  };

  // ---- the preview and the payload
  const candPreview = useMemo(() => (cand && ctx ? previewCandidates(cand, ctx.match) : null), [cand, ctx]);
  const plans = useMemo(() => (track && ctx ? planLessons(track, { decisions, categories: topics, sources }) : null), [track, ctx, decisions, topics, sources]);
  const usedKeys = useMemo(() => new Set((plans ?? []).filter((p) => !p.skip).flatMap((p) => p.speakerKeys)), [plans]);
  const trackSpeakers = useMemo(
    () => (track && ctx ? previewTrackingSpeakers(track, ctx.match).filter((s) => !plans || usedKeys.has(s.speaker.key)) : null),
    [track, ctx, plans, usedKeys],
  );
  const escPreview = useMemo(() => (esc && ctx ? previewEscorts(esc, ticked, ctx.match) : null), [esc, ctx, ticked]);
  const groups = useMemo(() => (track ? doubleGroups(track) : []), [track]);

  const labelTrim = label.trim();
  const sameLabel = editions.find((e) => e.label === labelTrim);
  const meta = { label: labelTrim, start_date: startDate || null, source: source.trim(), titles_from: titlesEdition?.id ?? null };
  const rowChoices = useMemo(() => new Map([...choices].map(([k, v]) => [Number(k), v])), [choices]);
  const commit: ImportCommit | null = useMemo(() => {
    if (!ctx || !kind) return null;
    if (kind === "candidates") {
      const p = candPreview && candidatesPayload(candPreview, rowChoices, meta.source, meta.titles_from);
      return p ? { kind, payload: p } : null;
    }
    if (kind === "tracking") {
      const p = plans && trackSpeakers && archivePayload(plans, trackSpeakers, choices, meta);
      return p ? { kind, payload: p } : null;
    }
    const p = escPreview && escortsPayload(escPreview, choices);
    return p ? { kind, payload: p } : null;
  }, [ctx, kind, candPreview, rowChoices, plans, trackSpeakers, choices, escPreview, meta.label, meta.start_date, meta.source, meta.titles_from]); // eslint-disable-line react-hooks/exhaustive-deps

  const undecidedCount =
    kind === "candidates" ? (candPreview ?? []).filter((r) => r.status === "ambiguous" && !choices.has(String(r.row))).length
    : kind === "tracking" ? (trackSpeakers ?? []).filter((s) => s.status === "ambiguous" && !choices.has(s.speaker.key)).length
    : (escPreview ?? []).filter((r) => r.status === "ambiguous" && !choices.has(r.key)).length;
  const groupsOpen = kind === "tracking" ? groups.filter((g) => !decisions.has(g.id)).length : 0;
  const blockers = [
    undecidedCount > 0 && (undecidedCount === 1 ? "מרצה אחד/ת «עמום/ה» מחכה להחלטה" : `${undecidedCount} מרצים «עמומים» מחכים להחלטה`),
    groupsOpen > 0 && (groupsOpen === 1 ? "קבוצת «כפולה» אחת מחכה להחלטה" : `${groupsOpen} קבוצות «כפולה» מחכות להחלטה`),
    kind === "tracking" && !labelTrim && "צריך שם למחזור בארכיון",
    kind === "tracking" && sameLabel && sameLabel.kind !== "archive" && "יש כבר מחזור פעיל בשם הזה — צריך שם אחר",
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
              <Field id={`${id}-paste`} label="הדבקת טבלה" hint="מסמנים את הטבלה ב-Excel, ב-Google Sheets, ב-Google Docs או ב-Word, מעתיקים, ומדביקים כאן (Ctrl+V). רק הטקסט של התאים נקרא.">
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
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-paper px-3 font-semibold hover:bg-line/50">
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
          <label className="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={headerRow}
              onChange={(e) => {
                setHeaderRow(e.target.checked);
                setMap(defaultMapping(kind, e.target.checked ? grid[0] : null, grid[0]?.length ?? 0));
              }}
              className="size-5 accent-ink"
            />
            השורה הראשונה היא כותרות
          </label>
          <ul aria-label="העמודות" className="grid gap-2 sm:grid-cols-2">
            {names.map((n, i) => {
              const escortCol = kind === "escorts" && headerRow && ESCORT_COLUMN.test(grid[0][i] ?? "");
              const samples = rows.map((r) => r.cells[i]).filter(Boolean).slice(0, 2);
              return (
                <li key={i} className="min-w-0 rounded-lg border border-line bg-paper p-2.5">
                  <label htmlFor={`${id}-col-${i}`} className="block text-sm font-semibold break-words">
                    {n}
                  </label>
                  <p className="mb-1 truncate text-xs text-ink-soft" title={samples.join(" · ")}>
                    {samples.length ? `לדוגמה: ${samples.join(" · ")}` : "ריקה"}
                  </p>
                  <select
                    id={`${id}-col-${i}`}
                    value={mapping[i] ?? ""}
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
                <Field id={`${id}-label`} label="שם המחזור בארכיון" hint={sameLabel?.kind === "archive" ? "מחזור בשם הזה כבר בארכיון — הייבוא יחליף את כל השיעורים שלו (לא אם נכתב על אחד מהם «איך עבר»)." : "למשל: תשפ״ו. נשמר כמחזור ארכיון, לקריאה בלבד."}>
                  <input id={`${id}-label`} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className={INPUT} aria-describedby={`${id}-label-hint`} />
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
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button kind="primary" busy={checking} busyLabel="בודק…" disabled={!mappedNeeded || whenMissing || phrasesMissing} onClick={() => void check()}>
              בדיקה מול המאגר
            </Button>
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
      {kind === "escorts" && ctx && <PhrasesTable phrases={phrases} ticked={ticked} onToggle={(k) => setTicked((cur) => { const n = new Set(cur); if (!n.delete(k)) n.add(k); return n; })} />}

      {ctx && kind === "candidates" && candPreview && <CandidatesPreview rows={candPreview} pool={ctx.match} choices={choices} onChoose={choose} />}
      {ctx && kind === "tracking" && trackSpeakers && (
        <>
          <SpeakersPreview rows={trackSpeakers} pool={ctx.match} choices={choices} onChoose={choose} />
          {plans ? <LessonsPreview plans={plans} categories={ctx.categories} speakers={trackSpeakers} choices={choices} /> : <Panel title="השיעורים"><p className="text-ink-soft">אחרי ההחלטה על כל קבוצות «כפולה» יופיעו כאן השיעורים.</p></Panel>}
        </>
      )}
      {ctx && kind === "escorts" && escPreview && <EscortsPreview rows={escPreview} choices={choices} onChoose={choose} />}

      {ctx && kind && (
        <Panel title="שמירה">
          {blockers.length > 0 ? (
            <ul className="mb-2 list-disc ps-5 text-sm text-ink-soft">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-sm text-ink-soft">
              {kind === "tracking" ? `${rowsInCommit} שיעורים במחזור «${labelTrim}»` : kind === "candidates" ? `${rowsInCommit} שורות למאגר` : `${rowsInCommit} מרצים יושלמו`}
              {kind === "tracking" && sameLabel?.kind === "archive" && " — במקום השיעורים שכבר שם"}.
            </p>
          )}
          {confirming ? (
            <Confirm
              danger={false}
              text={kind === "tracking" && sameLabel?.kind === "archive" ? `לייבא ולהחליף את כל השיעורים של «${labelTrim}»?` : "לייבא? הכול נשמר בפעולה אחת."}
              confirm="ייבוא"
              busy={committing}
              onConfirm={() => void doCommit()}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <Button kind="primary" disabled={!commit || blockers.length > 0 || rowsInCommit === 0} onClick={() => setConfirming(true)}>
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

function ResultPanel({ r }: { r: { kind: ImportKind; res: ImportResult; label: string | null } }) {
  const { res } = r;
  const parts = [
    res.created > 0 && (res.created === 1 ? "נוסף/ה מרצה אחד/ת למאגר (ממתין/ה לאישור)" : `נוספו ${res.created} מרצים למאגר (ממתינים לאישור)`),
    res.merged > 0 && (res.merged === 1 ? "מרצה אחד/ת כבר במאגר" : `${res.merged} כבר במאגר`),
    res.filled > 0 && `${res.filled} הושלמו בפרטים שהיו חסרים`,
    res.contacts > 0 && `${res.contacts} קיבלו פרטי קשר שהיו חסרים`,
    r.kind === "tracking" && `${res.lessons} שיעורים במחזור «${r.label}»${res.replaced ? ` (במקום ${res.replaced} שהיו)` : ""}`,
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
