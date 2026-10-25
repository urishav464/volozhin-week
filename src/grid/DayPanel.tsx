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
import { Meta, Section, Sheet, WarningList } from "./Panels";

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

  const ruleText = settings.gender_tolerance == null ? `הצעה: הפרש של עד ${tolerance}` : `הפרש של עד ${tolerance}`;

  return (
    <Sheet
      wide={wide}
      title={`יום ${DAY_NAMES[day]}`}
      subtitle={<Meta tone={off ? "warn" : "plain"}>{off ? "⚠ לא מאוזן" : "מאוזן"}</Meta>}
      onClose={onClose}
    >
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
        {b.need && (
          <p className={`mt-1.5 text-[13px] ${b.need === "f" ? "text-pink-800" : "text-sky-800"}`}>
            {b.need === "f" ? "המשבצות הפנויות מחכות למרצות" : "המשבצות הפנויות מחכות למרצים"}
            {b.unreachable && " — והיום כבר לא ייסגר מאוזן"}
          </p>
        )}
        <p className="mt-2 text-[13px] text-ink-soft tabular-nums" aria-label="השבוע כולו">
          בשבוע כולו נסגרו {n(week.closed.f)} מרצות ו-{n(week.closed.m)} מרצים
        </p>
      </Section>

      <Section title="נושאים">
        {dm.load.size === 0 ? (
          <p className="text-sm text-ink-soft">עוד לא נסגר שיעור עם נושא ביום הזה.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5 text-[13px]" aria-label="הנושאים של היום">
            {cats
              .filter((c) => dm.load.has(c.id))
              .map((c) => {
                const k = dm.load.get(c.id) ?? 0;
                return (
                  <li key={c.id} className={`inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 ${k > max ? "border-bad text-bad" : "border-line"}`}>
                    <span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name} · {k}
                    {k > max && ` (יותר מ-${max})`}
                  </li>
                );
              })}
          </ul>
        )}
        {missing.length > 0 && (
          <>
            <p className="mb-1.5 mt-3 text-[13px] font-medium text-ink-soft">עוד אין ביום הזה</p>
            <ul className="flex flex-wrap gap-1.5 text-[13px] text-ink-soft" aria-label="נושאים שעוד אין ביום הזה">
              {missing.map((c) => (
                <li key={c.id} className="rounded-full border border-dashed border-line px-2.5 py-1">
                  {c.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="השעות">
        <ol className="divide-y divide-line/60 text-sm" aria-label={`השעות של יום ${DAY_NAMES[day]}`}>
          {rows.map((r) => {
            const here = lessons.filter((l) => l.kind === (r.kind === "memorial" ? "memorial" : "lesson") && overlaps(l.start_min, l.end_min, r.start_min, r.end_min) && l.start_min >= r.start_min);
            const cont = lessons.some((l) => l.kind === "lesson" && l.start_min < r.start_min && l.end_min > r.start_min);
            if (cont && here.length === 0) return null; // the rest of a merged lesson, listed at its start
            // drafts nobody is pitched for, side by side: one line, not one box each
            const bare = here.filter((l) => l.kind === "lesson" && l.state === "draft" && !(model.pitchesByLesson.get(l.id) ?? []).some((p) => p.state !== "declined"));
            const shown = here.filter((l) => !bare.includes(l));
            return (
              <li key={r.id} className="flex gap-3 py-2">
                <bdi className="w-11 shrink-0 pt-0.5 text-[13px] font-medium tabular-nums text-ink-soft">{fmt(r.start_min)}</bdi>
                <div className="min-w-0 flex-1 space-y-1">
                  {here.length === 0 &&
                    (r.kind === "memorial" ? (
                      <p className="text-[13px] text-amber-800">זמן זיכרון — עוד לא נקבע</p>
                    ) : (
                      <button type="button" onClick={() => onCell(day, r)} className="text-[13px] text-ink-faint hover:text-ink hover:underline">
                        פנוי
                      </button>
                    ))}
                  {shown.map((l) => (
                    <HourLine key={l.id} model={model} lesson={l} onOpen={() => onLesson(l.id)} />
                  ))}
                  {bare.length > 0 && (
                    <button type="button" onClick={() => onLesson(bare[0].id)} className="block text-start text-[13px] text-ink-soft hover:text-ink hover:underline">
                      {bare.length === 1 ? "טיוטה — ללא מרצה" : `${bare.length} משבצות במקביל — ללא מרצה`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      {dm.warnings.length > 0 && (
        <Section title="אזהרות" aside={dm.warnings.length}>
          <WarningList items={dm.warnings} />
        </Section>
      )}

      {isAdmin && onRules && <Rules key={`${settings.gender_tolerance ?? ""}:${settings.max_category_per_day ?? ""}`} model={model} onRules={onRules} />}
    </Sheet>
  );
}

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
      <button type="button" onClick={onOpen} className="block w-full truncate rounded-md bg-amber-50 px-2.5 py-1 text-start text-[13px] text-amber-900 hover:bg-amber-100">
        {card.title}
      </button>
    );
  }
  const cat = l.category_id != null ? model.categoryById.get(l.category_id) : undefined;
  if (l.state === "closed") {
    const lead = model.leadOf.get(l.id);
    return (
      <button type="button" onClick={onOpen} className="block w-full rounded-md py-0.5 ps-2.5 text-start hover:bg-line/40" style={{ borderInlineStart: `3px solid ${cat?.color ?? "#c9c2b3"}` }}>
        <span className="flex items-center gap-1.5 font-semibold">
          <GenderDot gender={lead?.gender ?? null} />
          {lead ? displayName(lead) : "—"}
        </span>
        <span className="block truncate text-[13px] text-ink-soft">{l.title ?? "כותרת: TBD"}</span>
        <span className="block text-xs" style={{ color: cat?.color ?? "#6b6457" }}>
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
    <button type="button" onClick={onOpen} className="block w-full rounded-md border border-dashed border-ink-faint/50 px-2.5 py-1 text-start text-[13px] hover:bg-line/40">
      <span className="text-ink-soft">בתהליך: </span>
      {names.length ? names.join(", ") : "ללא מרצה"}
      {merged && <span className="text-ink-soft"> · {range}</span>}
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
    <Section title="כללי הרשת" aside="למדריך/ה">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-soft">הפרש מותר ביום בין מרצות למרצים</span>
          <input type="number" inputMode="numeric" min={0} max={5} value={tol} placeholder={`${DEFAULT_GENDER_TOLERANCE} (הצעה)`} onChange={(e) => setTol(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-ink-soft">שיעורים מאותו נושא ביום, לכל היותר</span>
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
        <p className="text-[13px] text-ink-soft">ריק = ההצעה. הפרש 0–5, נושאים 1–10.</p>
      </div>
    </Section>
  );
}
