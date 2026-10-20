// «מקראה» (/reader — the edition's content members and admins; desktop first):
// the manifest «התקבל / חסר», always on screen, lesson by lesson in schedule
// order; the cover (a poster an admin uploads and marks, else a schedule page
// made from the week); the two running headers, the admin's own words; and
// «בנה מקראה» — the PDF assembled in a worker from the files, downloaded and
// never uploaded — and the Word skeleton beside it. Nothing here is a text of
// ours: a missing title stays TBD, an empty header stays empty.
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { checkPicked, COVER_ACCEPT } from "../../data/sourceRules";
import type { Me } from "../../data/types";
import { DAY_NAMES } from "../../domain/time";
import type { SourceFile, Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { download, fileName, israelDay } from "../../exports/download";
import { useMedia } from "../../lib/useMedia";
import type { BuildProgress, BuildResult, ReaderBuild } from "../../reader/build";
import { planReader } from "../../reader/layout";
import { byDay, IN_READER, type Manifest, manifestTotals, type ManifestRow, type ManifestStatus, readerManifest, readerRows, STATUS_LABEL } from "../../reader/model";
import { OutputsTabs } from "../outputs/parts";
import { Badge, Button, Field, INPUT, Panel } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { FileRow } from "../stages/SourceFiles";
import { countPdfPages } from "../../reader/pages";
import { actorIn, type Actor, useWeekStore } from "../weekStore";

const TONE: Record<ManifestStatus, "ok" | "accent" | "bad" | "muted" | "neutral"> = {
  included: "ok",
  memorial: "accent",
  needs_pdf: "bad",
  missing: "bad",
  not_marked: "neutral",
  pending: "bad",
  presentation_only: "muted",
  no_sources: "muted",
};

const STEP_LABEL: Record<BuildProgress["step"], string> = { fetch: "מוריד את הקבצים", read: "קורא את הקבצים", draw: "מצייר את העמודים", save: "שומר" };

const pagesText = (n: number) => (n === 1 ? "עמוד אחד" : `${n} עמודים`);

export function ReaderScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const { notify, clear, node } = useToast();
  const actor = actorIn(me, week?.edition);
  const manifest = useMemo(() => (week ? readerManifest(week) : null), [week]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week || !manifest) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="font-display text-2xl font-extrabold">מקראה</h2>
      <EditionSelect />
      <OutputsTabs admin={actor.isAdmin} reader={actor.role !== "logistics"} />
    </div>
  );
  if (actor.role === "logistics") {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {header}
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">את המקראה בונים צוות התוכן והמדריך/ה. הקבצים של כל שיעור פתוחים להדפסה בלוח השיעור, בשלב «מקורות».</p>
      </div>
    );
  }
  const reload = store.reload;
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      {header}
      <p className="text-ink-soft">
        המקראה נבנית מהקבצים שהועלו לשיעורים, לפי הלו״ז: שער, תוכן עניינים, ואחריהם כל שיעור שמסומן «במקראה» ויש לו PDF או תמונה — כותרת «מרצה – כותרת» ואחריה הקבצים, כל עמוד
        מוקטן או מוגדל לגודל A4 — וזמני הזיכרון, ועמוד «סיכום יום» בסוף כל יום. הקובץ נבנה במחשב הזה ויורד אליו, ולא נשמר בשום מקום.
      </p>
      <BuildPanel port={port} week={week} manifest={manifest} notify={notify} clear={clear} />
      <ManifestPanel manifest={manifest} />
      <CoverPanel port={port} week={week} manifest={manifest} actor={actor} notify={notify} clear={clear} reload={reload} />
      <HeadersPanel port={port} week={week} actor={actor} notify={notify} clear={clear} reload={reload} />
      {manifest.leftovers.length > 0 && (
        <Panel title="קבצים בלי שיעור" aside="של משבצות שנפתחו מחדש או נמחקו — לא נכנסים למקראה">
          <ul className="divide-y divide-line">
            {manifest.leftovers.map((f) => (
              <FileRow key={f.id} port={port} week={week} file={f} actor={actor} notify={notify} reload={reload} previous />
            ))}
          </ul>
        </Panel>
      )}
      {node}
    </div>
  );
}

// ------------------------------------------------------------------ build

type Notify = ReturnType<typeof useToast>["notify"];

function BuildPanel({ port, week, manifest, notify, clear }: { port: DataPort; week: Week; manifest: Manifest; notify: Notify; clear: () => void }) {
  const wide = useMedia("(min-width: 1024px)");
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [result, setResult] = useState<(BuildResult & { at: number }) | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [wordBusy, setWordBusy] = useState(false);
  const job = useRef<ReaderBuild | null>(null);
  useEffect(() => () => job.current?.cancel(), []);
  const rows = readerRows(manifest);
  const estimate = useMemo(() => {
    const entries = rows.map((r, i) => ({ ref: i, day: r.day, header: r.header, filePages: r.printable.map((f) => f.page_count ?? 1) }));
    const cover = manifest.cover ? (manifest.cover.page_count ?? 1) : 1;
    return planReader(entries, cover).pages.length;
  }, [rows, manifest.cover]);

  const build = async () => {
    clear();
    setFailed(null);
    setResult(null);
    setProgress({ step: "fetch", done: 0, total: 1 });
    try {
      const { buildReader } = await import("../../reader/build");
      job.current = buildReader(port, week, manifest, setProgress);
      const r = await job.current.promise;
      download(fileName("reader", week.edition, israelDay(), "pdf"), r.bytes, "application/pdf");
      setResult({ ...r, at: Date.now() });
      notify("ok", `המקראה ירדה: ${pagesText(r.pages)}.`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") notify("ok", "הבנייה בוטלה.");
      else {
        const why = e instanceof Error && e.message === "no_canvas" ? "הדפדפן הזה לא יודע לצייר בעברית ברקע (OffscreenCanvas). בונים ב-Chrome, Edge או Firefox עדכני." : e instanceof CommandError ? errorMessage(e.code) : "הבנייה נכשלה. אפשר לנסות שוב; אם זה חוזר, כדאי לספר למדריך/ה.";
        setFailed(why);
      }
    } finally {
      job.current = null;
      setProgress(null);
    }
  };
  const word = async () => {
    clear();
    setWordBusy(true);
    try {
      const { buildSkeleton, DOCX_MIME } = await import("../../reader/docx");
      download(fileName("reader-skeleton", week.edition, israelDay(), "docx"), await buildSkeleton({ manifest, editionLabel: week.edition.label, headers: week.edition.settings.reader_headers }), DOCX_MIME);
      notify("ok", "שלד ה-Word ירד.");
    } catch {
      notify("error", "לא הצלחנו להכין את שלד ה-Word. אפשר לנסות שוב.");
    } finally {
      setWordBusy(false);
    }
  };
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <Panel title="בניית המקראה" aside={`בערך ${pagesText(estimate)} (הערכה, לפי מה שהתקבל עד עכשיו)`}>
      {!wide && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">את המקראה בונים במחשב: הקבצים גדולים, והבנייה כבדה לטלפון. הרשימה של מה התקבל ומה חסר מוצגת גם כאן.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {wide && (
          <Button kind="primary" disabled={!!progress} busy={!!progress} busyLabel="בונה…" onClick={() => void build()}>
            בנה מקראה (PDF)
          </Button>
        )}
        {progress && (
          <Button kind="danger" onClick={() => job.current?.cancel()}>
            ביטול
          </Button>
        )}
        <Button busy={wordBusy} busyLabel="מכין…" onClick={() => void word()}>
          שלד Word
        </Button>
      </div>
      {progress && (
        <div className="mt-3 space-y-1" aria-live="polite">
          <p className="text-sm">
            {STEP_LABEL[progress.step]}
            {progress.step !== "save" && progress.total > 0 && ` · ${progress.done} מתוך ${progress.total}`}
          </p>
          <div role="progressbar" aria-label="בניית המקראה" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded-full bg-line">
            <div className="h-2 rounded-full bg-ink transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {failed && (
        <p role="alert" className="mt-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          {failed}
        </p>
      )}
      {result && (
        <div className="mt-3 space-y-1 text-sm" data-reader-result>
          <p>
            המקראה ירדה: <b>{pagesText(result.pages)}</b>. כדי לשתף אותה שולחים את הקובץ שירד — הוא לא נשמר במערכת.
          </p>
          {result.skipped.length > 0 && (
            <div role="alert" className="rounded-lg bg-amber-50 p-2 text-amber-900">
              <p className="font-semibold">לא נכנסו (צריך PDF אחר):</p>
              <ul className="list-disc ps-5">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    <bdi>{s.name}</bdi> — {s.reason === "protected" ? "הקובץ מוגן בסיסמה" : s.reason === "missing" ? "לא הצלחנו להוריד אותו" : "הקובץ לא נקרא"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-ink-soft">
        שלד ה-Word: הכותרות לפי הסדר (כל שיעור שמסומן «במקראה» וכל זמן זיכרון, בעמוד משלו), שדה תוכן עניינים שמתעדכן בפתיחה, ועמודי «סיכום יום» — כדי להדביק אליו
        מקורות שהגיעו ב-Word ולערוך הכול באותה צורה.
      </p>
    </Panel>
  );
}

// ------------------------------------------------------------------ the manifest

function ManifestPanel({ manifest }: { manifest: Manifest }) {
  const navigate = useNavigate();
  const t = manifestTotals(manifest);
  const parts = [
    `${t.included} בתוך המקראה`,
    t.missing + t.pending > 0 && `${t.missing + t.pending} חסרים`,
    t.needsPdf > 0 && `${t.needsPdf} צריך PDF`,
    t.notMarked > 0 && `${t.notMarked} לא סומנו`,
    t.presentationOnly > 0 && `${t.presentationOnly} מצגת בלבד`,
    t.noSources > 0 && `${t.noSources} בלי מקורות`,
    `${t.memorial} זמני זיכרון`,
  ].filter(Boolean);
  return (
    <Panel title="מה התקבל ומה חסר" aside={`${t.lessons} שיעורים סגורים · ${t.files} קבצים · ${pagesText(t.filePages)} של מקורות`}>
      <p className="mb-3 text-sm" data-manifest-totals>
        {parts.join(" · ")}
      </p>
      {manifest.rows.length === 0 ? (
        <p className="text-ink-soft">עוד אין שיעורים סגורים או זמני זיכרון במחזור הזה.</p>
      ) : (
        <div className="space-y-4">
          {byDay(manifest.rows).filter((d) => d.rows.length > 0).map(({ day, rows }) => (
            <section key={day} aria-label={`יום ${DAY_NAMES[day]}`}>
              <h3 className="mb-1 font-display text-lg font-semibold">יום {DAY_NAMES[day]}</h3>
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <ManifestLine key={r.lesson.id} row={r} onOpen={() => navigate("/", { state: { lesson: r.lesson.id, stage: r.kind === "lesson" ? "sources" : undefined } })} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ManifestLine({ row: r, onOpen }: { row: ManifestRow; onOpen: () => void }) {
  const notes: string[] = [];
  if (r.kind === "lesson" && r.files.length > 0) notes.push(`${r.files.length === 1 ? "קובץ אחד" : `${r.files.length} קבצים`}${r.status === "included" ? ` · ${pagesText(r.pages)}` : ""}`);
  if (r.word.length > 0 && r.status === "included") notes.push(`ועוד ${r.word.length === 1 ? "קובץ Word אחד" : `${r.word.length} קבצי Word`} שלא נכנס/ים — צריך PDF`);
  if (r.unread.length > 0) notes.push(`${r.unread.length === 1 ? "PDF אחד לא נקרא" : `${r.unread.length} קבצי PDF לא נקראו`} בהעלאה — ייבדק/ו בבנייה`);
  if (r.previous.length > 0) notes.push(`מהמרצה הקודם: ${r.previous.length === 1 ? "קובץ אחד" : `${r.previous.length} קבצים`} להסרה`);
  if (r.kind === "lesson" && IN_READER[r.status] && !r.title) notes.push("אין כותרת: בכותרת שבמקראה יופיע TBD");
  if (r.kind === "memorial") notes.push("עמוד כותרת; החומרים יתווספו עם מסך זמני הזיכרון");
  return (
    <li data-manifest-row={r.lesson.id} data-status={r.status} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
      <span className="w-full shrink-0 text-sm text-ink-soft sm:w-44">
        <bdi>{r.when}</bdi>
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <button type="button" onClick={onOpen} className="min-h-11 text-start font-semibold underline-offset-4 hover:underline">
          <bdi>{r.header}</bdi>
        </button>
        {notes.length > 0 && <p className="text-xs text-ink-soft">{notes.join(" · ")}</p>}
      </div>
      <Badge tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
    </li>
  );
}

// ------------------------------------------------------------------ the cover

function CoverPanel({ port, week, manifest, actor, notify, clear, reload }: { port: DataPort; week: Week; manifest: Manifest; actor: Actor; notify: Notify; clear: () => void; reload: () => Promise<void> }) {
  const id = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const marked = week.edition.settings.reader_cover ?? null;
  const upload = async (file: File) => {
    clear();
    setBusy("upload");
    setProgress(0);
    try {
      const mime = checkPicked(file, true);
      const pages = mime === "application/pdf" ? await countPdfPages(file) : null;
      await port.sources.upload(week.edition.id, null, file, { pages, onProgress: setProgress });
      notify("ok", "הפוסטר הועלה");
      await reload();
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : "upload_failed"));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };
  const mark = async (fileId: number | null) => {
    clear();
    setBusy(`mark-${fileId}`);
    try {
      await port.sources.setCover(week.edition.id, fileId);
      notify("ok", fileId == null ? "השער: עמוד לו״ז מהשבוע" : "השער נבחר");
      await reload();
    } catch (e) {
      notify("error", errorMessage(e instanceof CommandError ? e.code : null));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="שער" aside={manifest.cover ? <>הפוסטר: <bdi>{manifest.cover.display_name}</bdi></> : "עמוד לו״ז שנוצר מהשבוע (אין פוסטר מסומן)"}>
      <p className="mb-2 text-sm text-ink-soft">
        העמוד הראשון של המקראה הוא הפוסטר של השבוע — PDF או תמונה שהמדריך/ה מעלה ומסמן/ת כאן. כל עוד אין, העמוד הראשון הוא הלו״ז, כפי שהוא בשבוע.
      </p>
      {manifest.covers.length > 0 && (
        <ul aria-label="פוסטרים" className="divide-y divide-line">
          {manifest.covers.map((f: SourceFile) => (
            <FileRow
              key={f.id}
              port={port}
              week={week}
              file={f}
              actor={actor}
              notify={notify}
              reload={reload}
              before={
                actor.isAdmin ? (
                  <input type="radio" name={`${id}-cover`} aria-label={`השער: ${f.display_name}`} checked={marked === f.id} disabled={!!busy} onChange={() => void mark(f.id)} className="size-5 accent-ink" />
                ) : (
                  marked === f.id && <Badge tone="ok">השער</Badge>
                )
              }
            />
          ))}
        </ul>
      )}
      {actor.isAdmin && manifest.covers.length > 0 && (
        <label className="mt-1 inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="radio" name={`${id}-cover`} checked={!manifest.covers.some((f) => f.id === marked)} disabled={!!busy} onChange={() => void mark(null)} className="size-5 accent-ink" />
          בלי פוסטר: עמוד לו״ז מהשבוע
        </label>
      )}
      {actor.isAdmin && actor.canEdit && (
        <div className="mt-2">
          <input
            id={`${id}-pick`}
            type="file"
            accept={COVER_ACCEPT}
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <label htmlFor={`${id}-pick`} className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line bg-paper px-3 font-semibold ${busy ? "opacity-50" : "hover:bg-line/50"}`}>
            {busy === "upload" ? `מעלה… ${Math.round((progress ?? 0) * 100)}%` : "העלאת פוסטר (PDF או תמונה)"}
          </label>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ the running headers

function HeadersPanel({ port, week, actor, notify, clear, reload }: { port: DataPort; week: Week; actor: Actor; notify: Notify; clear: () => void; reload: () => Promise<void> }) {
  const id = useId();
  const saved = week.edition.settings.reader_headers ?? ["", ""];
  const [left, setLeft] = useState(saved[0]);
  const [right, setRight] = useState(saved[1]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLeft(saved[0]);
    setRight(saved[1]);
  }, [saved[0], saved[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = left.trim() !== saved[0] || right.trim() !== saved[1];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    clear();
    setBusy(true);
    try {
      await port.sources.setHeaders(week.edition.id, left, right);
      notify("ok", "הכותרות נשמרו");
      await reload();
    } catch (err) {
      notify("error", errorMessage(err instanceof CommandError ? err.code : null));
    } finally {
      setBusy(false);
    }
  };
  const help = (
    <>
      בראש כל עמוד, לסירוגין: עמוד שמאלי ועמוד ימני (בספר שנכרך מימין, העמוד האי-זוגי הוא השמאלי). למשל, אשתקד: «שבוע וולוז׳ין תשפ״ו 2026» ו«המדרשה הגבוהה עין פרת מחזור כ״ג».
      שום דבר לא נכתב מעצמו — כל עוד ריק, אין כותרות רצות.
    </>
  );
  if (!actor.isAdmin) {
    return (
      <Panel title="כותרות רצות">
        <p className="text-sm">{saved[0] || saved[1] ? <>שמאל: «{saved[0] || "—"}» · ימין: «{saved[1] || "—"}»</> : "אין כותרות רצות (המדריך/ה כותב/ת אותן כאן)."}</p>
        <p className="mt-1 text-xs text-ink-soft">{help}</p>
      </Panel>
    );
  }
  return (
    <Panel title="כותרות רצות">
      <form onSubmit={(e) => void submit(e)} className="space-y-3" aria-label="כותרות רצות">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-left`} label="עמוד שמאלי (אי-זוגי)">
            <input id={`${id}-left`} value={left} maxLength={120} onChange={(e) => setLeft(e.target.value)} className={INPUT} />
          </Field>
          <Field id={`${id}-right`} label="עמוד ימני (זוגי)">
            <input id={`${id}-right`} value={right} maxLength={120} onChange={(e) => setRight(e.target.value)} className={INPUT} />
          </Field>
        </div>
        <p className="text-xs text-ink-soft">{help}</p>
        <Button kind="primary" type="submit" disabled={!dirty} busy={busy} busyLabel="שומר…">
          שמירת הכותרות
        </Button>
      </form>
    </Panel>
  );
}
