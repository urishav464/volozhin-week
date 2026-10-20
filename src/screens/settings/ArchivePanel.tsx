// «ייצוא ארכיון» in «הגדרות ← מחזור» (a global admin): the system's backup — the
// free plan has none of its own (DESIGN «סיכונים»). One zip made in this
// browser from the edition's week, its log, knowledge and exports, and — apart,
// in a file named PERSONAL-DATA — the contacts and transport details the
// caller's RLS shows (src/exports/archive.ts). Nothing is uploaded.
import { useState } from "react";
import type { DataPort } from "../../data/port";
import type { Edition } from "../../domain/types";
import { download, fileName, israelDay, PERSONAL_FILE, ZIP_MIME } from "../../exports/download";
import { EXPECTED_SCHEMA_VERSION } from "../../lib/schema";
import { Button, INPUT, KIND_LABEL, Panel, useAction } from "./kit";

export function ArchivePanel({ data, editions }: { data: DataPort; editions: Edition[] }) {
  const { busy, run } = useAction();
  const [id, setId] = useState<number | null>(() => (editions.find((e) => e.status !== "archived") ?? editions[0])?.id ?? null);
  const chosen = editions.find((e) => e.id === id) ?? null;

  const save = () =>
    run(
      "archive",
      async () => {
        if (!chosen) return;
        // the zip writer loads only for this (it is not part of the week's bundle)
        const { archiveZip, touchedSpeakers } = await import("../../exports/archive");
        const week = await data.loadWeek(chosen.id);
        const extras = await data.outputs.archiveExtras(chosen.id, touchedSpeakers(week), week.lessons.map((l) => l.id));
        const zip = archiveZip({ week, extras, schemaVersion: EXPECTED_SCHEMA_VERSION, exportedAt: new Date().toISOString() });
        download(fileName("archive", chosen, israelDay(), "zip"), zip, ZIP_MIME);
      },
      "הארכיון ירד. יש בו מידע אישי: לשמור במקום מוגן.",
    );

  return (
    <Panel title="ייצוא ארכיון (גיבוי)">
      <div className="space-y-2 text-sm">
        <p>
          זה הגיבוי של המערכת: כל מה שנשמר על המחזור — השיעורים, הפניות וההצעות, הזמינות, שמות החניכים, החדרים, הקטגוריות, ההגדרות והנוסחים, יומן הפעולות, הידע ואבני
          הדרך — בקובץ zip אחד, ובתוכו גם טבלת המעקב. כדאי לייצא אחרי הייבוא, באמצע העונה ובסוף השנה.
        </p>
        <p className="rounded-lg bg-accent-soft px-3 py-2">
          <b>הארכיון כולל מידע אישי:</b> פרטי הקשר של המרצים ופרטי ההסעה (כתובות איסוף ונהגים), בקובץ נפרד בשם
          <span dir="ltr" className="my-1 block break-all text-start font-mono text-xs">
            {PERSONAL_FILE}
          </span>
          שומרים אותו במקום מוגן — לא בתיקייה משותפת, לא במייל ולא בצ׳אט — ומוחקים עותקים ישנים.
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {editions.length > 1 && (
          <label className="flex min-w-0 flex-col text-sm font-semibold">
            מחזור
            <select value={id ?? ""} onChange={(e) => setId(Number(e.target.value))} className={INPUT}>
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
      </div>
    </Panel>
  );
}
