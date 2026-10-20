// «מחזור» — the editions an admin sees, and (global admin) opening this year's
// week with public.start_edition(). The date and Sunday's opening stay TBD
// until someone knows them: nothing here is ever guessed.
import { type FormEvent, useId, useState } from "react";
import { Link } from "react-router";
import type { DataPort } from "../../data/port";
import { fmt, hebrewDate } from "../../domain/time";
import type { Edition } from "../../domain/types";
import { errorMessage } from "../../errors";
import { hebrewYearLabel } from "../../settings/hebrewYear";
import { ArchivePanel } from "./ArchivePanel";
import { Badge, Button, Confirm, Field, INPUT, KIND_LABEL, Panel, Row, Rows, STATUS_LABEL, useAction, useSettings } from "./kit";

const FORM_REFUSALS = ["label_required", "edition_exists", "not_sunday", "bad_time", "bad_value"];

/** "יום ראשון, 14.2.2027 · ז׳ באדר" — or TBD. */
function fmtDate(iso: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(`${iso}T00:00:00Z`);
  const g = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
  return `${g} · ${hebrewDate(d)}`;
}

/** "08:30" from a time input → 510; "" → null (TBD). */
function clockToMin(s: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function EditionsTab({ editions, reload, onStarted, data }: { editions: Edition[]; reload: () => Promise<void>; onStarted: (id: number) => void; data: DataPort }) {
  const { me } = useSettings();
  const list = (
    <Panel title="המחזורים" aside={editions.length === 1 ? "מחזור אחד" : `${editions.length} מחזורים`}>
      {editions.length === 0 ? (
        <p className="text-ink-soft">עוד לא נפתח אף מחזור.</p>
      ) : (
        <Rows label="המחזורים" head={["שם", "סוג", "מצב", "תאריך הפתיחה", "פתיחה ביום ראשון"]}>
          {editions.map((e) => (
            <EditionItem key={e.id} e={e} onChanged={reload} />
          ))}
        </Rows>
      )}
      {!me.global_admin && <p className="mt-3 text-xs text-ink-soft">פתיחת מחזור ועריכת התאריכים שמורות למי שמדריך/ה בכל המחזורים.</p>}
    </Panel>
  );
  const started = async (id: number) => {
    await reload();
    onStarted(id);
  };
  const start = me.global_admin && <StartEdition editions={editions} onStarted={started} />;
  return editions.length === 0 ? (
    <>
      {start}
      {list}
    </>
  ) : (
    <>
      {list}
      {start}
      {me.global_admin && <ArchivePanel data={data} editions={editions} />}
    </>
  );
}

function EditionItem({ e, onChanged }: { e: Edition; onChanged: () => Promise<void> }) {
  const { me } = useSettings();
  const [editing, setEditing] = useState(false);
  const cells = [
    e.label,
    KIND_LABEL[e.kind],
    <Badge tone={e.status === "archived" ? "muted" : e.status === "active" ? "ok" : "accent"}>{STATUS_LABEL[e.status]}</Badge>,
    <span className={e.start_date ? "" : "text-ink-soft italic"}>{fmtDate(e.start_date)}</span>,
    <span className={e.first_day_from != null ? "" : "text-ink-soft italic"}>
      {e.first_day_from != null ? <bdi>{fmt(e.first_day_from)}</bdi> : "TBD"}
    </span>,
  ];
  if (editing) {
    return (
      <Row
        cells={cells}
        editing={
          <EditDates
            e={e}
            onDone={async (saved) => {
              setEditing(false);
              if (saved) await onChanged();
            }}
          />
        }
      />
    );
  }
  return (
    <Row
      muted={e.status === "archived"}
      labelled
      cells={cells}
      actions={
        me.global_admin && (
          <Button kind="quiet" onClick={() => setEditing(true)} aria-label={`עריכת התאריכים של ${e.label}`}>
            עריכת תאריכים
          </Button>
        )
      }
    />
  );
}

function DateFields({ id, date, setDate, time, setTime }: { id: string; date: string; setDate: (v: string) => void; time: string; setTime: (v: string) => void }) {
  return (
    <>
      <Field id={`${id}-date`} label="תאריך הפתיחה (יום ראשון)" hint="ריק = עוד לא ידוע (TBD).">
        <div className="flex gap-2">
          <input id={`${id}-date`} type="date" className={INPUT} value={date} onChange={(ev) => setDate(ev.target.value)} aria-describedby={`${id}-date-hint`} />
          {date && (
            <Button kind="quiet" onClick={() => setDate("")} aria-label="ניקוי התאריך">
              ניקוי
            </Button>
          )}
        </div>
      </Field>
      <Field id={`${id}-time`} label="שעת הפתיחה ביום ראשון" hint="ריק = עוד לא ידוע (TBD).">
        <div className="flex gap-2">
          <input id={`${id}-time`} type="time" step={300} className={INPUT} value={time} onChange={(ev) => setTime(ev.target.value)} aria-describedby={`${id}-time-hint`} />
          {time && (
            <Button kind="quiet" onClick={() => setTime("")} aria-label="ניקוי השעה">
              ניקוי
            </Button>
          )}
        </div>
      </Field>
    </>
  );
}

function EditDates({ e, onDone }: { e: Edition; onDone: (saved: boolean) => void }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [date, setDate] = useState(e.start_date ?? "");
  const [time, setTime] = useState(e.first_day_from != null ? fmt(e.first_day_from) : "");
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    setProblem(null);
    const ok = await run("save", () => port.updateEdition(e.id, { start_date: date || null, first_day_from: clockToMin(time) }), "התאריכים נשמרו", (code) => {
      if (!code || !FORM_REFUSALS.includes(code)) return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) onDone(true);
  };
  return (
    <form onSubmit={save} className="grid gap-3 rounded-lg border border-line bg-paper p-3 sm:grid-cols-2" noValidate>
      <p className="font-semibold sm:col-span-2">{e.label}</p>
      <DateFields id={id} date={date} setDate={setDate} time={time} setTime={setTime} />
      {problem && (
        <p role="alert" className="text-sm text-bad sm:col-span-2">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button kind="primary" type="submit" busy={busy === "save"} busyLabel="שומר…">
          שמירה
        </Button>
        <Button onClick={() => onDone(false)}>ביטול</Button>
      </div>
    </form>
  );
}

function StartEdition({ editions, onStarted }: { editions: Edition[]; onStarted: (id: number) => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [label, setLabel] = useState(() => hebrewYearLabel());
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const id = useId();
  // start_edition() archives the current real edition (kind real, not archived yet).
  const current = editions.find((e) => e.kind === "real" && e.status !== "archived");
  // The one setting that archives a live week: behind a button while a week is live.
  const [open, setOpen] = useState(!current);
  const again = () => {
    setOpened(null);
    setLabel(hebrewYearLabel());
    setProblem(null);
    setOpen(true);
  };

  const start = async () => {
    setProblem(null);
    setConfirming(false);
    const name = label.trim();
    let newId = 0;
    const ok = await run(
      "start",
      async () => {
        newId = await port.startEdition({ label, start_date: date || null, first_day_from: clockToMin(time) });
      },
      `המחזור ${name} נפתח`,
      (code) => {
        if (!code || !FORM_REFUSALS.includes(code)) return false;
        setProblem(errorMessage(code));
        return true;
      },
    );
    if (ok) {
      setOpened(name);
      setOpen(false);
      setDate("");
      setTime("");
      await onStarted(newId);
    }
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (current) setConfirming(true);
    else void start();
  };

  if (opened) {
    return (
      <Panel title="פתיחת מחזור חדש">
        <div className="mb-3 rounded-lg bg-ok/10 px-3 py-2 text-sm">
          המחזור <b>{opened}</b> נפתח, עם הרשת של 2026 וחדר «בית מדרש». עכשיו מוסיפים את הצוות.
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/settings/team" className="inline-flex min-h-11 items-center rounded-lg bg-ink px-4 font-semibold text-paper hover:bg-ink/90">
            להוספת הצוות
          </Link>
          <Button onClick={again}>פתיחת מחזור נוסף</Button>
        </div>
      </Panel>
    );
  }
  if (!open && current) {
    return (
      <Panel title="פתיחת מחזור חדש">
        <p className="mb-3 text-sm text-ink-soft">
          פותחים מחזור פעם בשנה. פתיחת מחזור חדש מעבירה את <b className="text-ink">{current.label}</b> לארכיון.
        </p>
        <Button onClick={() => setOpen(true)}>לפתיחת מחזור חדש</Button>
      </Panel>
    );
  }
  return (
    <Panel title="פתיחת מחזור חדש">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field id={`${id}-label`} label="שם המחזור" hint="השנה העברית, כמו על הפוסטר.">
          <input
            id={`${id}-label`}
            className={INPUT}
            value={label}
            maxLength={40}
            onChange={(ev) => {
              setLabel(ev.target.value);
              setProblem(null);
            }}
            aria-describedby={`${id}-label-hint`}
          />
        </Field>
        <div className="hidden sm:block" />
        <DateFields id={id} date={date} setDate={setDate} time={time} setTime={setTime} />
        {current && (
          <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm sm:col-span-2">
            שימו לב: פתיחת מחזור חדש מעבירה את <b>{current.label}</b> לארכיון. הצוות שלו יוכל רק לצפות בו, והמרצים והקטגוריות נשארים לשנה הבאה.
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm text-bad sm:col-span-2">
            {problem}
          </p>
        )}
        <div className="sm:col-span-2">
          {confirming && current ? (
            <Confirm
              text={
                <>
                  לפתוח את <b>{label.trim()}</b> ולהעביר את <b>{current.label}</b> לארכיון?
                </>
              }
              confirm="כן, לפתוח"
              danger={false}
              busy={busy === "start"}
              onConfirm={() => void start()}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" type="submit" busy={busy === "start"} busyLabel="פותח…" disabled={!label.trim()}>
                פתיחת המחזור
              </Button>
              {current && (
                <Button
                  onClick={() => {
                    setProblem(null);
                    setOpen(false);
                  }}
                >
                  ביטול
                </Button>
              )}
            </div>
          )}
        </div>
      </form>
    </Panel>
  );
}
