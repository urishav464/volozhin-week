// After the week, in «הגדרות ← מחזור» (milestone 6, a global admin):
//   RolloverChecklist  «מעבר לשנה הבאה» — the archive exported, the reviews
//                      written, the private data deleted, the next edition
//                      opened (with the dry run: what it would archive, copy and
//                      deactivate — nothing written), and what stays plainly said.
//   PurgePanel         «מחיקת המידע האישי אחרי השבוע» — public.purge_edition_private:
//                      the archive first (a reminder), the edition's label typed,
//                      then a report of what was deleted (counts only).
// Every decision the instructor has not made is «הצעה» (DECISIONS «אבן דרך 6»).
import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import type { PurgeReport, StartPreview } from "../../data/settings";
import { addDays } from "../../domain/israelTime";
import { purgeAllowed } from "../../domain/reviews";
import type { Edition } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Badge, Button, INPUT, Panel, useAction, useSettings } from "./kit";

/** «20.2.2027» */
function day(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}.${m}.${y}`;
}

/** «20.2.2027» of an instant, in Israel. */
function moment(iso: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" }).format(new Date(iso));
}

/**
 * The edition a year closes: the live real one, else the newest that is not an import's archive (an archive the
 * import made was never open — it has no week to close). Null when there is none.
 */
export function closingEdition(editions: Edition[]): Edition | null {
  return (
    editions.find((e) => e.kind === "real" && e.status !== "archived") ??
    [...editions].filter((e) => e.kind !== "archive").sort((a, b) => b.id - a.id)[0] ??
    null
  );
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

type Step = { n: number; title: string; done: boolean; state: string; action?: { label: string; target?: string; to?: string } };

export function RolloverChecklist({
  data, editions, exported, deactivate, setDeactivate,
}: {
  data: DataPort;
  editions: Edition[];
  /** The editions whose archive was downloaded in this visit (the database keeps no record of a download). */
  exported: ReadonlySet<number>;
  deactivate: boolean;
  setDeactivate: (v: boolean) => void;
}) {
  const e = closingEdition(editions);
  const [reviews, setReviews] = useState<{ edition: number; done: number; total: number } | "failed" | null>(null);
  useEffect(() => {
    if (!e) return;
    let live = true;
    setReviews(null);
    Promise.all([data.loadWeek(e.id), data.reviews.ofEdition(e.id)]).then(
      ([w, r]) => {
        const held = w.lessons.filter((l) => l.kind === "lesson" && l.state === "closed").map((l) => l.id);
        if (live) setReviews({ edition: e.id, done: held.filter((id) => r.some((x) => x.lesson_id === id)).length, total: held.length });
      },
      () => live && setReviews("failed"),
    );
    return () => {
      live = false;
    };
  }, [data, e]);
  if (!e) return null;
  const rv = reviews && reviews !== "failed" && reviews.edition === e.id ? reviews : null;
  const steps: Step[] = [
    {
      n: 1, title: "ייצוא הארכיון", done: exported.has(e.id),
      state: exported.has(e.id) ? "ירד בביקור הזה" : "המערכת לא יודעת אם ירד: מורידים, ושומרים במקום מוגן",
      action: { label: "לייצוא הארכיון", target: "archive-panel" },
    },
    {
      n: 2, title: "«איך עבר» לכל שיעור", done: !!rv && rv.total > 0 && rv.done === rv.total,
      state: rv ? `נכתבו ${rv.done} מתוך ${rv.total}` : reviews === "failed" ? "לא נטען" : "טוען…",
      action: { label: "לסיכום המחזור", to: "/knowledge/summary" },
    },
    {
      n: 3, title: "מחיקת המידע האישי אחרי השבוע", done: e.purged_at != null,
      state: e.purged_at ? `נמחק ב-${moment(e.purged_at)}` : "עוד לא נמחק",
      action: { label: "למחיקה", target: "purge-panel" },
    },
    {
      n: 4, title: "פתיחת המחזור הבא", done: e.status === "archived",
      state: e.status === "archived" ? "המחזור כבר בארכיון" : "פותחים כשמתחילים לתכנן את השנה הבאה",
      action: { label: "לטופס המחזור החדש", target: "start-panel" },
    },
  ];
  return (
    <Panel title="מעבר לשנה הבאה" aside={`המחזור שנסגר: ${e.label}`}>
      <ol aria-label="מעבר לשנה הבאה" className="space-y-2">
        {steps.map((s) => (
          <li key={s.n} data-step={s.n} data-done={s.done} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-paper px-3 py-2">
            <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${s.done ? "bg-ok text-paper" : "border border-line"}`}>
              {s.done ? "✓" : s.n}
            </span>
            <span className="min-w-0 flex-1">
              <b>{s.title}</b>
              <span className="block text-sm text-ink-soft">{s.state}</span>
            </span>
            {s.action &&
              (s.action.to ? (
                <Link to={s.action.to} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-card px-3 text-sm font-semibold hover:bg-line/50">
                  {s.action.label}
                </Link>
              ) : (
                <Button onClick={() => scrollTo(s.action!.target!)}>{s.action.label}</Button>
              ))}
          </li>
        ))}
        <li data-step={5} className="rounded-lg border border-line bg-paper px-3 py-2">
          <b>מה עובר לשנה הבאה</b>
          <ul className="mt-1 list-disc ps-5 text-sm">
            <li>הנוסחים: תבנית הודעת הסיכום וניסוחי «משהו שחשוב לדעת» (מהמחזור האמיתי הפעיל).</li>
            <li>אבני הדרך (הכותרת ו-W−n; אף אחת לא מסומנת «בוצע»).</li>
            <li>הערות הידע «לכל השנים». הערות של המחזור נשארות איתו.</li>
            <li>מאגר המרצים, עם פרטי הקשר ועם «איך עבר» של השנים הקודמות.</li>
            <li>הקטגוריות, ורשימת החללים עם אנשי הקשר של המשפחות.</li>
            <li>רשת השבוע מהתבנית של 2026 וחדר «בית מדרש». החדרים האחרים, החניכים והצוות — מוסיפים מחדש.</li>
          </ul>
        </li>
      </ol>
      <DryRun deactivate={deactivate} setDeactivate={setDeactivate} />
    </Panel>
  );
}

/** The option start_edition takes — on by default, «הצעה»: the instructor has not decided. */
export function DeactivateOption({ value, onChange, current }: { value: boolean; onChange: (v: boolean) => void; current: string }) {
  return (
    <div className="min-w-0">
      <label className="inline-flex min-h-11 cursor-pointer items-start gap-2 py-2">
        <input type="checkbox" checked={value} onChange={(ev) => onChange(ev.target.checked)} className="mt-1 size-4 shrink-0 accent-ink" />
        <span>
          להשבית את חברי הצוות של המחזור הקודם (מלבד אדמינים) <Badge tone="accent">הצעה</Badge>
          <span className="block text-xs text-ink-soft">
            חברי התוכן והלוגיסטיקה של <b>{current}</b> לא ייכנסו עוד (לא נמחקים: ההיסטוריה שלהם נשארת). המדריך/ה עוד לא החליט/ה, ולכן זו הצעה.
          </span>
        </span>
      </label>
    </div>
  );
}

function DryRun({ deactivate, setDeactivate }: { deactivate: boolean; setDeactivate: (v: boolean) => void }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [preview, setPreview] = useState<{ p: StartPreview; deactivate: boolean } | null>(null);
  const go = () =>
    run("preview", async () => setPreview({ p: await port.previewStart(deactivate), deactivate }), null);
  const p = preview?.p;
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-3">
      <h4 className="font-semibold">הרצה יבשה: מה יקרה בפתיחת המחזור הבא</h4>
      <p className="text-sm text-ink-soft">שום דבר לא נכתב: רק מספרים, כדי לתרגל לפני שפותחים באמת.</p>
      <DeactivateOption value={deactivate} onChange={(v) => { setDeactivate(v); setPreview(null); }} current="המחזור הנוכחי" />
      <Button onClick={() => void go()} busy={busy === "preview"} busyLabel="בודק…">
        הרצה יבשה
      </Button>
      {p && (
        <dl data-dry-run aria-label="תוצאת ההרצה היבשה" className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-paper p-3 text-sm">
          <dt className="text-ink-soft">יעבור לארכיון</dt>
          <dd data-dry="archive">{p.archive.length === 0 ? "אף מחזור (אין מחזור אמיתי פעיל)" : p.archive.map((e) => e.label).join(", ")}</dd>
          <dt className="text-ink-soft">הנוסחים ואבני הדרך מ־</dt>
          <dd>{p.carry_from ? p.carry_from.label : "אין מחזור אמיתי — מתחילים בלי"}</dd>
          <dt className="text-ink-soft">יועתקו</dt>
          <dd data-dry="copy">
            {p.grid_rows} שורות רשת · {p.milestones} אבני דרך · {p.confirm_template ? "תבנית הודעת הסיכום" : "בלי תבנית הודעה"} · {p.duty_phrases} ניסוחי מלווים
          </dd>
          <dt className="text-ink-soft">יושבתו</dt>
          <dd data-dry="deactivate">
            {preview!.deactivate ? (p.deactivate === 1 ? "חבר/ת צוות אחד/ת (תוכן או לוגיסטיקה)" : `${p.deactivate} חברי צוות (תוכן ולוגיסטיקה)`) : "אף אחד (האפשרות כבויה)"} ·{" "}
            {p.admins_stay === 1 ? "אדמין אחד/ת של המחזור נשאר/ת" : `${p.admins_stay} אדמינים של המחזור נשארים`}
          </dd>
          <dt className="text-ink-soft">נשארים לכל השנים</dt>
          <dd data-dry="stays">
            {[
              p.stays.speakers === 1 ? "מרצה אחד/ת" : `${p.stays.speakers} מרצים`,
              p.stays.categories === 1 ? "קטגוריה אחת" : `${p.stays.categories} קטגוריות`,
              p.stays.fallen === 1 ? "חלל אחד" : `${p.stays.fallen} חללים`,
              p.stays.notes === 1 ? "הערת ידע אחת" : `${p.stays.notes} הערות ידע`,
            ].join(" · ")}
          </dd>
        </dl>
      )}
    </div>
  );
}

export function PurgePanel({ editions, reload }: { editions: Edition[]; reload: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const id = useId();
  // the purge's default: the edition the year closes — an archive only when there is nothing else (its notes, too, can go)
  const pick = closingEdition(editions) ?? [...editions].sort((a, b) => b.id - a.id)[0] ?? null;
  const [chosen, setChosen] = useState<number | null>(pick?.id ?? null);
  const e = editions.find((x) => x.id === chosen) ?? pick;
  const [typed, setTyped] = useState("");
  const [report, setReport] = useState<{ edition: string; r: PurgeReport } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!e) return null;
  const allowed = purgeAllowed(e, new Date().toISOString());
  const exact = typed.replace(/^ +| +$/g, "") === e.label;
  const purge = async () => {
    setProblem(null);
    const out: { r?: PurgeReport } = {};
    const ok = await run(
      "purge",
      async () => {
        out.r = await port.purgeEdition(e.id, typed);
      },
      null,
      (code) => {
        if (!code || !["confirm_mismatch", "week_not_over"].includes(code)) return false;
        setProblem(errorMessage(code));
        return true;
      },
    );
    if (ok && out.r) {
      setReport({ edition: e.label, r: out.r });
      setTyped("");
      await reload();
    }
  };
  return (
    <div id="purge-panel" className="scroll-mt-2">
      <Panel title="מחיקת המידע האישי אחרי השבוע" aside="פעולה שאי אפשר לבטל">
        <div className="space-y-3 text-sm">
          {editions.length > 1 && (
            <label className="flex max-w-sm flex-col font-semibold">
              מוחקים את המידע של
              <select
                value={e.id}
                onChange={(ev) => {
                  setChosen(Number(ev.target.value));
                  setTyped("");
                  setProblem(null);
                  setReport(null);
                }}
                className={INPUT}
              >
                {editions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                    {x.purged_at ? " (נמחק)" : x.status === "archived" ? " (בארכיון)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div>
            <p className="font-semibold">מה נמחק:</p>
            <ul className="list-disc ps-5">
              <li>פרטי ההסעה של כל השיעורים: כתובות איסוף, שעות איסוף, שמות הנהגים והטלפונים שלהם.</li>
              {e.kind === "archive" && (
                <li data-purge-import-notes>
                  ההערות שהייבוא הביא מגיליון המעקב («מגיליון המעקב של אשתקד» בלוח השיעור): מה שנכתב שם על הסעה ותשלום, מי שלח/ה את הודעת הסיכום ושאר ההערות.{" "}
                  <Badge tone="accent">הצעה</Badge>
                </li>
              )}
              <li>כל הקישורים של המחזור מבוטלים: קישורי המלווים, ההרשמה למכריכה לכריכה והלו"ז. הם לא ייפתחו יותר.</li>
              <li>מוני מגבלת הקצב של הקישורים (טביעות חד-כיווניות של כתובות ה-IP של מי שפתח/ה אותם).</li>
            </ul>
            <p className="mt-2 font-semibold">מה נשאר:</p>
            <ul className="list-disc ps-5">
              <li>השיעורים, הלו"ז, «איך עבר», ידע ואבני דרך, קבצי המקורות ותוכניות זמני הזיכרון.</li>
              <li>שמות החניכים וההרשמות למכריכה לכריכה (שמות בלבד), והסימונים של המלווים.</li>
              <li>פרטי הקשר של המרצים ואנשי הקשר של המשפחות: הם לכל השנים, ומשמשים בשנה הבאה.</li>
              <li>חברי הצוות (את ההשבתה עושים בפתיחת המחזור הבא).</li>
            </ul>
          </div>
          {e.purged_at ? (
            <p data-purged className="rounded-lg bg-ok/10 px-3 py-2">
              המידע האישי של <b>{e.label}</b> נמחק ב-{moment(e.purged_at)}. אפשר להריץ שוב (למשל אם נכתבו פרטי הסעה מאז): מה שכבר נמחק לא חוזר.
            </p>
          ) : !allowed ? (
            <p className="rounded-lg bg-accent-soft px-3 py-2">
              אפשר למחוק רק אחרי שהשבוע נגמר
              {e.start_date ? ` — מיום שישי ${day(addDays(e.start_date, 5))}, לפי שעון ישראל` : " (תאריך השבוע עוד TBD)"}, או כשהמחזור בארכיון.
            </p>
          ) : null}
          {(allowed || e.purged_at) && (
            <>
              <p className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2">
                <b>קודם מייצאים את הארכיון</b> (למטה, «ייצוא ארכיון»): אחרי המחיקה פרטי ההסעה כבר לא יהיו בשום מקום.{" "}
                <button type="button" className="inline-flex min-h-11 items-center underline" onClick={() => scrollTo("archive-panel")}>
                  לייצוא הארכיון
                </button>
              </p>
              <div className="max-w-sm">
                <label htmlFor={`${id}-confirm`} className="mb-1 block font-semibold">
                  כדי למחוק, מקלידים את שם המחזור: <bdi className="font-mono">{e.label}</bdi>
                </label>
                <input id={`${id}-confirm`} className={INPUT} value={typed} onChange={(ev) => setTyped(ev.target.value)} autoComplete="off" spellCheck={false} />
              </div>
              {problem && (
                <p role="alert" className="text-bad">
                  {problem}
                </p>
              )}
              <Button kind="dangerSolid" disabled={!exact} busy={busy === "purge"} busyLabel="מוחק…" onClick={() => void purge()}>
                מחיקת המידע האישי של {e.label}
              </Button>
            </>
          )}
          {report && (
            <div role="status" data-purge-report className="rounded-lg bg-ok/10 px-3 py-2">
              <p className="font-semibold">נמחק המידע האישי של {report.edition}:</p>
              <ul className="list-disc ps-5">
                <li>{report.r.transport_details === 1 ? "פרטי הסעה של שיעור אחד נמחקו." : `פרטי הסעה של ${report.r.transport_details} שיעורים נמחקו.`}</li>
                {report.r.import_notes > 0 && (
                  <li>{report.r.import_notes === 1 ? "ההערות מגיליון המעקב של שיעור אחד נמחקו." : `ההערות מגיליון המעקב של ${report.r.import_notes} שיעורים נמחקו.`}</li>
                )}
                <li>{report.r.links_revoked === 1 ? "קישור אחד בוטל." : `${report.r.links_revoked} קישורים בוטלו.`}</li>
                <li>{report.r.link_hits === 1 ? "מונה אחד של מגבלת הקצב נמחק." : `${report.r.link_hits} מונים של מגבלת הקצב נמחקו.`}</li>
              </ul>
              <p className="text-xs text-ink-soft">נרשם ביומן הפעולות של המחזור, עם המספרים בלבד.</p>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
