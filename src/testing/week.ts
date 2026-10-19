// A tiny builder for unit tests: a Week on the 2026 grid with synthetic people.
import { TEMPLATE_2026 } from "../domain/template2026";
import type { Day } from "../domain/time";
import { type Approach, type Gender, LESSON_STAGE_DEFAULTS, type Lesson, type Pitch, type RosterMember, type Speaker, type Week } from "../domain/types";

export function emptyWeek(): Week {
  return {
    edition: { id: 1, label: "בדיקה", kind: "demo", start_date: "2027-02-14", first_day_from: 510, last_day_until: 1140, status: "planning", settings: {} },
    rows: TEMPLATE_2026,
    rooms: [
      { id: 1, name: "בית מדרש", sort: 1, is_default: true },
      { id: 2, name: "כיתה", sort: 2, is_default: false },
    ],
    categories: [
      { id: 1, name: "תנ\"ך", color: "#7a5c2e", sort: 1, active: true },
      { id: 2, name: "פילוסופיה", color: "#2e5c7a", sort: 2, active: true },
    ],
    speakers: [],
    approaches: [],
    availability: [],
    lessons: [],
    lessonSpeakers: [],
    pitches: [],
    team: [],
    roster: [],
  };
}

let seq = 1000;

export function addSpeaker(w: Week, gender: Gender | null, name = `מרצה ${seq}`): Speaker {
  const s: Speaker = {
    id: ++seq, title: null, name, disambiguator: null, gender, affiliation: null, bio_short: null, topics: [], contact_pref: null,
    vetted: "approved", vetted_by: null, vetted_note: null, retired: false, name_key: name, version: 1,
  };
  w.speakers.push(s);
  return s;
}

export function addApproach(w: Week, s: Speaker, status: Approach["status"] = "approached"): Approach {
  const a: Approach = { id: ++seq, speaker_id: s.id, owner_member_id: 1, status, avail_note: null, offered_to: null, version: 1 };
  w.approaches.push(a);
  return a;
}

export function addLesson(w: Week, day: Day, start: number, end: number, opts: Partial<Lesson> = {}): Lesson {
  const l: Lesson = {
    id: ++seq, kind: "lesson", state: "draft", day, start_min: start, end_min: end, room_id: 1,
    title: null, category_id: null, audience: null, teach_min: null, parallel_reason: null, ...LESSON_STAGE_DEFAULTS,
    version: 1, updated_by: null, ...opts,
  };
  w.lessons.push(l);
  return l;
}

/** A closed lesson taught by `speakers` (first is the lead). */
export function closeWith(w: Week, l: Lesson, ...speakers: Speaker[]): Lesson {
  l.state = "closed";
  speakers.forEach((s, i) => w.lessonSpeakers.push({ lesson_id: l.id, speaker_id: s.id, role: i === 0 ? "lead" : "co" }));
  return l;
}

export function pitch(w: Week, l: Lesson, a: Approach, state: Pitch["state"] = "approached"): Pitch {
  const p: Pitch = { id: ++seq, lesson_id: l.id, approach_id: a.id, state, proposed_by: 1, at: "2026-11-01T10:00:00Z" };
  w.pitches.push(p);
  return p;
}

/** A trainee of the roster (an escort). */
export function addTrainee(w: Week, full_name = `חניך/ה ${seq}`, gender: RosterMember["gender"] = null): RosterMember {
  const r: RosterMember = { id: ++seq, full_name, gender };
  w.roster.push(r);
  return r;
}
