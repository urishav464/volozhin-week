// The parity driver for src/data/engine.ts.
import { CommandError } from "../../src/data/commands";
import { emptyShared, Engine, type ImportHost, type PoolShared } from "../../src/data/engine";
import { ImportRowError } from "../../src/data/imports";
import { ARCHIVE_ROOM, labelKey } from "../../src/data/importRules";
import { titlesOf } from "../../src/data/speakerRules";
import type { NewSpeaker, SpeakerPatch } from "../../src/data/speakers";
import type { DayPart } from "../../src/domain/dayParts";
import { TEMPLATE_2026 } from "../../src/domain/template2026";
import type { Day } from "../../src/domain/time";
import type { ApproachStatus, DutyPhrase, PrintWhen, SourcesKind, Transport, Vetting, Week } from "../../src/domain/types";
import type { KkGroupFields } from "../../src/data/kk";
import { linkClient, type LinkScope } from "../../src/data/links";
import {
  answers, APPROACHES, type At, AVAILABILITY, CATEGORIES, CONTACTS, contactsLine, contactsRead, type Driver, EDITION, editionLines, fallenContactsLine, fallenLine, fileLine, filePath,
  archiveLessonLine, archivePayloadOf, FOREIGN_EDITION, FOREIGN_ROOM, FOREIGN_TRAINEE, importRead, lookupRead, planLine, purgeRead, reviewLine, speakerRows,
  type KkStepFields, lessonKey, lessonLine, linkLine, matchesRead, MEMBERS, NO_SUCH_TOKEN, type Normal, poolLine, publicRead, ROOMS, ROSTER, SPEAKERS, speakerLabel,
  prefsRow, type Step, transportLine, transportRead,
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
    escortTicks: [],
    sourceFiles: [],
    memorialPlans: [],
    fallen: [],
  };
  const speakerId = (label: string) => week.speakers.find((s) => speakerLabel(s) === label)?.id ?? -1;
  for (const [i, a] of APPROACHES.entries()) {
    week.approaches.push({ id: i + 1, speaker_id: speakerId(a.speaker), owner_member_id: memberId(a.owner), status: a.status, avail_note: null, offered_to: null, version: 1 });
  }
  for (const [i, v] of AVAILABILITY.entries()) {
    const a = week.approaches.find((x) => x.speaker_id === speakerId(v.speaker))!;
    week.availability.push({ id: i + 1, approach_id: a.id, day: v.day as Day, from_min: v.from, to_min: v.to, kind: v.kind, note: v.note });
  }
  const shared: PoolShared = { ...emptyShared(), contacts: Object.fromEntries(Object.entries(CONTACTS).map(([label, c]) => [speakerId(label), { ...c }])) };

  const roomId = (name?: string) => (name === FOREIGN_ROOM ? 999 : name ? week.rooms.find((r) => r.name === name)!.id : week.rooms.find((r) => r.is_default)!.id);
  const lessonAt = ([day, start, room]: At) =>
    week.lessons.find((l) => l.day === day && l.start_min === start && l.room_id === roomId(room) && l.state !== "cancelled");
  const pitchOf = (speaker: string, at: At) => {
    const l = lessonAt(at);
    const a = week.approaches.find((x) => x.speaker_id === speakerId(speaker));
    return l && a ? week.pitches.find((p) => p.lesson_id === l.id && p.approach_id === a.id) : undefined;
  };
  const approachOf = (label: string) => week.approaches.find((a) => a.speaker_id === speakerId(label));
  const spLabel = (id: number) => speakerLabel(week.speakers.find((s) => s.id === id)!);
  const memberKey = (id: number | null) => (id == null ? "-" : MEMBERS[id - 1].key);
  const fallenId = (name: string) => shared.fallen.find((f) => f.name === name)?.id ?? -1;
  const planOf = (name: string) => week.memorialPlans.find((p) => p.fallen_id === fallenId(name));
  const traineeId = (name: string | null) => (name == null ? null : name === FOREIGN_TRAINEE ? 999 : (week.roster.find((r) => r.full_name === name)?.id ?? -1));
  /** A lesson by place, and its version less `staleBy`. */
  const at = (place: At, staleBy = 0) => {
    const l = lessonAt(place);
    return { id: l?.id ?? -1, version: (l?.version ?? 0) - staleBy };
  };

  // ---- the sources' files: each label's stored path, and the target it was stored for
  const files: Record<string, { path: string; target: At | "cover" }> = {};
  const targetId = (t: At | "cover") => (t === "cover" ? null : (lessonAt(t)?.id ?? -1));
  const pathOf = (label: string, target?: At | "cover") => files[label]?.path ?? filePath(week.edition.id, targetId(target ?? "cover"), label, "application/pdf");

  // ---- the import of 5786: the archive editions it makes, and what the engine needs from outside it
  const archives: Week[] = [];
  const host: ImportHost = {
    titles: (id) => titlesOf(id === week.edition.id ? week.edition.settings : null),
    byLabel: (key) => {
      if (key === labelKey(week.edition.label)) return [{ kind: week.edition.kind, week: null }];
      if (key === labelKey(FOREIGN_EDITION)) return [{ kind: "practice", week: null }];
      return archives.filter((x) => labelKey(x.edition.label) === key).map((a) => ({ kind: "archive" as const, week: a }));
    },
    categoryIds: () => new Set(week.categories.map((c) => c.id)),
    nextEditionId: () => 100 + archives.length,
    nextRoomId: () => 1000 + archives.reduce((n, a) => n + a.rooms.length, 0),
    install: (w) => {
      const i = archives.findIndex((x) => x.edition.id === w.edition.id);
      if (i >= 0) archives[i] = w;
      else archives.push(w);
    },
  };
  const speakerName = (id: number) => {
    const s = week.speakers.find((x) => x.id === id);
    return s ? speakerLabel(s) : `#${id}`;
  };
  const categoryId = (name: string) => week.categories.find((c) => c.name === name)?.id ?? -1;

  // ---- links and מכריכה לכריכה
  const tokens: Record<string, string> = {};
  const tokenOf = (name: string) => tokens[name] ?? NO_SUCH_TOKEN;
  const groupId = (title: string) => shared.kk.groups.find((g) => g.title === title)?.id ?? -1;
  const trackId = ([day, start]: [number, number]) => shared.kk.tracks.find((t) => t.day === day && t.start_min === start)?.id ?? -1;
  const kkFields = (f: KkStepFields): KkGroupFields => {
    const out: Record<string, unknown> = { ...f };
    if ("room" in out) {
      out.room_id = roomId(out.room as string);
      delete out.room;
    }
    if (Array.isArray(out.leaders)) {
      out.leaders = (out.leaders as Record<string, unknown>[]).map((x) => ("trainee" in x ? { kind: x.kind, roster_id: traineeId(x.trainee as string) } : x));
    }
    return out as KkGroupFields;
  };
  const names = {
    lesson: (id: number) => {
      const l = week.lessons.find((x) => x.id === id);
      return l ? lessonKey({ ...l, room: week.rooms.find((r) => r.id === l.room_id)!.name }) : `#${id}`;
    },
    track: (id: number) => {
      const t = shared.kk.tracks.find((x) => x.id === id);
      return t ? `${t.day}|${t.start_min}` : `#${id}`;
    },
    group: (id: number) => shared.kk.groups.find((x) => x.id === id)?.title ?? `#${id}`,
    trainee: (id: number) => week.roster.find((r) => r.id === id)?.full_name ?? `#${id}`,
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
      if ("startDate" in step) {
        // as a hand edit of editions.start_date: app.editions_reconfirm, then app.editions_link_expiry
        const before = week.edition.start_date;
        week.edition.start_date = step.startDate;
        if (before != null && step.startDate !== before) {
          for (const l of week.lessons) if (l.state === "closed" && l.confirm_sent_at != null && !l.needs_reconfirm) Object.assign(l, { needs_reconfirm: true, version: l.version + 1 });
        }
        new Engine(week, { memberId: 1, role: "admin", global: true }, undefined, shared).refreshLinkExpiry();
        return "ok";
      }
      if ("firstDayFrom" in step) {
        week.edition.first_day_from = step.firstDayFrom;
        return "ok";
      }
      if ("expire" in step) {
        const l = shared.links.find((x) => x.token === tokenOf(step.expire));
        if (l) l.expires_at = new Date(Date.now() - 60_000).toISOString();
        return "ok";
      }
      if ("rateHits" in step) {
        const l = shared.links.find((x) => x.token === tokenOf(step.rateHits));
        if (l) shared.linkHits[`${l.token} ${linkClient(l.scope, step.from)}`] = { window_start: new Date().toISOString(), hits: step.hits };
        return "ok";
      }
      if ("rateWindowPassed" in step) {
        for (const [k, h] of Object.entries(shared.linkHits)) {
          if (k.startsWith(`${tokenOf(step.rateWindowPassed)} `)) h.window_start = new Date(Date.parse(h.window_start) - 11 * 60_000).toISOString();
        }
        return "ok";
      }
      if ("anon" in step) {
        const e = new Engine(week, { memberId: 0, role: "content", address: "from" in step ? step.from : undefined }, undefined, shared);
        try {
          const t = tokenOf(step.token);
          switch (step.anon) {
            case "escortView":
            case "kkForm":
            case "scheduleView":
              return answers(Array.from({ length: ("times" in step ? step.times : undefined) ?? 1 }, () => {
                try {
                  return publicRead(step.anon, step.anon === "escortView" ? e.escortView(t) : step.anon === "kkForm" ? e.kkForm(t) : e.scheduleView(t), names);
                } catch (err) {
                  if (err instanceof CommandError) return err.code;
                  throw err;
                }
              }));
            case "escortTick":
              return publicRead("escortTick", e.escortTick(t, at(step.at).id, step.item as never, step.on as boolean), names);
            case "escortPickup":
              e.escortPickup(t, at(step.at).id, step.address as string);
              return "ok";
            case "kkSignup":
              e.kkSignup(t, traineeId(step.trainee) ?? -1, groupId(step.group));
              return "received";
          }
        } catch (err) {
          if (err instanceof CommandError) return err.code;
          throw err;
        } finally {
          week = e.week;
        }
      }
      const m = MEMBERS.find((x) => x.key === step.as)!;
      const actor = { memberId: memberId(m.key), role: m.role, global: !!m.global };
      // the other editions are the import's archives: across the years (returning speakers, reviews) as the database sees them
      const e = new Engine(week, actor, undefined, shared, () => archives);
      /** An engine on the archive edition of that label (the steps that name one are a global admin's). */
      const onArchive = (label: string) => {
        const w = archives.find((x) => x.edition.label === label);
        if (!w) throw new Error(`no archive edition «${label}»`);
        return new Engine(w, actor, undefined, shared, () => [week, ...archives.filter((x) => x !== w)]);
      };
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
        // ---- the import of 5786
        else if ("importCandidates" in step) {
          const payload = { source: step.source === undefined ? "brainstorm-5786" : step.source, titles_from: null, rows: speakerRows(step.importCandidates, speakerId) };
          return importRead(e.importCommit("candidates", payload, host), speakerName);
        } else if ("importArchive" in step) {
          return importRead(e.importCommit("tracking", archivePayloadOf(step.importArchive, speakerId, categoryId), host), speakerName);
        } else if ("importPrefs" in step) {
          const rows = step.importPrefs.map((r) => prefsRow(r, speakerId(r.speaker)));
          return importRead(e.importCommit("escorts", { rows }, host), speakerName);
        } else if ("importLookup" in step) return lookupRead(e.importLookup(step.importLookup.speakers.map(speakerId), step.importLookup.phones), speakerName);
        else if ("importRaw" in step) return importRead(e.importCommit(step.importRaw.kind, step.importRaw.payload, host), speakerName);
        else if ("importNote" in step) {
          const on = onArchive(step.edition);
          const [day, start] = step.importNote;
          const l = on.week.lessons.find((x) => x.day === day && x.start_min === start && on.week.rooms.find((r) => r.id === x.room_id)?.name === ARCHIVE_ROOM);
          return `note=${on.importNoteOf(l?.id ?? -1) ?? "-"}`;
        }
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
        // ---- links and מכריכה לכריכה
        else if ("issue" in step) tokens[step.name] = e.issueLink(step.issue as LinkScope, traineeId(step.trainee ?? null)).token;
        else if ("revoke" in step) e.revokeLink(shared.links.find((x) => x.token === tokenOf(step.revoke))?.id ?? -1);
        else if ("kkAdd" in step) e.kkAddGroup(step.kkAdd[0], step.kkAdd[1], kkFields(step.fields));
        else if ("kkUpdate" in step) e.kkUpdateGroup(groupId(step.kkUpdate), kkFields(step.patch));
        else if ("kkDelete" in step) e.kkDeleteGroup(groupId(step.kkDelete));
        else if ("kkPlace" in step) e.kkPlace(groupId(step.kkPlace), traineeId(step.trainee) ?? -1);
        else if ("kkUnplace" in step) e.kkUnplace(trackId(step.kkUnplace), traineeId(step.trainee) ?? -1);
        else if ("kkWindow" in step) e.kkSetWindow(step.kkWindow[0], step.kkWindow[1]);
        else if ("bookOrder" in step) e.setBookOrder(groupId(step.bookOrder), step.copies, step.ordered as boolean);
        // ---- the sources' files
        else if ("store" in step) {
          const mime = step.mime ?? "application/pdf";
          const path = filePath(week.edition.id, targetId(step.store), step.file, mime);
          e.storeObject(path, mime, step.size ?? 1000);
          files[step.file] = { path, target: step.store };
        } else if ("register" in step) {
          const f = files[step.register];
          const target = step.for ?? f?.target ?? "cover";
          e.registerSourceFile(targetId(target), pathOf(step.register, target), step.display ?? `${step.register}.pdf`, step.pages === undefined ? 1 : step.pages);
        } else if ("unstore" in step) return e.deleteObject(pathOf(step.unstore)) ? "deleted" : "kept";
        else if ("unregister" in step) e.removeSourceFile(week.sourceFiles.find((f) => f.storage_path === pathOf(step.unregister))?.id ?? -1);
        else if ("readerHeaders" in step) e.setReaderHeaders(step.readerHeaders[0], step.readerHeaders[1]);
        else if ("readerCover" in step) e.setReaderCover(step.readerCover == null ? null : (week.sourceFiles.find((f) => f.storage_path === pathOf(step.readerCover!))?.id ?? -1));
        // ---- memorial times and logistics
        else if ("saveFallen" in step) {
          const id = step.saveFallen == null ? null : fallenId(step.saveFallen);
          e.saveFallen(id, { name: step.name, gender: (step.gender ?? null) as never, note: step.note ?? null, active: step.active === undefined ? true : (step.active as boolean) });
        } else if ("deleteFallen" in step) e.deleteFallen(fallenId(step.deleteFallen));
        else if ("readFallen" in step) return e.fallenList().map((f) => f.name).sort().join(",") || "none";
        else if ("readFallenContacts" in step) {
          const c = e.fallenContactsOf(fallenId(step.readFallenContacts));
          return c == null ? "hidden" : fallenContactsLine("seen", c);
        } else if ("setFallenContacts" in step) {
          e.setFallenContacts(fallenId(step.setFallenContacts), {
            contact_name: step.contact ?? null, relation: step.relation ?? null, phone: step.phone ?? null, email: step.email ?? null, note: step.note ?? null,
          });
        } else if ("addSlot" in step) {
          const [day, start, end, room] = step.addSlot;
          e.addMemorialSlot(day as Day, start, end, room ? roomId(room) : null);
        } else if ("removeSlot" in step) e.removeMemorialSlot(lessonAt(step.removeSlot)?.id ?? -1);
        else if ("addPlan" in step) e.addMemorialPlan(fallenId(step.addPlan));
        else if ("updatePlan" in step) {
          const p = planOf(step.updatePlan);
          e.updateMemorialPlan(p?.id ?? -1, (p?.version ?? 0) - (step.staleBy ?? 0), step.patch);
        } else if ("placePlan" in step) {
          const p = planOf(step.placePlan);
          e.placeMemorialPlan(p?.id ?? -1, (p?.version ?? 0) - (step.staleBy ?? 0), step.at == null ? null : (lessonAt(step.at)?.id ?? -1));
        } else if ("deletePlan" in step) e.deleteMemorialPlan(planOf(step.deletePlan)?.id ?? -1);
        else if ("policy" in step) {
          const p = step.policy;
          e.setMemorialPolicy({ placement: p.placement ?? undefined, max_minutes: p.max_minutes ?? undefined, warn_adjacent_meal: p.warn_adjacent_meal ?? undefined });
        } else if ("gridRules" in step) e.setGridRules(step.gridRules); else if ("readTransports" in step) return e.transportsOf().map((t) => transportLine(names.lesson(t.lesson_id), t)).sort().join(" ; ") || "none";
        // ---- after the week
        else if ("review" in step) {
          const on = step.edition == null ? e : onArchive(step.edition);
          const [day, start, room] = step.review;
          const l = step.edition == null ? lessonAt(step.review) : on.week.lessons.find((x) => x.day === day && x.start_min === start && on.week.rooms.find((r) => r.id === x.room_id)?.name === (room ?? ARCHIVE_ROOM));
          const old = shared.reviews.find((r) => r.edition_id === on.week.edition.id && r.lesson_id === l?.id);
          const f = step.fields;
          const v = on.saveReview(l?.id ?? -1, (old?.version ?? 0) - (step.staleBy ?? 0), {
            went_well: f.went_well ?? null, issues: f.issues ?? null, invite_again: (f.invite_again ?? null) as never, overran: f.overran as boolean, rating: f.rating ?? null,
          });
          return `v=${v}`;
        } else if ("readReviews" in step) {
          return e.reviewsOf().map((r) => reviewLine(names.lesson(r.lesson_id), { ...r, speaker: r.speaker_id == null ? "-" : spLabel(r.speaker_id), by: memberKey(r.written_by) })).sort().join(" ; ") || "none";
        } else if ("speakerReviews" in step) {
          // by the lesson's day and times as the answer gives them: a lesson id of another year means nothing here
          return e.speakerReviews(speakerId(step.speakerReviews)).map((r) => `${r.edition_label}|${r.day}|${r.start_min}-${r.end_min}|ia=${r.invite_again ?? "-"}|r=${r.rating ?? "-"}|ww=${r.went_well ?? "-"}`).join(" ; ") || "none";
        } else if ("returning" in step) {
          return e.returning().map((r) => `${spLabel(r.speaker_id)}:${r.editions.join(",")}`).join(" ; ") || "none";
        } else if ("purge" in step) return purgeRead((step.edition == null ? e : onArchive(step.edition)).purgePrivate(step.purge));
        return "ok";
      } catch (err) {
        if (err instanceof ImportRowError) return `${err.code}:${err.row}:${err.reason}`;
        if (err instanceof CommandError) return err.code;
        throw err;
      } finally {
        week = e.week;
      }
    },

    async state(): Promise<Normal> {
      const labelOf = (path: string) => Object.entries(files).find(([, f]) => f.path === path)?.[0] ?? path;
      const labelOfFile = (id: number | undefined) => (id == null ? "-" : labelOf(week.sourceFiles.find((f) => f.id === id)?.storage_path ?? `#${id}`));
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
      const fallenName = (id: number | null) => (id == null ? "-" : (shared.fallen.find((f) => f.id === id)?.name ?? `#${id}`));
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
        edition: editionLines(week.edition.settings, labelOfFile(week.edition.settings.reader_cover), week.edition.purged_at != null),
        links: shared.links
          .map((l) => linkLine({ scope: l.scope, trainee: trainee(l.subject_id), revoked: l.revoked_at != null, created_at: l.created_at, expires_at: l.expires_at, by: member(l.created_by) }))
          .sort(),
        kk: [
          ...shared.kk.tracks.map((t) => `track|${t.day}|${t.start_min}-${t.end_min}`),
          ...shared.kk.groups.map((g) => {
            const leaders = shared.kk.leaders
              .filter((x) => x.group_id === g.id)
              .sort((a, b) => a.sort - b.sort)
              .map((x) => `${x.kind}:${x.roster_id != null ? trainee(x.roster_id) : x.label}`)
              .join(",");
            const room = g.room_id == null ? "-" : week.rooms.find((r) => r.id === g.room_id)!.name;
            return `group|${names.track(g.track_id)}|${g.title}|a=${g.author ?? "-"}|room=${room}|cap=${g.capacity ?? "-"}|open=${g.open}|lead=${leaders || "-"}`;
          }),
          ...shared.kk.signups.map((x) => `signup|${names.track(x.track_id)}|${trainee(x.roster_id)}|${names.group(x.group_id)}|${x.via}`),
          ...shared.kk.orders.map((o) => `order|${names.group(o.group_id)}|${o.copies}|ord=${o.ordered_at == null ? "-" : "y"}`),
        ].sort(),
        ticks: week.escortTicks.map((t) => `${key(t.lesson_id)}|${t.item}`).sort(),
        files: week.sourceFiles
          .map((f) =>
            fileLine(f.lesson_id == null ? (f.cover ? "cover" : "nolesson") : key(f.lesson_id), f, f.speaker_id == null ? "-" : sp(f.speaker_id), member(f.uploaded_by), fallenName(f.fallen_id)),
          )
          .sort(),
        objects: Object.entries(shared.objects).map(([path, o]) => `${labelOf(path)}|${o.mime}|${o.size}|owner=${member(Number(o.owner.split(":")[1]))}`).sort(),
        memorial: [
          ...shared.fallen.map(fallenLine),
          ...Object.entries(shared.fallenContacts).map(([id, c]) => fallenContactsLine(`contacts|${fallenName(Number(id))}`, c)),
          ...week.memorialPlans.map((p) => planLine(fallenName(p.fallen_id), p.lesson_id == null ? "-" : key(p.lesson_id), p)),
        ].sort(),
        archive: archives
          .flatMap((a) => [
            `edition|${a.edition.label}|${a.edition.kind}|${a.edition.status}|${a.edition.start_date ?? "-"}|rows=${a.rows.length}|purged=${a.edition.purged_at == null ? "-" : "y"}`,
            ...a.rooms.map((r) => `room|${a.edition.label}|${r.name}|${r.sort}|${r.is_default}`),
            ...a.lessons.map((l) => {
              const who = a.lessonSpeakers.filter((x) => x.lesson_id === l.id).map((x) => `${speakerName(x.speaker_id)}:${x.role}`).sort().join(",");
              const note = shared.importNotes[`${a.edition.id}:${l.id}`] ?? null;
              return archiveLessonLine(a.edition.label, { ...l, import_note: note }, a.rooms.find((r) => r.id === l.room_id)!.name, cat(l.category_id), who);
            }),
            // «איך עבר» on an archive's lessons (a global admin's), by the lesson's place
            ...shared.reviews
              .filter((r) => r.edition_id === a.edition.id)
              .map((r) => {
                const l = a.lessons.find((x) => x.id === r.lesson_id);
                const where = l ? `${a.edition.label}|${l.day}|${l.start_min}-${l.end_min}|${a.rooms.find((x) => x.id === l.room_id)!.name}` : `${a.edition.label}|#${r.lesson_id}`;
                return reviewLine(where, { ...r, speaker: r.speaker_id == null ? "-" : sp(r.speaker_id), by: member(r.written_by) });
              }),
          ])
          .sort(),
        reviews: shared.reviews
          .filter((r) => r.edition_id === week.edition.id)
          .map((r) => reviewLine(key(r.lesson_id), { ...r, speaker: r.speaker_id == null ? "-" : sp(r.speaker_id), by: member(r.written_by) }))
          .sort(),
      };
    },

    async close() {},
  };
}
