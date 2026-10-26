// A day at a glance (v13) — what the day header opens: its women and men (closed,
// in process, still open) against the tolerance, its topics in time order (the axis)
// and what it has none of yet, its warnings, and every hour of it, folded. An edition
// admin also sets the grid's two rules here (set_grid_rules); unset, each is «הצעה».
import { useState } from "react";
import { memorialCard } from "../domain/memorial";
import { displayName } from "../domain/names";
import { DAY_NAMES, type Day, dateOf, fmt, fmtRange, hebrewDate, overlaps, shortDate } from "../domain/time";
import type { GridRow, Lesson } from "../domain/types";
import type { GridRules } from "../data/commands";
import { DEFAULT_GENDER_TOLERANCE, unbalanced } from "../rules/balance";
import { DEFAULT_MAX_CATEGORY_PER_DAY } from "../rules/warnings";
import { Button, Fold, INPUT } from "../screens/settings/kit";
import { GenderDot, NO_TOPIC_COLOR } from "./bits";
import { needText } from "./DayHeader";
import { rowActive } from "./layout";
import { type GridModel, lessonsOfDay, pitchSpeaker } from "./model";
import { Meta, Section, Sheet, WarningList } from "./Panels";
import { TopicAxis } from "./TopicAxis";

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
  const date = dateOf(model.week.edition.start_date, day);
  const lessons = lessonsOfDay(model, day);
  const cats = model.week.categories.filter((c) => c.active || dm.load.has(c.id));
  const missing = cats.filter((c) => c.active && !dm.load.has(c.id));
  const rows = model.week.rows.filter((r) => (r.kind === "lesson" || r.kind === "memorial") && rowActive(r, day, model.week.edition));
  // «לא מאוזן» is the verdict at the top: the list holds the rest
  const warnings = dm.warnings.filter((w) => w.kind !== "gender_day");

  const suggested = (set: boolean) => (set ? "" : " (הצעה)");
  const ruleText = `מותר עד ${tolerance}${suggested(settings.gender_tolerance != null)}`;
  const overText = settings.max_category_per_day == null ? ` (יותר מ-${max}, הצעה)` : ` (יותר מ-${max})`;

  return (
    <Sheet wide={wide} title={`יום ${DAY_NAMES[day]}`} subtitle={<Meta>{date ? `${shortDate(date)} · ${hebrewDate(date)}` : "תאריך TBD"}</Meta>} onClose={onClose}>
      <Section title="מרצות ומרצים">
        <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
          <Tile tone="f" value={n(b.closed.f)} label="מרצות" sub={b.pending.f > 0 ? `${n(b.pending.f)} בתהליך` : undefined} />
          <Tile tone="m" value={n(b.closed.m)} label="מרצים" sub={b.pending.m > 0 ? `${n(b.pending.m)} בתהליך` : undefined} />
          <Tile value={String(b.open)} label={b.open === 1 ? "משבצת פנויה" : "משבצות פנויות"} />
        </div>
        {(b.closed.unknown > 0 || b.pending.unknown > 0) && (
          <p className="mt-2 text-[13px] text-ink-soft">מגדר לא ידוע: {n(b.closed.unknown + b.pending.unknown)}</p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span data-day-balance={off ? "off" : "even"} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${off ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok"}`}>
            {off ? `לא מאוזן — הפרש של ${n(Math.abs(b.closed.m - b.closed.f))} בסגורים` : "✓ מאוזן בסגורים"}
          </span>
          <span className="text-[13px] text-ink-soft">{ruleText}</span>
        </p>
        {/* the header's words; it counts the lessons in process too, so it may ask for women on a day closed even */}
        {b.need && (
          <p className={`mt-1.5 text-[13px] ${b.unreachable ? "text-bad" : b.need === "f" ? "text-pink-800" : "text-sky-800"}`}>
            כולל מי שבתהליך: {needText(b.need, b.deficit)}
            {b.unreachable && " · לא ייסגר מאוזן"}
          </p>
        )}
      </Section>

      <Section title="נושאים">
        <TopicAxis model={model} day={day} size="large" />
        {dm.load.size === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">עוד לא נסגר שיעור עם נושא ביום הזה.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[13px]" aria-label="הנושאים של היום">
            {cats
              .filter((c) => dm.load.has(c.id))
              .map((c) => {
                const k = dm.load.get(c.id) ?? 0;
                return (
                  <li key={c.id} className={`inline-flex items-center gap-1.5 ${k > max ? "font-semibold text-bad" : "text-ink"}`}>
                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name} · {k}
                    {k > max && overText}
                  </li>
                );
              })}
          </ul>
        )}
        {missing.length > 0 && (
          <Fold size="sm" className="mt-2" title="עוד אין ביום הזה" hint={<span className="tabular-nums text-ink-faint">{missing.length}</span>}>
            <ul aria-label="נושאים שעוד אין ביום הזה" className="text-[13px] leading-relaxed text-ink-soft">
              {missing.map((c, i) => (
                <li key={c.id} className="inline">
                  {i > 0 && <span aria-hidden className="text-ink-faint"> · </span>}
                  {c.name}
                </li>
              ))}
            </ul>
          </Fold>
        )}
      </Section>

      {warnings.length > 0 && (
        <Section title="אזהרות" count={warnings.length}>
          <WarningList items={warnings} />
        </Section>
      )}

      {/* the grid (or the day view) beside it shows the same hours: here, folded */}
      <Fold title="השעות" hint={rows.length > 0 && <bdi dir="ltr" className="tabular-nums">{fmtRange(rows[0].start_min, Math.max(...rows.map((r) => r.end_min)))}</bdi>}>
        <ol className="divide-y divide-line/60 text-sm" aria-label={`השעות של יום ${DAY_NAMES[day]}`}>
          {rows.map((r) => {
            const here = lessons.filter((l) => l.kind === (r.kind === "memorial" ? "memorial" : "lesson") && overlaps(l.start_min, l.end_min, r.start_min, r.end_min) && l.start_min >= r.start_min);
            const cont = lessons.some((l) => l.kind === "lesson" && l.start_min < r.start_min && l.end_min > r.start_min);
            if (cont && here.length === 0) return null; // the rest of a merged lesson, listed at its start
            // drafts nobody is pitched for, side by side: one line, not one box each
            const bare = here.filter((l) => l.kind === "lesson" && l.state === "draft" && !(model.pitchesByLesson.get(l.id) ?? []).some((p) => p.state !== "declined"));
            const shown = here.filter((l) => !bare.includes(l));
            return (
              <li key={r.id} className="flex gap-3 py-1.5">
                <bdi className="w-11 shrink-0 pt-2 text-[13px] font-medium tabular-nums text-ink-soft">{fmt(r.start_min)}</bdi>
                <div className="min-w-0 flex-1 space-y-1">
                  {here.length === 0 &&
                    (r.kind === "memorial" ? (
                      <p className="flex min-h-9 items-center text-[13px] text-amber-800">זמן זיכרון — עוד לא נקבע</p>
                    ) : (
                      <button type="button" onClick={() => onCell(day, r)} className={`flex w-full items-center rounded-md px-2.5 text-start text-[13px] text-ink-faint hover:bg-line/40 hover:text-ink ${TARGET}`}>
                        פנוי
                      </button>
                    ))}
                  {shown.map((l) => (
                    <HourLine key={l.id} model={model} lesson={l} onOpen={() => onLesson(l.id)} />
                  ))}
                  {bare.length > 0 && (
                    <button type="button" onClick={() => onLesson(bare[0].id)} className={`flex w-full items-center rounded-md px-2.5 text-start text-[13px] text-ink-soft hover:bg-line/40 hover:text-ink ${TARGET}`}>
                      {bare.length === 1 ? "טיוטה — ללא מרצה" : `${bare.length} משבצות במקביל — ללא מרצה`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Fold>

      {isAdmin && onRules && (
        <Fold
          title="כללי הרשת"
          hint={`הפרש עד ${tolerance}${suggested(settings.gender_tolerance != null)} · עד ${max} מאותו נושא${suggested(settings.max_category_per_day != null)}`}
        >
          <Rules key={`${settings.gender_tolerance ?? ""}:${settings.max_category_per_day ?? ""}`} model={model} onRules={onRules} />
        </Fold>
      )}
    </Sheet>
  );
}

/** A row of the hours a finger taps: 44px on a phone, a line on a wide screen. */
const TARGET = "min-h-11 lg:min-h-9";

/** A number of the day, large, with what it counts. */
function Tile({ value, label, sub, tone }: { value: string; label: string; sub?: string; tone?: "f" | "m" }) {
  const bg = tone === "f" ? "bg-need-f border-pink-200" : tone === "m" ? "bg-need-m border-sky-200" : "bg-card border-line";
  return (
    <div className={`rounded-xl border px-2 py-2.5 ${bg}`}>
      <div className="font-display text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-[13px] text-ink-soft">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

/** One lesson of the day: who (or who is pitched), its title and topic, its state. */
function HourLine({ model, lesson: l, onOpen }: { model: GridModel; lesson: Lesson; onOpen: () => void }) {
  const range = <bdi dir="ltr">{fmtRange(l.start_min, l.end_min)}</bdi>;
  // a lesson longer than its row (merged) says its own hours; one that fills its row needs none
  const row = model.week.rows.find((r) => r.kind === "lesson" && r.start_min === l.start_min);
  const merged = !row || row.end_min !== l.end_min;
  if (l.kind === "memorial") {
    const card = memorialCard(model.week, l);
    return (
      <button type="button" onClick={onOpen} className={`flex w-full items-center rounded-md bg-amber-50 px-2.5 text-start text-[13px] text-amber-900 hover:bg-amber-100 ${TARGET}`}>
        <span className="truncate">{card.title}</span>
      </button>
    );
  }
  const cat = l.category_id != null ? model.categoryById.get(l.category_id) : undefined;
  if (l.state === "closed") {
    const lead = model.leadOf.get(l.id);
    return (
      <button type="button" onClick={onOpen} className="block w-full rounded-md py-0.5 ps-2.5 text-start hover:bg-line/40" style={{ borderInlineStart: `3px solid ${cat?.color ?? NO_TOPIC_COLOR}` }}>
        <span className="flex items-center gap-1.5 font-semibold">
          <GenderDot gender={lead?.gender ?? null} />
          {lead ? displayName(lead) : "—"}
        </span>
        <span className="block truncate text-[13px] text-ink-soft">{l.title ?? "כותרת: TBD"}</span>
        {/* the topic's colour is the stripe: on paper, its name in ink */}
        <span className="block text-xs text-ink-soft">
          {cat?.name ?? "נושא: TBD"}
          {merged && <span className="text-ink-soft"> · {range}</span>}
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
    <button type="button" onClick={onOpen} className={`flex w-full items-center rounded-md border border-dashed border-ink-faint/50 px-2.5 py-1 text-start text-[13px] hover:bg-line/40 ${TARGET}`}>
      <span>
        <span className="text-ink-soft">בתהליך: </span>
        {names.length ? names.join(", ") : "ללא מרצה"}
        {merged && <span className="text-ink-soft"> · {range}</span>}
      </span>
    </button>
  );
}

/** The grid's rules, an edition admin's (inside the «כללי הרשת» fold): empty = the «הצעה» default. */
function Rules({ model, onRules }: { model: GridModel; onRules: (rules: GridRules) => Promise<boolean> }) {
  const s = model.week.edition.settings;
  const [tol, setTol] = useState(s.gender_tolerance == null ? "" : String(s.gender_tolerance));
  const [max, setMax] = useState(s.max_category_per_day == null ? "" : String(s.max_category_per_day));
  const [busy, setBusy] = useState(false);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const ok = (v: string, lo: number, hi: number) => v.trim() === "" || (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi);
  const valid = ok(tol, 0, 5) && ok(max, 1, 10);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-soft">הפרש מותר ביום בין מרצות למרצים</span>
          <input type="number" inputMode="numeric" min={0} max={5} value={tol} placeholder={`${DEFAULT_GENDER_TOLERANCE} (הצעה)`} onChange={(e) => setTol(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-soft">לכל היותר מאותו נושא ביום</span>
          <input type="number" inputMode="numeric" min={1} max={10} value={max} placeholder={`${DEFAULT_MAX_CATEGORY_PER_DAY} (הצעה)`} onChange={(e) => setMax(e.target.value)} className={INPUT} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
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
        {/* the ranges matter only when a value is out of them («שמירה» is off then) */}
        <p className="text-[13px] text-ink-soft">
          ריק = הצעה.
          {!valid && <span className="font-semibold text-bad"> הפרש 0–5, נושאים 1–10.</span>}
        </p>
      </div>
    </>
  );
}
