// «ייצוא ארכיון» in «הגדרות ← מחזור» (a global admin): the system's backup — the
// free plan has none of its own (DESIGN «סיכונים»). One zip made in this
// browser from the edition's week, its log, knowledge and exports, מכריכה
// לכריכה, the memorial plans and the list of the fallen, the sources' list —
// and, when asked, the source files themselves (a size said before it starts,
// a cancel, the files that could not be read named) — and, apart, in a file
// named PERSONAL-DATA, the contacts, transport details and families' contact
// persons the caller's RLS shows (src/exports/archive.ts). Nothing is uploaded.
import { useEffect, useRef, useState } from "react";
import { CommandError } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { sizeText } from "../../data/sourceRules";
import type { Edition } from "../../domain/types";
import { download, fileName, israelDay, PERSONAL_FILE, ZIP_MIME } from "../../exports/download";
import type { SourcesProgress } from "../../exports/archiveGather";
import { EXPECTED_SCHEMA_VERSION } from "../../lib/schema";
import { Button, INPUT, KIND_LABEL, Panel, useAction } from "./kit";

export function ArchivePanel({ data, editions }: { data: DataPort; editions: Edition[] }) {
  const { busy, run } = useAction();
  const [id, setId] = useState<number | null>(() => (editions.find((e) => e.status !== "archived") ?? editions[0])?.id ?? null);
  const chosen = editions.find((e) => e.id === id) ?? null;
  const [withSources, setWithSources] = useState(false);
  const [estimate, setEstimate] = useState<{ edition: number; count: number; bytes: number } | null>(null);
  const [estimateFailed, setEstimateFailed] = useState(false);
  const [progress, setProgress] = useState<SourcesProgress | null>(null);
  const [skipped, setSkipped] = useState<string[] | null>(null);
  const abort = useRef<AbortController | null>(null);

  // the size, before anything is fetched: the chosen edition's files as the database lists them
  useEffect(() => {
    if (!withSources || id == null) return;
    let live = true;
    setEstimateFailed(false);
    void (async () => {
      try {
        const [{ sourcesSize }, week] = await Promise.all([import("../../exports/archive"), data.loadWeek(id)]);
        if (live) setEstimate({ edition: id, ...sourcesSize(week) });
      } catch {
        if (live) setEstimateFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [withSources, id, data]);
  useEffect(() => () => abort.current?.abort(), []);
  const size = estimate?.edition === id ? estimate : null;

  const save = () =>
    run(
      "archive",
      async () => {
        if (!chosen) return;
        setSkipped(null);
        // the zip writer loads only for this (it is not part of the week's bundle)
        const [{ archiveZip, touchedSpeakers }, { gatherArchive, fetchSources }] = await Promise.all([import("../../exports/archive"), import("../../exports/archiveGather")]);
        const { week, extras, more } = await gatherArchive(data, chosen.id, touchedSpeakers);
        if (withSources) {
          const ctl = new AbortController();
          abort.current = ctl;
          try {
            more.sources = await fetchSources(data, week, ctl.signal, setProgress);
          } catch (e) {
            throw e instanceof DOMException && e.name === "AbortError" ? new CommandError("archive_cancelled") : e;
          } finally {
            abort.current = null;
            setProgress(null);
          }
        }
        const zip = archiveZip({ week, extras, more, schemaVersion: EXPECTED_SCHEMA_VERSION, exportedAt: new Date().toISOString() });
        download(fileName("archive", chosen, israelDay(), "zip"), zip, ZIP_MIME);
        if (more.sources) setSkipped(more.sources.skipped.map((x) => x.name));
      },
      "הארכיון ירד. יש בו מידע אישי: לשמור במקום מוגן.",
    );

  return (
    <Panel title="ייצוא ארכיון (גיבוי)">
      <div className="space-y-2 text-sm">
        <p>
          זה הגיבוי של המערכת: כל מה שנשמר על המחזור — השיעורים, הפניות וההצעות, הזמינות, שמות החניכים, החדרים, הקטגוריות, ההגדרות והנוסחים, יומן הפעולות, הידע ואבני
          הדרך, מכריכה לכריכה (הקבוצות, ההרשמות והזמנות הספרים), הסימונים של המלווים, תוכניות זמני הזיכרון ורשימת החללים, ורשימת קבצי המקורות — בקובץ zip אחד, ובתוכו גם
          טבלת המעקב. כדאי לייצא אחרי הייבוא, באמצע העונה ובסוף השנה.
        </p>
        <p className="rounded-lg bg-accent-soft px-3 py-2">
          <b>הארכיון כולל מידע אישי:</b> פרטי הקשר של המרצים, פרטי ההסעה (כתובות איסוף ונהגים) ואנשי הקשר של משפחות החללים, בקובץ נפרד בשם
          <span dir="ltr" className="my-1 block break-all text-start font-mono text-xs">
            {PERSONAL_FILE}
          </span>
          פרטי הקשר של המשפחות לא יוצאים מהמערכת בשום ייצוא אחר — רק כאן, כי את הארכיון מורידים רק אדמינים. שומרים אותו במקום מוגן — לא בתיקייה משותפת, לא במייל ולא בצ׳אט — ומוחקים עותקים ישנים.
        </p>
      </div>
      <div className="mt-3 space-y-1">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
          <input type="checkbox" checked={withSources} onChange={(e) => setWithSources(e.target.checked)} disabled={busy === "archive"} className="size-4 accent-ink" />
          כולל קבצי המקורות
        </label>
        {withSources && (
          <p role="status" className="text-sm text-ink-soft">
            {estimateFailed
              ? "לא הצלחנו לחשב את הגודל. אפשר לנסות בכל זאת."
              : !size
                ? "מחשב את הגודל…"
                : size.count === 0
                  ? "אין קבצים במחזור הזה."
                  : `${size.count === 1 ? "קובץ אחד" : `${size.count} קבצים`}, כ-${sizeText(size.bytes)}, בתיקייה לכל יום. ההורדה לוקחת זמן; קובץ שלא נקרא יירשם ברשימה.`}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {editions.length > 1 && (
          <label className="flex min-w-0 flex-col text-sm font-semibold">
            מחזור
            <select value={id ?? ""} onChange={(e) => setId(Number(e.target.value))} className={INPUT} disabled={busy === "archive"}>
              {editions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                  {e.status === "archived" ? " (בארכיון)" : e.kind !== "real" ? ` (${KIND_LABEL[e.kind]})` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button kind="primary" busy={busy === "archive"} busyLabel="מכין…" disabled={!chosen} onClick={() => void save()}>
          הורדת הארכיון{chosen && editions.length <= 1 ? ` של ${chosen.label}` : ""}
        </Button>
        {progress && (
          <>
            <span role="status" className="text-sm">
              קורא קבצים {progress.done}/{progress.total}
            </span>
            <Button onClick={() => abort.current?.abort()}>ביטול</Button>
          </>
        )}
      </div>
      {skipped && skipped.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">{skipped.length === 1 ? "קובץ אחד לא נקרא ולא נכלל:" : `${skipped.length} קבצים לא נקראו ולא נכללו:`}</p>
          <ul className="list-disc ps-5">
            {skipped.map((n, i) => (
              <li key={i}>
                <bdi>{n}</bdi>
              </li>
            ))}
          </ul>
          <p>הם רשומים גם ב-README.txt וב-sources.json שבארכיון.</p>
        </div>
      )}
    </Panel>
  );
}
