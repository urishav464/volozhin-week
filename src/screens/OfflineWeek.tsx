// The week without internet: the day view drawn from the device's snapshot (src/offline/snapshot.ts), read-only, on
// every width — no command, no proposal, no panel that writes; a card opens a sheet to read. The banner says it is
// a copy, and from when. The app (App.tsx) leaves this screen by itself when the connection returns.
import { useMemo, useState } from "react";
import { displayName } from "../domain/names";
import { DAY_NAMES, type Day, fmtRange } from "../domain/time";
import type { Lesson } from "../domain/types";
import { DayView } from "../grid/DayView";
import { buildModel, type GridModel, pitchSpeaker } from "../grid/model";
import { Sheet } from "../grid/Panels";
import { useMedia } from "../lib/useMedia";
import type { WeekSnapshot } from "../offline/snapshot";
import { savedAtText, todayColumn } from "../offline/view";

export function OfflineWeek({ snapshot }: { snapshot: WeekSnapshot }) {
  const wide = useMedia("(min-width: 1024px)");
  const model = useMemo(() => buildModel(snapshot.week), [snapshot]);
  const [day, setDay] = useState<Day>(() => todayColumn(snapshot.week.edition.start_date, new Date().toISOString()) ?? 0);
  const [open, setOpen] = useState<number | null>(null);
  const lesson = open != null ? model.week.lessons.find((l) => l.id === open) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-2">
      <div role="status" data-offline-banner className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <p className="font-semibold">אין חיבור לאינטרנט — מוצג המצב מ{savedAtText(snapshot.savedAt)}</p>
        <p>לצפייה בלבד: אי אפשר לשנות דבר עד שהחיבור חוזר. כשהוא חוזר, המסך מתעדכן לבד.</p>
      </div>
      <h2 className="font-display text-lg font-semibold">{model.week.edition.label}</h2>
      <DayView model={model} lens="diversity" day={day} onDay={setDay} placing={null} onCell={() => undefined} onLesson={setOpen} readOnly />
      {lesson && <LessonFacts model={model} lesson={lesson} wide={wide} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One lesson, to read: when, where, who, what — as the snapshot holds it (no contact details are in it). */
function LessonFacts({ model, lesson, wide, onClose }: { model: GridModel; lesson: Lesson; wide: boolean; onClose: () => void }) {
  const room = model.week.rooms.find((r) => r.id === lesson.room_id)?.name;
  const category = lesson.category_id != null ? model.categoryById.get(lesson.category_id)?.name : undefined;
  const speakers = model.week.lessonSpeakers
    .filter((x) => x.lesson_id === lesson.id)
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "lead" ? -1 : 1))
    .map((x) => model.speakerById.get(x.speaker_id))
    .filter((s) => s != null);
  const escort = lesson.escort_roster_id != null ? model.week.roster.find((r) => r.id === lesson.escort_roster_id)?.full_name : undefined;
  const pitches = model.pitchesByLesson.get(lesson.id) ?? [];
  const title =
    lesson.kind === "memorial" ? lesson.title || "זמן זיכרון" : lesson.state === "closed" ? (speakers[0] ? displayName(speakers[0]) : "שיעור") : "טיוטה";
  const rows: [string, string][] = [
    ["יום ושעה", `${DAY_NAMES[lesson.day]} · ${fmtRange(lesson.start_min, lesson.end_min)}`],
    ["חדר", room ?? "TBD"],
  ];
  if (lesson.kind === "lesson") {
    if (lesson.state === "closed") {
      rows.push(["כותרת", lesson.title ?? "TBD"]);
      if (speakers.length > 1) rows.push(["מרצים", speakers.map(displayName).join(" · ")]);
      if (category) rows.push(["קטגוריה", category]);
      if (lesson.audience) rows.push(["קהל", lesson.audience]);
      if (lesson.teach_min != null) rows.push(["זמן הוראה", `${lesson.teach_min} דקות`]);
      rows.push(["מלווה", escort ?? (lesson.self_intro ? "הצגה עצמית" : "עוד לא נקבע/ה")]);
    } else {
      const names = pitches.map((p) => pitchSpeaker(model, p)).filter((s) => s != null).map(displayName);
      rows.push(["מועמדים", names.length ? names.join(" · ") : "אין עדיין"]);
    }
  }
  return (
    <Sheet title={title} subtitle="לצפייה בלבד, בלי חיבור לאינטרנט" onClose={onClose} wide={wide}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-ink-soft">{k}</dt>
            <dd>{k === "יום ושעה" ? <bdi>{v}</bdi> : v}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}
