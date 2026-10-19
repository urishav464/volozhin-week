// The parity driver for src/data/engine.ts.
import { CommandError } from "../../src/data/commands";
import { Engine, type PoolShared } from "../../src/data/engine";
import type { NewSpeaker, SpeakerPatch } from "../../src/data/speakers";
import type { DayPart } from "../../src/domain/dayParts";
import { TEMPLATE_2026 } from "../../src/domain/template2026";
import type { Day } from "../../src/domain/time";
import type { ApproachStatus, DutyPhrase, PrintWhen, SourcesKind, Transport, Vetting, Week } from "../../src/domain/types";
import {
  APPROACHES, type At, AVAILABILITY, CATEGORIES, CONTACTS, contactsLine, contactsRead, type Driver, EDITION, editionLines, FOREIGN_ROOM, FOREIGN_TRAINEE,
  lessonKey, lessonLine, matchesRead, MEMBERS, type Normal, poolLine, ROOMS, ROSTER, SPEAKERS, speakerLabel, type Step, transportLine, transportRead,
} from "./fixture";

export function engineDriver(): Driver {
  const memberId = (key: string) => MEMBERS.findIndex((m) => m.key === key) + 1;
  let week: Week = {
    edition: { id: 1, label: EDITION.label, kind: "real", start_date: null, first_day_from: EDITION.first_day_from, last_day_until: EDITION.last_day_until, status: "planning", settings: {} },
    rows: TEMPLATE_2026,
    rooms: ROOMS.map((r, i) => ({ id: i + 1, ...r })),
    categories: CATEGORIES.map((name, i) => ({ id: i + 1, name, color: "#000", sort: i + 1, active: true })),
    speakers: SPEAKERS.map((s, i) => ({
      id: i + 1, title: null, name: s.name, disambiguator: null, gender: s.gender, affiliation: null, bio_short: null, topics: [], contact_pref: null,
      vetted: s.vetted ?? "approved", vetted_by: null, vetted_note: null, retired: !!s.retired, name_key: s.name, version: 1,
    })),
    approaches: [],
    availability: [],
    lessons: [],
    lessonSpeakers: [],
    pitches: [],
    team: MEMBERS.map((m, i) => ({ id: i + 1, display_name: m.name, gender: null, role: m.role })),
    roster: ROSTER.map((r, i) => ({ id: i + 1, full_name: r.name, gender: r.gender })),
  };
  const speakerId = (label: string) => week.speakers.find((s) => speakerLabel(s) === label)?.id ?? -1;
  for (const [i, a] of APPROACHES.entries()) {
    week.approaches.push({ id: i + 1, speaker_id: speakerId(a.speaker), owner_member_id: memberId(a.owner), status: a.status, avail_note: null, offered_to: null, version: 1 });
  }
  for (const [i, v] of AVAILABILITY.entries()) {
    const a = week.approaches.find((x) => x.speaker_id === speakerId(v.speaker))!;
    week.availability.push({ id: i + 1, approach_id: a.id, day: v.day as Day, from_min: v.from, to_min: v.to, kind: v.kind, note: v.note });
  }
  const shared: PoolShared = { contacts: Object.fromEntries(Object.entries(CONTACTS).map(([label, c]) => [speakerId(label), { ...c }])), log: [], transport: {} };

  const roomId = (name?: string) => (name === FOREIGN_ROOM ? 999 : name ? week.rooms.find((r) => r.name === name)!.id : week.rooms.find((r) => r.is_default)!.id);
  const lessonAt = ([day, start, room]: At) =>
    week.lessons.find((l) => l.day === day && l.start_min === start && l.room_id === roomId(room) && l.state !== "cancelled");
  const pitchOf = (speaker: string, at: At) => {
    const l = lessonAt(at);
    const a = week.approaches.find((x) => x.speaker_id === speakerId(speaker));
    return l && a ? week.pitches.find((p) => p.lesson_id === l.id && p.approach_id === a.id) : undefined;
  };
  const approachOf = (label: string) => week.approaches.find((a) => a.speaker_id === speakerId(label));
  const traineeId = (name: string | null) => (name == null ? null : name === FOREIGN_TRAINEE ? 999 : (week.roster.find((r) => r.full_name === name)?.id ?? -1));
  /** A lesson by place, and its version less `staleBy`. */
  const at = (place: At, staleBy = 0) => {
    const l = lessonAt(place);
    return { id: l?.id ?? -1, version: (l?.version ?? 0) - staleBy };
  };

  return {
    async run(step: Step): Promise<string> {
      if ("archive" in step) {
        week.edition.status = "archived";
        return "ok";
      }
      if ("sandbox" in step) {
        week.edition.kind = "practice";
        return "ok";
      }
      const m = MEMBERS.find((x) => x.key === step.as)!;
      const e = new Engine(week, { memberId: memberId(m.key), role: m.role, global: !!m.global }, undefined, shared);
      try {
        if ("propose" in step) {
          const target = "cell" in step
            ? { day: step.cell[0] as Day, start_min: step.cell[1], end_min: step.cell[2], room_id: step.cell[3] ? roomId(step.cell[3]) : null }
            : { lesson_id: lessonAt(step.at)?.id ?? -1 };
          e.propose(speakerId(step.propose), target, step.mode);
        } else if ("unpropose" in step) e.unpropose(pitchOf(step.unpropose, step.at)?.id ?? -1);
        else if ("setPitch" in step) e.setPitch(pitchOf(step.setPitch, step.at)?.id ?? -1, step.state);
        else if ("close" in step) e.closeLesson(pitchOf(step.close, step.at)?.id ?? -1);
        else if ("reopen" in step) e.reopenLesson(lessonAt(step.reopen)?.id ?? -1);
        else if ("move" in step) {
          const [day, start, end, room] = step.to;
          e.moveLesson(lessonAt(step.move)?.id ?? -1, { day: day as Day, start_min: start, end_min: end, room_id: roomId(room) });
        } else if ("reshape" in step) e.reshape(step.reshape[0] as Day, step.reshape[1], step.op);
        else if ("update" in step) {
          const l = lessonAt(step.update);
          const patch: Record<string, unknown> = { ...step.patch };
          if ("category" in patch) {
            patch.category_id = patch.category == null ? null : week.categories.find((c) => c.name === patch.category)!.id;
            delete patch.category;
          }
          e.updateLesson(l?.id ?? -1, (l?.version ?? 0) - (step.staleBy ?? 0), patch);
        }
        // ---- the pool
        else if ("matches" in step) return matchesRead(e.matches(step.matches));
        else if ("readContacts" in step) return contactsRead(e.contactsOf(speakerId(step.readContacts)));
        else if ("create" in step) e.createSpeaker(step.create as NewSpeaker, step.opts);
        else if ("updateSpeaker" in step) {
          const s = week.speakers.find((x) => x.id === speakerId(step.updateSpeaker));
          e.updateSpeaker(s?.id ?? -1, (s?.version ?? 0) - (step.staleBy ?? 0), step.patch as SpeakerPatch);
        } else if ("vet" in step) e.vetSpeakers(step.vet.map(speakerId), step.state as Vetting, step.note ?? null);
        else if ("setContacts" in step) {
          e.setContacts(speakerId(step.setContacts), { phone: step.phone ?? null, email: step.email ?? null, secretary_note: step.secretary_note ?? null, notes: step.notes ?? null });
        } else if ("claim" in step) e.claim(speakerId(step.claim));
        else if ("setStatus" in step) {
          const a = approachOf(step.setStatus);
          e.setApproachStatus(a?.id ?? -1, (a?.version ?? 0) - (step.staleBy ?? 0), step.status as ApproachStatus, step.note ?? null);
        } else if ("handOver" in step) e.handOver(approachOf(step.handOver)?.id ?? -1, step.to == null ? null : memberId(step.to), step.note ?? null);
        else if ("answerHandOver" in step) e.answerHandOver(approachOf(step.answerHandOver)?.id ?? -1, step.accept, step.note ?? null);
        else if ("avail" in step) e.setAvailability(speakerId(step.avail), step.day, step.part as DayPart, step.kind as "can" | "cannot" | null, step.note ?? null);
        // ---- from placement to arrival
        else if ("pay" in step) {
          const l = at(step.pay, step.staleBy);
          e.setPayment(l.id, l.version, step.amount, step.transport as Transport);
        } else if ("decide" in step) {
          e.decidePayments(step.decide.map((p) => at(p, step.staleBy)).map((l) => ({ lesson_id: l.id, version: l.version })), step.decision as "approved", step.note ?? null);
        } else if ("sent" in step) {
          const l = at(step.sent, step.staleBy);
          e.markConfirmSent(l.id, l.version);
        } else if ("escort" in step) {
          const l = at(step.escort, step.staleBy);
          e.setEscort(l.id, l.version, { roster_id: traineeId(step.trainee), self_intro: step.selfIntro as boolean, escort_note: step.note ?? null });
        } else if ("sources" in step) {
          const l = at(step.sources, step.staleBy);
          e.setSources(l.id, l.version, {
            sources_kind: step.kind as SourcesKind, print_when: step.print as PrintWhen, sources_note: step.note ?? null, presentation_url: step.url ?? null, in_reader: step.inReader as boolean,
          });
        } else if ("paid" in step) e.setPaid(at(step.paid).id, step.value as boolean);
        else if ("readTransport" in step) return transportRead(e.transportOf(at(step.readTransport).id));
        else if ("setTransport" in step) {
          e.setTransport(at(step.setTransport).id, {
            pickup_address: step.address ?? null, pickup_time: step.time ?? null, driver_name: step.driver ?? null, driver_phone: step.phone ?? null, arranged: step.arranged ?? false,
          });
        } else if ("template" in step) e.setConfirmTemplate(step.template);
        else if ("duty" in step) e.setDutyPhrases(step.duty as DutyPhrase[]);
        return "ok";
      } catch (err) {
        if (err instanceof CommandError) return err.code;
        throw err;
      } finally {
        week = e.week;
      }
    },

    async state(): Promise<Normal> {
      const room = (id: number) => week.rooms.find((r) => r.id === id)!.name;
      const key = (id: number) => {
        const l = week.lessons.find((x) => x.id === id)!;
        return lessonKey({ ...l, room: room(l.room_id) });
      };
      const sp = (id: number) => speakerLabel(week.speakers.find((s) => s.id === id)!);
      const member = (id: number | null) => (id == null ? "-" : MEMBERS[id - 1].key);
      const cat = (id: number | null) => (id == null ? "-" : week.categories.find((c) => c.id === id)!.name);
      const approachSpeaker = (id: number) => sp(week.approaches.find((a) => a.id === id)!.speaker_id);
      const trainee = (id: number | null) => (id == null ? "-" : (week.roster.find((r) => r.id === id)?.full_name ?? `#${id}`));
      const memberOf = (id: unknown) => member(id == null ? null : Number(id));
      return {
        lessons: week.lessons
          .filter((l) => l.state !== "cancelled")
          .map((l) => lessonLine(key(l.id), l, cat(l.category_id), memberOf, trainee(l.escort_roster_id)))
          .sort(),
        pitches: week.pitches.map((p) => `${key(p.lesson_id)}|${approachSpeaker(p.approach_id)}|${p.state}|by=${member(p.proposed_by)}`).sort(),
        approaches: week.approaches.map((a) => `${sp(a.speaker_id)}|owner=${member(a.owner_member_id)}|${a.status}|offer=${member(a.offered_to)}|v=${a.version}`).sort(),
        speakers: week.lessonSpeakers.map((x) => `${key(x.lesson_id)}|${sp(x.speaker_id)}|${x.role}`).sort(),
        pool: week.speakers.map((s) => poolLine(s, member(s.vetted_by))).sort(),
        contacts: Object.entries(shared.contacts).map(([id, c]) => contactsLine(sp(Number(id)), c)).sort(),
        availability: week.availability.map((v) => `${approachSpeaker(v.approach_id)}|${v.day}|${v.from_min}-${v.to_min}|${v.kind}|${v.note ?? "-"}`).sort(),
        transport: Object.entries(shared.transport).map(([k, t]) => transportLine(key(Number(k.split(":")[1])), t)).sort(),
        edition: editionLines(week.edition.settings),
      };
    },

    async close() {},
  };
}
