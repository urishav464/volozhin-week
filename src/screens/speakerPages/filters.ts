// «מרצים» (/speakers): which speakers the list shows and in what order, from the filters its address holds
// (src/domain/routes.ts SpeakersQuery). Pure, so «לבחור מרצה» on «היום שלי» and the list agree on who fits a slot.
import { activeLessonRows, dayKind } from "../../domain/availability";
import type { SlotRef, SpeakersQuery } from "../../domain/routes";
import type { Approach, Speaker } from "../../domain/types";
import { type Fit, fitFor, type GridModel, type OpenSlot, openSlots, type PoolSection, poolSection, speakerMatches } from "../../grid/model";

/** One speaker in the list: where they sit from my point of view, who handles them, how many lessons they closed here. */
export interface SpeakerRow {
  speaker: Speaker;
  section: PoolSection;
  approach: Approach | null;
  /** members.id of the handler; null: nobody. */
  handler: number | null;
  /** Closed lessons this edition (lead or co). */
  closed: number;
  /** How they fit the slot the list is filtered by; null without one. */
  fit: Fit | null;
}

/** «לפי מצב»: mine first, then the free ones, the others', the closed, who declined. */
export const SECTION_ORDER: readonly PoolSection[] = ["mine", "free", "others", "closed", "declined"];
const SECTION_RANK = new Map(SECTION_ORDER.map((s, i) => [s, i]));

const byName = (a: SpeakerRow, b: SpeakerRow) => a.speaker.name.localeCompare(b.speaker.name, "he") || a.speaker.id - b.speaker.id;

/**
 * The list: never a retired speaker. `q` the search (name, topics, institution — the pool's), `cat` a topic of the week
 * (by its name among the speaker's topics), `g` the gender, `s` the section. `day`: «יכול/ה» on some slot of that day,
 * whatever the rest of it says («רק בשעות…» marks the rest «לא») — so whoever «היום שלי» lists for a free slot of the
 * day is here too. `slot`: they said «יכול/ה» or nothing of it and teach nothing else then — and not who
 * declined this edition — «יכול/ה» first. Then by section (the default, «לפי מצב») or by name.
 */
export function filterSpeakers(model: GridModel, me: number, q: SpeakersQuery): SpeakerRow[] {
  const { week } = model;
  const catName = q.cat != null ? model.categoryById.get(q.cat)?.name : undefined;
  const dayRows = q.day != null ? activeLessonRows(week.rows, week.edition, q.day) : null;
  const out: SpeakerRow[] = [];
  for (const s of week.speakers) {
    if (s.retired) continue;
    if (q.g && s.gender !== q.g) continue;
    if (q.cat != null && (!catName || !s.topics.includes(catName))) continue;
    if (q.q && !speakerMatches(s, q.q)) continue;
    const section = poolSection(model, s.id, me);
    if (q.s && section !== q.s) continue;
    if (q.day != null) {
      const k = dayKind(model.slots.get(s.id), q.day, dayRows!);
      if (k !== "can" && k !== "some") continue;
    }
    let fit: Fit | null = null;
    if (q.slot) {
      fit = fitFor(model, s.id, q.slot.day, q.slot.start, q.slot.end);
      if (fit === "cannot" || fit === "busy" || section === "declined") continue;
    }
    const approach = model.approachBySpeaker.get(s.id) ?? null;
    out.push({ speaker: s, section, approach, handler: approach?.owner_member_id ?? null, closed: model.closedOf.get(s.id)?.length ?? 0, fit });
  }
  const bySort = q.sort === "name" ? byName : (a: SpeakerRow, b: SpeakerRow) => SECTION_RANK.get(a.section)! - SECTION_RANK.get(b.section)! || byName(a, b);
  return out.sort((a, b) => Number(b.fit === "can") - Number(a.fit === "can") || bySort(a, b));
}

/**
 * The slot the list is for, if it is still open: the draft the address names (a parallel pair shares the day and the
 * time — never the other one), else — that draft gone — a free cell at the time; with no draft named, a free cell first.
 */
export function slotFor(model: GridModel, ref: SlotRef): OpenSlot | null {
  const open = openSlots(model, ref.day).filter((o) => o.start === ref.start && o.end === ref.end);
  if (ref.lesson != null) return open.find((o) => o.lessonId === ref.lesson) ?? open.find((o) => o.lessonId == null) ?? null;
  return open.find((o) => o.lessonId == null) ?? open[0] ?? null;
}
