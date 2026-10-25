// A day at a glance (v13) — what the day header opens: its women and men (closed,
// in process, still open) against the tolerance and the week, its topics and what
// it has none of yet, every hour of it, and its warnings. An edition admin also
// sets the grid's two rules here (set_grid_rules); unset, each is «הצעה».
import { useState } from "react";
import { memorialCard } from "../domain/memorial";
import { displayName } from "../domain/names";
import { DAY_NAMES, type Day, fmt, fmtRange, overlaps } from "../domain/time";
import type { GridRow, Lesson } from "../domain/types";
import type { GridRules } from "../data/commands";
import { DEFAULT_GENDER_TOLERANCE, unbalanced, weekBalance } from "../rules/balance";
import { DEFAULT_MAX_CATEGORY_PER_DAY } from "../rules/warnings";
import { Button, INPUT } from "../screens/settings/kit";
import { GenderDot } from "./bits";
import { rowActive } from "./layout";
import { type GridModel, lessonsOfDay, pitchSpeaker } from "./model";
import { Section, Sheet } from "./Panels";

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function DayPanel({ model, day, isAdmin, onLesson, onCell, onRules, onClose, wide }: {
  model: GridModel;
  day: Day;
  isAdmin: boolean;
  onLesson: (id: number) => void;
  onCell: (day: Day, row: GridRow) => void;
  onRules?: (rules: GridRules) => Promise<boolean>;
  onClose: () => void;
  wide: boolean;
}) {
  const dm = model.days[day];
  const b = dm.balance;
  const settings = model.week.edition.settings;
  const tolerance = settings.gender_tolerance ?? DEFAULT_GENDER_TOLERANCE;
  const max = settings.max_category_per_day ?? DEFAULT_MAX_CATEGORY_PER_DAY;
  const off = unbalanced(b.closed, tolerance);
  const week = weekBalance(model.days.map((d) => d.balance));
  const lessons = lessonsOfDay(model, day);
  const cats = model.week.categories.filter((c) => c.active || dm.load.has(c.id));
  const missing = cats.filter((c) => c.active && !dm.load.has(c.id));
  const rows = model.week.rows.filter((r) => (r.kind === "lesson" || r.kind === "memorial") && rowActive(r, day, model.week.edition));

  return (
    <Sheet wide={wide} title={`יום ${DAY_NAMES[day]}`} subtitle={off ? "לא מאוזן" : b.need ? "מאוזן בסגורים — אבל יש עוד מה לאזן" : "מאוזן"} onClose={onClose}>
      <Section title="מרצות ומרצים">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm tabular-nums">
          <dt className="text-ink-soft">נסגרו</dt>
          <dd>
            {n(b.closed.f)} מרצות · {n(b.closed.m)} מרצים{b.closed.unknown > 0 && ` · ${n(b.closed.unknown)} מגדר לא ידוע`}
          </dd>
          <dt className="text-ink-soft">בתהליך</dt>
          <dd>
            {n(b.pending.f)} מרצות · {n(b.pending.m)} מרצים{b.pending.unknown > 0 && ` · ${n(b.pending.unknown)} מגדר לא ידוע`}
          </dd>
          <dt className="text-ink-soft">פנויות</dt>
          <dd>{b.open} משבצות</dd>
        </dl>
        <p className={`mt-1 text-sm font-semibold ${off ? "text-bad" : "text-ok"}`} data-day-balance={off ? "off" : "even"}>
          {off ? `לא מאוזן: הפרש של ${n(Math.abs(b.closed.m - b.closed.f))} בסגורים` : "מאוזן בסגורים"}
          <span className="font-normal text-ink-soft">
            {" "}
            ({settings.gender_tolerance == null ? `הצעה: הפרש של עד ${tolerance}` : `הפרש של עד ${tolerance}`})
          </span>
        </p>
        {b.need && (
          <p className={`text-xs ${b.need === "f" ? "text-pink-800" : "text-sky-800"}`}>
            {b.need === "f" ? "לאיזון, המשבצות הפנויות מחכות למרצות" : "לאיזון, המשבצות הפנויות מחכות למרצים"}
            {b.unreachable && " — והיום כבר לא ייסגר מאוזן"}
          </p>
        )}
        <p className="mt-1 text-xs text-ink-soft tabular-nums" aria-label="השבוע כולו">
          השבוע כולו: נסגרו {n(week.closed.f)} מרצות ו-{n(week.closed.m)} מרצים · בתהליך {n(week.pending.f)} ו-{n(week.pending.m)} · {week.open} פנויות
        </p>
      </Section>

      <Section title="נושאים">
        {dm.load.size === 0 ? (
          <p className="text-sm text-ink-soft">עוד לא נסגר שיעור עם נושא ביום הזה.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="הנושאים של היום">
            {cats
              .filter((c) => dm.load.has(c.id))
              .map((c) => {
                const k = dm.load.get(c.id) ?? 0;
                return (
                  <li key={c.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${k > max ? "border-bad text-bad" : "border-line"}`}>
                    <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name} · {k}
                    {k > max && ` (יותר מ-${max})`}
                  </li>
                );
              })}
          </ul>
        )}
        {missing.length > 0 && (
          <p className="mt-1.5 text-xs text-ink-soft">
            <span className="font-semibold">עוד אין ביום הזה:</span> {missing.map((c) => c.name).join(" · ")}
          </p>
        )}
      </Section>

      <Section title="השעות">
        <ol className="space-y-1 text-sm" aria-label={`השעות של יום ${DAY_NAMES[day]}`}>
          {rows.map((r) => {
            const here = lessons.filter((l) => l.kind === (r.kind === "memorial" ? "memorial" : "lesson") && overlaps(l.start_min, l.end_min, r.start_min, r.end_min) && l.start_min >= r.start_min);
            const cont = lessons.some((l) => l.kind === "lesson" && l.start_min < r.start_min && l.end_min > r.start_min);
            if (cont && here.length === 0) return null; // the rest of a merged lesson, listed at its start
            return (
              <li key={r.id} className="flex gap-2">
                <bdi className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-ink-soft">{fmt(r.start_min)}</bdi>
                <div className="min-w-0 flex-1 space-y-0.5">
                  {here.length === 0 ? (
                    r.kind === "memorial" ? (
                      <p className="text-xs text-amber-800">זמן זיכרון — עוד לא נקבע</p>
                    ) : (
                      <button type="button" onClick={() => onCell(day, r)} className="text-xs text-ink-faint underline">
                        פנוי
                      </button>
                    )
                  ) : (
                    here.map((l) => <HourLine key={l.id} model={model} lesson={l} onOpen={() => onLesson(l.id)} />)
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      {dm.warnings.length > 0 && (
        <Section title="אזהרות">
          <ul className="space-y-1 text-sm">
            {dm.warnings.map((w) => (
              <li key={w.key} className={`rounded-md px-2 py-1 ${w.severity === "warn" ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900"}`}>
                {w.severity === "warn" ? "⚠ " : "ℹ "}
                {w.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {isAdmin && onRules && <Rules key={`${settings.gender_tolerance ?? ""}:${settings.max_category_per_day ?? ""}`} model={model} onRules={onRules} />}
    </Sheet>
  );
}

/** One lesson of the day: who (or who is pitched), its title and topic, its state. */
function HourLine({ model, lesson: l, onOpen }: { model: GridModel; lesson: Lesson; onOpen: () => void }) {
  const range = <bdi dir="ltr">{fmtRange(l.start_min, l.end_min)}</bdi>;
  if (l.kind === "memorial") {
    const card = memorialCard(model.week, l);
    return (
      <button type="button" onClick={onOpen} className="block w-full truncate rounded bg-amber-50 px-1.5 py-0.5 text-start text-xs text-amber-900">
        {card.title} · {range}
      </button>
    );
  }
  const cat = l.category_id != null ? model.categoryById.get(l.category_id) : undefined;
  if (l.state === "closed") {
    const lead = model.leadOf.get(l.id);
    return (
      <button type="button" onClick={onOpen} className="block w-full rounded px-1.5 py-0.5 text-start hover:bg-line/40" style={{ borderInlineStart: `4px solid ${cat?.color ?? "#c9c2b3"}` }}>
        <span className="inline-flex items-center gap-1 font-semibold">
          <GenderDot gender={lead?.gender ?? null} />
          {lead ? displayName(lead) : "—"}
        </span>
        <span className="block truncate text-xs text-ink-soft">
          {l.title ?? "כותרת: TBD"} · {cat?.name ?? "נושא: TBD"} · {range}
        </span>
      </button>
    );
  }
  const names = (model.pitchesByLesson.get(l.id) ?? [])
    .filter((p) => p.state !== "declined")
    .map((p) => pitchSpeaker(model, p))
    .filter((s) => s != null)
    .map((s) => displayName(s));
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded border border-dashed border-ink-faint/60 px-1.5 py-0.5 text-start text-xs hover:bg-line/40">
      {names.length ? `בתהליך: ${names.join(", ")}` : "טיוטה — ללא מרצה"} · {range}
    </button>
  );
}

/** The grid's rules, an edition admin's: empty = the «הצעה» default. */
function Rules({ model, onRules }: { model: GridModel; onRules: (rules: GridRules) => Promise<boolean> }) {
  const s = model.week.edition.settings;
  const [tol, setTol] = useState(s.gender_tolerance == null ? "" : String(s.gender_tolerance));
  const [max, setMax] = useState(s.max_category_per_day == null ? "" : String(s.max_category_per_day));
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const ok = (v: string, lo: number, hi: number) => v.trim() === "" || (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi);
  const valid = ok(tol, 0, 5) && ok(max, 1, 10);
  return (
    <Section title="כללי הרשת (מדריך/ה)">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-soft">הפרש מותר ביום בין מרצות למרצים</span>
          <input type="number" inputMode="numeric" min={0} max={5} value={tol} placeholder={`${DEFAULT_GENDER_TOLERANCE} (הצעה)`} onChange={(e) => setTol(e.target.value)} className={`${INPUT} w-32`} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-soft">שיעורים מאותו נושא ביום, לכל היותר</span>
          <input type="number" inputMode="numeric" min={1} max={10} value={max} placeholder={`${DEFAULT_MAX_CATEGORY_PER_DAY} (הצעה)`} onChange={(e) => setMax(e.target.value)} className={`${INPUT} w-32`} />
        </label>
        <Button
          busy={busy}
          disabled={!valid}
          onClick={async () => {
            setBusy(true);
            await onRules({ gender_tolerance: num(tol), max_category_per_day: num(max) });
            setBusy(false);
          }}
        >
          שמירה
        </Button>
      </div>
      <p className="mt-1 text-xs text-ink-soft">ריק = ההצעה. ההפרש: 0–5; הנושאים: 1–10.</p>
    </Section>
  );
}
