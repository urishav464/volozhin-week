// «ייצוא למעצבת» (/export/designer, the edition's admins): the public schedule
// only — no contact, no amount, no note (src/exports/designer.ts) — as xlsx or
// CSV. Each export is kept (export_snapshots), and the screen says what changed
// since the last one: rows added, rows gone, and the fields that changed.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DataPort } from "../../data/port";
import type { ExportSnapshot } from "../../data/outputs";
import type { Me } from "../../data/types";
import { errorMessage } from "../../errors";
import { csvBytes } from "../../exports/csv";
import { CSV_MIME, download, fileName, israelDay } from "../../exports/download";
import {
  DESIGNER_FIELD_LABEL, DESIGNER_FIELDS, type DesignerRow, designerCell, designerRows, designerTable, diffCount, diffSchedules, type ScheduleDiff,
} from "../../exports/designer";
import { toXlsx, XLSX_MIME } from "../../exports/xlsx";
import { Button, Panel, useRunner } from "../settings/kit";
import { EditionSelect, useToast } from "../speakers/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { OutputsTabs } from "./parts";

/** «10.11.2026, 14:20» in Israel. */
function when(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function DesignerScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { week } = store;
  const { notify, clear, node } = useToast();
  const { busy, run } = useRunner(notify, clear);
  const [snapshots, setSnapshots] = useState<ExportSnapshot[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const actor = actorIn(me, week?.edition);
  const editionId = week?.edition.id ?? null;

  const load = useCallback(async () => {
    if (editionId == null) return;
    setLoadFailed(false);
    try {
      setSnapshots(await port.outputs.snapshots(editionId, "designer"));
    } catch {
      setLoadFailed(true);
    }
  }, [port, editionId]);
  useEffect(() => {
    setSnapshots(null);
    void load();
  }, [load]);

  const rows = useMemo(() => (week ? designerRows(week) : []), [week]);
  const last = snapshots?.[0] ?? null;
  const diff = useMemo(() => (last ? diffSchedules(last.rows, rows) : null), [last, rows]);

  if (store.problem === "none") return <p className="mt-10 text-center text-ink-soft">עוד לא נפתח מחזור.</p>;
  if (store.problem === "error") return <p className="mt-10 text-center text-bad">לא הצלחנו לטעון. כדאי לרענן את הדף.</p>;
  if (!week) return <p className="mt-10 text-center text-ink-soft">טוען…</p>;

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="font-display text-2xl font-extrabold">ייצוא למעצבת</h2>
      <EditionSelect />
      <OutputsTabs admin={actor.isAdmin} reader={actor.role !== "logistics"} />
    </div>
  );
  if (!actor.isAdmin) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {header}
        <p className="rounded-xl border border-line bg-card p-4 text-ink-soft">הייצוא למעצבת שמור למדריך/ה של המחזור הזה.</p>
      </div>
    );
  }

  const names = new Map(week.team.map((t) => [t.id, t.display_name]));
  const name = (ext: string) => fileName("designer", week.edition, israelDay(), ext);
  const exportAs = (kind: "xlsx" | "csv") => {
    let downloaded = false;
    return run(
      kind,
      async () => {
        const t = designerTable(rows, week.edition.label);
        if (kind === "xlsx") download(name("xlsx"), toXlsx([t]), XLSX_MIME);
        else download(name("csv"), csvBytes(t), CSV_MIME);
        downloaded = true;
        await port.outputs.saveSnapshot(week.edition.id, "designer", rows);
        await load();
      },
      "הקובץ ירד, והייצוא נשמר להשוואה בפעם הבאה.",
      // the file is out, but the snapshot is not kept: say both, or the next diff silently compares with an older export
      (code) => {
        if (!downloaded) return false;
        const why = errorMessage(code);
        notify("error", `הקובץ ירד, אבל הייצוא לא נשמר להשוואה, ולכן בפעם הבאה ההשוואה תהיה מול הייצוא הקודם. אפשר לייצא שוב.${why !== errorMessage(null) ? ` ${why}` : ""}`);
        return true;
      },
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      {header}
      <p className="text-ink-soft">
        הלו״ז הציבורי בלבד: יום, תאריך, שעה, מרצה, כותרת, קטגוריה, חדר, «במקביל» וזמני הזיכרון. בלי פרטי קשר, בלי סכומים ובלי הערות. כל ייצוא נשמר, כדי שבפעם הבאה
        יופיע מה השתנה מאז.
      </p>

      <Panel title="שינויים מאז הייצוא הקודם" aside={last ? `הייצוא הקודם: ${when(last.created_at)}, ${(last.created_by != null && names.get(last.created_by)) || "חבר/ת צוות"}` : undefined}>
        {loadFailed ? (
          <p role="alert" className="text-bad">
            לא הצלחנו לטעון את הייצוא הקודם. <Button onClick={() => void load()}>לנסות שוב</Button>
          </p>
        ) : snapshots == null ? (
          <p className="text-ink-soft">טוען…</p>
        ) : !last ? (
          <p className="text-ink-soft">עוד לא ייצאו את הלו״ז למעצבת. אחרי הייצוא הראשון יופיע כאן מה השתנה מאז.</p>
        ) : diff && diffCount(diff) === 0 ? (
          <p>אין שינויים מאז הייצוא הקודם.</p>
        ) : (
          diff && <Diff diff={diff} />
        )}
      </Panel>

      <div className="flex flex-wrap gap-2">
        <Button kind="primary" busy={busy === "xlsx"} busyLabel="מייצא…" disabled={rows.length === 0 || !!busy} onClick={() => void exportAs("xlsx")}>
          ייצוא xlsx
        </Button>
        <Button busy={busy === "csv"} busyLabel="מייצא…" disabled={rows.length === 0 || !!busy} onClick={() => void exportAs("csv")}>
          ייצוא CSV
        </Button>
      </div>

      <Panel title="הלו״ז שייצא" aside={rows.length === 1 ? "שורה אחת" : `${rows.length} שורות`}>
        {rows.length === 0 ? (
          <p className="text-ink-soft">עוד אין שיעורים סגורים או זמני זיכרון במחזור הזה.</p>
        ) : (
          <div className="overflow-x-auto">
            <ScheduleTable rows={rows} label="הלו״ז שייצא" />
          </div>
        )}
      </Panel>
      {node}
    </div>
  );
}

function ScheduleTable({ rows, label }: { rows: DesignerRow[]; label: string }) {
  return (
    <table aria-label={label} className="w-full min-w-[44rem] border-collapse text-start text-sm">
      <thead>
        <tr className="border-b border-line text-ink-soft">
          {DESIGNER_FIELDS.map((f) => (
            <th key={f} scope="col" className="px-2 py-1.5 text-start font-semibold">
              {DESIGNER_FIELD_LABEL[f]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.lesson_id} className={r.kind === "memorial" ? "bg-amber-50" : ""}>
            {DESIGNER_FIELDS.map((f) => (
              <td key={f} className={`px-2 py-1.5 ${f === "title" || f === "speaker" || f === "category" ? "" : "whitespace-nowrap"}`}>
                <bdi dir={f === "time" ? "ltr" : undefined}>{designerCell(r, f)}</bdi>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Diff({ diff }: { diff: ScheduleDiff }) {
  const line = (r: DesignerRow) => (
    <>
      {r.day} <bdi dir="ltr">{r.time}</bdi>
      {[r.speaker, r.title].filter(Boolean).map((x, i) => (
        <span key={i}> · {x}</span>
      ))}
    </>
  );
  return (
    <div className="space-y-4">
      {diff.added.length > 0 && (
        <section aria-label="נוספו">
          <h4 className="font-semibold text-ok">נוספו ({diff.added.length})</h4>
          <ul className="list-disc ps-5 text-sm">
            {diff.added.map((r) => (
              <li key={r.lesson_id}>{line(r)}</li>
            ))}
          </ul>
        </section>
      )}
      {diff.removed.length > 0 && (
        <section aria-label="הוסרו">
          <h4 className="font-semibold text-bad">הוסרו ({diff.removed.length})</h4>
          <ul className="list-disc ps-5 text-sm">
            {diff.removed.map((r) => (
              <li key={r.lesson_id}>
                <s>{line(r)}</s>
              </li>
            ))}
          </ul>
        </section>
      )}
      {diff.changed.length > 0 && (
        <section aria-label="השתנו">
          <h4 className="font-semibold">השתנו ({diff.changed.length})</h4>
          <ul className="space-y-2 text-sm">
            {diff.changed.map((c) => (
              <li key={c.after.lesson_id} className="rounded-lg border border-line p-2">
                <p className="font-semibold">{line(c.after)}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                  {c.fields.map((f) => (
                    <div key={f} className="contents" data-changed={f}>
                      <dt className="text-ink-soft">{DESIGNER_FIELD_LABEL[f]}</dt>
                      <dd>
                        <s className="text-ink-soft">
                          <bdi dir={f === "time" ? "ltr" : undefined}>{designerCell(c.before, f) || "—"}</bdi>
                        </s>{" "}
                        ← <mark className="rounded bg-accent-soft px-1 font-semibold text-ink">
                          <bdi dir={f === "time" ? "ltr" : undefined}>{designerCell(c.after, f) || "—"}</bdi>
                        </mark>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
