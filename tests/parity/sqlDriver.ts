// The parity driver for supabase/schema.sql: a fresh PostgreSQL 16 database per
// scenario, every command called as the role a browser gets, with that
// member's Google claims — and committed, like PostgREST would.
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, google } from "../sql/db";
import {
  answers, APPROACHES, type At, AVAILABILITY, CONTACTS, contactsLine, contactsRead, type Driver, EDITION, editionLines, FOREIGN_ROOM, FOREIGN_TRAINEE, type KkStepFields,
  lessonKey, lessonLine, linkLine, matchesRead, MEMBERS, NO_SUCH_TOKEN, type Normal, poolLine, publicRead, ROOMS, ROSTER, SPEAKERS, speakerLabel, splitLabel,
  type Step, transportLine, transportRead,
} from "./fixture";

export async function sqlDriver(dbName: string): Promise<Driver> {
  const db: pg.Client = await freshDatabase(dbName, "new");
  await db.query(SCHEMA);

  const ed = Number((await db.query("insert into public.editions (label, first_day_from, last_day_until) values ($1, $2, $3) returning id", [EDITION.label, EDITION.first_day_from, EDITION.last_day_until])).rows[0].id);
  await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [ed]);
  for (const r of ROOMS) await db.query("insert into public.rooms (edition_id, name, sort, is_default) values ($1, $2, $3, $4)", [ed, r.name, r.sort, r.is_default]);
  const elsewhere = Number((await db.query("insert into public.editions (label, kind) values ('מחזור אחר', 'practice') returning id")).rows[0].id);
  const foreignRoom = Number((await db.query("insert into public.rooms (edition_id, name, is_default) values ($1, $2, true) returning id", [elsewhere, FOREIGN_ROOM])).rows[0].id);
  for (const r of ROSTER) await db.query("insert into public.roster (edition_id, full_name, gender) values ($1, $2, $3)", [ed, r.name, r.gender]);
  const foreignTrainee = Number((await db.query("insert into public.roster (edition_id, full_name) values ($1, $2) returning id", [elsewhere, FOREIGN_TRAINEE])).rows[0].id);
  for (const m of MEMBERS) {
    await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $2, $3, $4)", [m.email, m.name, m.role, m.global ? null : ed]);
  }
  for (const s of SPEAKERS) {
    await db.query("insert into public.speakers (name, gender, vetted, retired) values ($1, $2, $3, $4)", [s.name, s.gender, s.vetted ?? "approved", !!s.retired]);
  }
  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0];
  const memberId = (key: string) => MEMBERS.findIndex((m) => m.key === key) + 1; // inserted in this order: ids 1…
  const speakerId = async (label: string) => {
    const [name, dis] = splitLabel(label);
    const r = await one("select id from public.speakers where name = $1 and coalesce(disambiguator, '') = $2", [name, dis ?? ""]);
    return r ? Number(r.id) : -1;
  };
  for (const [label, c] of Object.entries(CONTACTS)) {
    await db.query("insert into public.speaker_contacts (speaker_id, phone, email, secretary_note, notes) values ($1, $2, $3, $4, $5)", [await speakerId(label), c.phone, c.email, c.secretary_note, c.notes]);
  }
  for (const a of APPROACHES) {
    await db.query("insert into public.approaches (edition_id, speaker_id, owner_member_id, status) values ($1, $2, $3, $4)", [ed, await speakerId(a.speaker), memberId(a.owner), a.status]);
  }
  for (const v of AVAILABILITY) {
    await db.query(
      "insert into public.availability (approach_id, day, from_min, to_min, kind, note) select a.id, $3, $4, $5, $6, $7 from public.approaches a where a.edition_id = $1 and a.speaker_id = $2",
      [ed, await speakerId(v.speaker), v.day, v.from, v.to, v.kind, v.note],
    );
  }

  const roomId = async (name?: string) =>
    name === FOREIGN_ROOM ? foreignRoom : Number((await one(name ? "select id from public.rooms where edition_id = $1 and name = $2" : "select id from public.rooms where edition_id = $1 and is_default", name ? [ed, name] : [ed])).id);
  const lessonAt = async ([day, start, room]: At) =>
    one("select id, version from public.lessons where edition_id = $1 and day = $2 and start_min = $3 and room_id = $4 and state <> 'cancelled'", [ed, day, start, await roomId(room)]);
  const pitchOf = async (speaker: string, at: At) => {
    const l = await lessonAt(at);
    if (!l) return -1;
    const p = await one("select p.id from public.pitches p join public.approaches a on a.id = p.approach_id where p.lesson_id = $1 and a.speaker_id = $2", [l.id, await speakerId(speaker)]);
    return p ? Number(p.id) : -1;
  };
  const approachOf = async (label: string) => one("select id, version from public.approaches where edition_id = $1 and speaker_id = $2", [ed, await speakerId(label)]);
  const traineeId = async (name: string | null) =>
    name == null ? null : name === FOREIGN_TRAINEE ? foreignTrainee : Number((await one("select id from public.roster where edition_id = $1 and full_name = $2", [ed, name]))?.id ?? -1);
  /** A lesson by place, and its version less `staleBy`. */
  const at = async (place: At, staleBy = 0) => {
    const l = await lessonAt(place);
    return { id: l ? Number(l.id) : -1, version: (l?.version ?? 0) - staleBy };
  };

  /** One RPC, as a member, committed — or rolled back with the contract's code. `read` turns its first column into the result. */
  async function call(actor: string, sql: string, params: unknown[], read?: (v: unknown) => string): Promise<string> {
    const m = MEMBERS.find((x) => x.key === actor)!;
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(m.email))]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return read ? read(Object.values(r.rows[0])[0]) : "ok";
    } catch (e) {
      await db.query("rollback");
      const err = e as { code?: string; message: string };
      return err.code === "P0001" ? err.message : `raw:${err.code}:${err.message}`;
    }
  }

  // ---- links and מכריכה לכריכה
  const tokens: Record<string, string> = {};
  const tokenOf = (name: string) => tokens[name] ?? NO_SUCH_TOKEN;
  const groupId = async (title: string) => Number((await one("select id from public.kk_groups where edition_id = $1 and title = $2", [ed, title]))?.id ?? -1);
  const trackId = async ([day, start]: [number, number]) =>
    Number((await one("select id from public.kk_tracks where edition_id = $1 and day = $2 and start_min = $3", [ed, day, start]))?.id ?? -1);
  const kkFields = async (f: KkStepFields) => {
    const out: Record<string, unknown> = { ...f };
    if ("room" in out) {
      out.room_id = await roomId(out.room as string);
      delete out.room;
    }
    if (Array.isArray(out.leaders)) {
      const list: unknown[] = [];
      for (const x of out.leaders as Record<string, unknown>[]) list.push("trainee" in x ? { kind: x.kind, roster_id: await traineeId(x.trainee as string) } : x);
      out.leaders = list;
    }
    return JSON.stringify(out);
  };
  /** Ids → the names the comparison uses, read fresh after a call. */
  const nameMaps = async () => {
    const ls = (await db.query("select l.id, l.day, l.start_min, l.end_min, r.name as room from public.lessons l join public.rooms r on r.id = l.room_id where l.edition_id = $1", [ed])).rows;
    const ts = (await db.query("select id, day, start_min from public.kk_tracks")).rows;
    const gs = (await db.query("select id, title from public.kk_groups")).rows;
    const rs = (await db.query("select id, full_name from public.roster")).rows;
    const map = (rows: Record<string, unknown>[], f: (r: Record<string, unknown>) => string) => new Map(rows.map((r) => [Number(r.id), f(r)]));
    const [lm, tm, gm, rm] = [map(ls, (r) => lessonKey(r as never)), map(ts, (r) => `${r.day}|${r.start_min}`), map(gs, (r) => String(r.title)), map(rs, (r) => String(r.full_name))];
    return {
      lesson: (id: number) => lm.get(id) ?? `#${id}`,
      track: (id: number) => tm.get(id) ?? `#${id}`,
      group: (id: number) => gm.get(id) ?? `#${id}`,
      trainee: (id: number) => rm.get(id) ?? `#${id}`,
    };
  };
  /** One anon function — the publishable key, nobody signed in — committed, or rolled back with its code. */
  async function anon(sql: string, params: unknown[], from?: string): Promise<{ ok: true; v: unknown } | { ok: false; code: string }> {
    await db.query("begin");
    try {
      await db.query("set local role anon");
      await db.query("select set_config('request.jwt.claims', '', true)");
      // as PostgREST passes the request's headers; the caller's address keys a class link's rate limit
      await db.query("select set_config('request.headers', $1, true)", [from == null ? "{}" : JSON.stringify({ "x-forwarded-for": `${from}, 192.0.2.1` })]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return { ok: true, v: Object.values(r.rows[0])[0] };
    } catch (e) {
      await db.query("rollback");
      const err = e as { code?: string; message: string };
      return { ok: false, code: err.code === "P0001" ? err.message : `raw:${err.code}:${err.message}` };
    }
  }

  return {
    async run(step: Step): Promise<string> {
      if ("startDate" in step) {
        await db.query("update public.editions set start_date = $2 where id = $1", [ed, step.startDate]);
        return "ok";
      }
      if ("firstDayFrom" in step) {
        await db.query("update public.editions set first_day_from = $2 where id = $1", [ed, step.firstDayFrom]);
        return "ok";
      }
      if ("expire" in step) {
        await db.query("update public.share_links set expires_at = now() - interval '1 minute' where token_hash = extensions.digest($1, 'sha256')", [tokenOf(step.expire)]);
        return "ok";
      }
      if ("rateHits" in step) {
        const l = await one("select scope from public.share_links where token_hash = extensions.digest($1, 'sha256')", [tokenOf(step.rateHits)]);
        await db.query(
          `insert into public.share_link_hits (token_hash, client_hash, window_start, hits)
           values (extensions.digest($1, 'sha256'), case when $2 = 'escort' then '\\x'::bytea else extensions.digest($3, 'sha256') end, now(), $4)
           on conflict (token_hash, client_hash) do update set window_start = now(), hits = excluded.hits`,
          [tokenOf(step.rateHits), l?.scope ?? "escort", step.from ?? "", step.hits],
        );
        return "ok";
      }
      if ("rateWindowPassed" in step) {
        await db.query("update public.share_link_hits set window_start = window_start - interval '11 minutes' where token_hash = extensions.digest($1, 'sha256')", [tokenOf(step.rateWindowPassed)]);
        return "ok";
      }
      if ("anon" in step) {
        const t = tokenOf(step.token);
        if (step.anon === "escortView" || step.anon === "kkForm" || step.anon === "scheduleView") {
          const fn = { escortView: "escort_view", kkForm: "kk_form", scheduleView: "schedule_view" }[step.anon];
          const out: string[] = [];
          let names: Awaited<ReturnType<typeof nameMaps>> | undefined;
          for (let i = 0; i < (step.times ?? 1); i++) {
            const r = await anon(`select public.${fn}($1)`, [t], step.from);
            out.push(r.ok ? publicRead(step.anon, r.v, (names ??= await nameMaps())) : r.code);
          }
          return answers(out);
        }
        if (step.anon === "escortTick") {
          const r = await anon("select public.escort_tick($1, $2, $3, $4)", [t, (await at(step.at)).id, step.item, step.on]);
          return r.ok ? publicRead("escortTick", r.v, await nameMaps()) : r.code;
        }
        if (step.anon === "escortPickup") {
          const r = await anon("select public.escort_pickup($1, $2, $3)", [t, (await at(step.at)).id, step.address]);
          return r.ok ? "ok" : r.code;
        }
        const k = step as Extract<Step, { anon: "kkSignup" }>;
        const r = await anon("select public.kk_signup($1, $2, $3)", [t, (await traineeId(k.trainee)) ?? -1, await groupId(k.group)]);
        return r.ok ? (r.v as { status: string }).status : r.code;
      }
      if ("issue" in step) {
        return call(step.as, "select public.issue_link($1, $2, $3)", [ed, step.issue, await traineeId(step.trainee ?? null)], (v) => {
          tokens[step.name] = (v as { token: string }).token;
          return "ok";
        });
      }
      if ("revoke" in step) {
        const l = await one("select id from public.share_links where token_hash = extensions.digest($1, 'sha256')", [tokenOf(step.revoke)]);
        return call(step.as, "select public.revoke_link($1)", [l ? Number(l.id) : -1]);
      }
      if ("kkAdd" in step) return call(step.as, "select public.kk_add_group($1, $2, $3, $4::jsonb)", [ed, step.kkAdd[0], step.kkAdd[1], await kkFields(step.fields)]);
      if ("kkUpdate" in step) return call(step.as, "select public.kk_update_group($1, $2::jsonb)", [await groupId(step.kkUpdate), await kkFields(step.patch)]);
      if ("kkDelete" in step) return call(step.as, "select public.kk_delete_group($1)", [await groupId(step.kkDelete)]);
      if ("kkPlace" in step) return call(step.as, "select public.kk_place($1, $2)", [await groupId(step.kkPlace), (await traineeId(step.trainee)) ?? -1]);
      if ("kkUnplace" in step) return call(step.as, "select public.kk_unplace($1, $2)", [await trackId(step.kkUnplace), (await traineeId(step.trainee)) ?? -1]);
      if ("kkWindow" in step) return call(step.as, "select public.kk_set_window($1, $2, $3)", [ed, step.kkWindow[0], step.kkWindow[1]]);
      if ("bookOrder" in step) return call(step.as, "select public.set_book_order($1, $2, $3)", [await groupId(step.bookOrder), step.copies, step.ordered]);
      if ("archive" in step) {
        await db.query("update public.editions set status = 'archived' where id = $1", [ed]);
        return "ok";
      }
      if ("sandbox" in step) {
        await db.query("update public.editions set kind = 'practice' where id = $1", [ed]);
        return "ok";
      }
      if ("propose" in step) {
        const mode = step.mode ?? "self";
        if ("cell" in step) {
          const [day, start, end, room] = step.cell;
          return call(step.as, "select public.propose($1, $2, null, $3, $4, $5, $6, $7)", [ed, await speakerId(step.propose), day, start, end, room ? await roomId(room) : null, mode]);
        }
        const l = await lessonAt(step.at);
        return call(step.as, "select public.propose($1, $2, $3, null, null, null, null, $4)", [ed, await speakerId(step.propose), l ? l.id : -1, mode]);
      }
      if ("unpropose" in step) return call(step.as, "select public.unpropose($1)", [await pitchOf(step.unpropose, step.at)]);
      if ("setPitch" in step) return call(step.as, "select public.set_pitch($1, $2)", [await pitchOf(step.setPitch, step.at), step.state]);
      if ("close" in step) return call(step.as, "select public.close_lesson($1)", [await pitchOf(step.close, step.at)]);
      if ("reopen" in step) return call(step.as, "select public.reopen_lesson($1)", [(await lessonAt(step.reopen))?.id ?? -1]);
      if ("move" in step) {
        const [day, start, end, room] = step.to;
        return call(step.as, "select public.move_lesson($1, $2, $3, $4, $5)", [(await lessonAt(step.move))?.id ?? -1, day, start, end, await roomId(room)]);
      }
      if ("reshape" in step) {
        const o = step.op;
        return call(step.as, "select public.reshape($1, $2, $3, $4, $5, $6, $7)", [
          ed, step.reshape[0], step.reshape[1], o.op,
          o.op === "split_parallel" ? o.count : null,
          o.op === "split_parallel" ? o.reason : null,
          o.op === "split_time" ? o.parts : null,
        ]);
      }
      if ("update" in step) {
        const l = await lessonAt(step.update);
        const patch: Record<string, unknown> = { ...step.patch };
        if ("category" in patch) {
          patch.category_id = patch.category == null ? null : Number((await one("select id from public.categories where name = $1", [patch.category])).id);
          delete patch.category;
        }
        return call(step.as, "select public.update_lesson($1, $2, $3)", [l?.id ?? -1, (l?.version ?? 0) - (step.staleBy ?? 0), JSON.stringify(patch)]);
      }
      // ---- the pool
      if ("matches" in step) return call(step.as, "select public.speaker_matches($1)", [step.matches], (v) => matchesRead(v as { name: string; disambiguator: string | null; match: string }[]));
      if ("readContacts" in step) {
        return call(step.as, "select public.get_speaker_contacts($1)", [await speakerId(step.readContacts)], (v) => contactsRead(v as Parameters<typeof contactsRead>[0]));
      }
      if ("create" in step) {
        const o = step.opts ?? {};
        return call(step.as, "select public.create_speaker($1, $2::jsonb, $3, $4, $5)", [ed, JSON.stringify(step.create), !!o.claim, !!o.approve, !!o.confirmed]);
      }
      if ("updateSpeaker" in step) {
        const id = await speakerId(step.updateSpeaker);
        const s = await one("select version from public.speakers where id = $1", [id]);
        return call(step.as, "select public.update_speaker($1, $2, $3, $4::jsonb)", [ed, id, (s?.version ?? 0) - (step.staleBy ?? 0), JSON.stringify(step.patch)]);
      }
      if ("vet" in step) {
        const ids: number[] = [];
        for (const label of step.vet) ids.push(await speakerId(label));
        return call(step.as, "select public.vet_speakers($1::bigint[], $2, $3)", [ids, step.state, step.note ?? null]);
      }
      if ("setContacts" in step) {
        return call(step.as, "select public.set_speaker_contacts($1, $2, $3, $4, $5)", [
          await speakerId(step.setContacts), step.phone ?? null, step.email ?? null, step.secretary_note ?? null, step.notes ?? null,
        ]);
      }
      if ("claim" in step) return call(step.as, "select public.claim_speaker($1, $2)", [ed, await speakerId(step.claim)]);
      if ("setStatus" in step) {
        const a = await approachOf(step.setStatus);
        return call(step.as, "select public.set_approach_status($1, $2, $3, $4)", [a?.id ?? -1, (a?.version ?? 0) - (step.staleBy ?? 0), step.status, step.note ?? null]);
      }
      if ("handOver" in step) {
        const a = await approachOf(step.handOver);
        return call(step.as, "select public.hand_over($1, $2, $3)", [a?.id ?? -1, step.to == null ? null : memberId(step.to), step.note ?? null]);
      }
      if ("answerHandOver" in step) {
        const a = await approachOf(step.answerHandOver);
        return call(step.as, "select public.answer_handover($1, $2, $3)", [a?.id ?? -1, step.accept, step.note ?? null]);
      }
      if ("avail" in step) {
        return call(step.as, "select public.set_availability($1, $2, $3, $4, $5, $6)", [ed, await speakerId(step.avail), step.day, step.part, step.kind, step.note ?? null]);
      }
      // ---- from placement to arrival
      if ("pay" in step) {
        const l = await at(step.pay, step.staleBy);
        return call(step.as, "select public.set_payment($1, $2, $3, $4)", [l.id, l.version, step.amount, step.transport]);
      }
      if ("decide" in step) {
        const ls: { id: number; version: number }[] = [];
        for (const p of step.decide) ls.push(await at(p, step.staleBy));
        return call(step.as, "select public.decide_payments($1::bigint[], $2::integer[], $3, $4)", [ls.map((l) => l.id), ls.map((l) => l.version), step.decision, step.note ?? null]);
      }
      if ("sent" in step) {
        const l = await at(step.sent, step.staleBy);
        return call(step.as, "select public.mark_confirm_sent($1, $2)", [l.id, l.version]);
      }
      if ("escort" in step) {
        const l = await at(step.escort, step.staleBy);
        return call(step.as, "select public.set_escort($1, $2, $3, $4, $5)", [l.id, l.version, await traineeId(step.trainee), step.selfIntro, step.note ?? null]);
      }
      if ("sources" in step) {
        const l = await at(step.sources, step.staleBy);
        return call(step.as, "select public.set_sources($1, $2, $3, $4, $5, $6, $7)", [l.id, l.version, step.kind, step.print, step.note ?? null, step.url ?? null, step.inReader]);
      }
      if ("paid" in step) return call(step.as, "select public.set_paid($1, $2)", [(await at(step.paid)).id, step.value]);
      if ("readTransport" in step) {
        return call(step.as, "select public.get_transport_details($1)", [(await at(step.readTransport)).id], (v) => transportRead(v as Parameters<typeof transportRead>[0]));
      }
      if ("setTransport" in step) {
        return call(step.as, "select public.set_transport_details($1, $2, $3, $4, $5, $6)", [
          (await at(step.setTransport)).id, step.address ?? null, step.time ?? null, step.driver ?? null, step.phone ?? null, step.arranged ?? false,
        ]);
      }
      if ("template" in step) return call(step.as, "select public.set_confirm_template($1, $2)", [ed, step.template]);
      if ("duty" in step) return call(step.as, "select public.set_duty_phrases($1, $2::jsonb)", [ed, step.duty === undefined ? null : JSON.stringify(step.duty)]);
      throw new Error(`a step no driver knows: ${JSON.stringify(step)}`);
    },

    async state(): Promise<Normal> {
      const lessons = (await db.query(`
        select l.*, r.name as room, c.name as cat, ro.full_name as trainee from public.lessons l
          join public.rooms r on r.id = l.room_id left join public.categories c on c.id = l.category_id
          left join public.roster ro on ro.id = l.escort_roster_id
         where l.edition_id = $1 and l.state <> 'cancelled'`, [ed])).rows;
      const byId = new Map(lessons.map((l) => [Number(l.id), lessonKey(l)]));
      const member = (id: unknown) => (id == null ? "-" : MEMBERS.find((_m, i) => i + 1 === Number(id))?.key ?? `#${id}`);
      const pitches = (await db.query(`
        select p.lesson_id, p.state, p.proposed_by, s.name, s.disambiguator from public.pitches p
          join public.approaches a on a.id = p.approach_id join public.speakers s on s.id = a.speaker_id
         where p.edition_id = $1`, [ed])).rows;
      const approaches = (await db.query(`
        select a.*, s.name, s.disambiguator from public.approaches a join public.speakers s on s.id = a.speaker_id where a.edition_id = $1`, [ed])).rows;
      const speakers = (await db.query(`
        select x.lesson_id, x.role, s.name, s.disambiguator from public.lesson_speakers x join public.speakers s on s.id = x.speaker_id where x.edition_id = $1`, [ed])).rows;
      const pool = (await db.query("select * from public.speakers")).rows;
      const contacts = (await db.query("select c.*, s.name, s.disambiguator from public.speaker_contacts c join public.speakers s on s.id = c.speaker_id")).rows;
      const availability = (await db.query(`
        select v.*, s.name, s.disambiguator from public.availability v join public.approaches a on a.id = v.approach_id
          join public.speakers s on s.id = a.speaker_id where a.edition_id = $1`, [ed])).rows;
      const transport = (await db.query("select t.* from public.transport_details t join public.lessons l on l.id = t.lesson_id where l.edition_id = $1", [ed])).rows;
      const settings = (await one("select settings from public.editions where id = $1", [ed])).settings;
      const links = (await db.query("select l.*, r.full_name from public.share_links l left join public.roster r on r.id = l.subject_id where l.edition_id = $1", [ed])).rows;
      const names = await nameMaps();
      const tracks = (await db.query("select * from public.kk_tracks where edition_id = $1", [ed])).rows;
      const groups = (await db.query(`
        select g.*, r.name as room,
               (select string_agg(k.kind || ':' || coalesce(ro.full_name, k.label), ',' order by k.sort)
                  from public.kk_leaders k left join public.roster ro on ro.id = k.roster_id where k.group_id = g.id) as leaders
          from public.kk_groups g left join public.rooms r on r.id = g.room_id where g.edition_id = $1`, [ed])).rows;
      const signups = (await db.query("select * from public.kk_signups where edition_id = $1", [ed])).rows;
      const orders = (await db.query("select o.* from public.book_orders o join public.kk_groups g on g.id = o.group_id where g.edition_id = $1", [ed])).rows;
      const ticks = (await db.query("select t.* from public.escort_ticks t join public.lessons l on l.id = t.lesson_id where l.edition_id = $1", [ed])).rows;
      return {
        lessons: lessons
          .map((l) => lessonLine(lessonKey(l), l, l.cat ?? "-", member, l.escort_roster_id == null ? "-" : (l.trainee ?? `#${l.escort_roster_id}`)))
          .sort(),
        pitches: pitches.map((p) => `${byId.get(Number(p.lesson_id))}|${speakerLabel(p)}|${p.state}|by=${member(p.proposed_by)}`).sort(),
        approaches: approaches.map((a) => `${speakerLabel(a)}|owner=${member(a.owner_member_id)}|${a.status}|offer=${member(a.offered_to)}|v=${a.version}`).sort(),
        speakers: speakers.map((x) => `${byId.get(Number(x.lesson_id))}|${speakerLabel(x)}|${x.role}`).sort(),
        pool: pool.map((s) => poolLine(s, member(s.vetted_by))).sort(),
        contacts: contacts.map((c) => contactsLine(speakerLabel(c), c)).sort(),
        availability: availability.map((v) => `${speakerLabel(v)}|${v.day}|${v.from_min}-${v.to_min}|${v.kind}|${v.note ?? "-"}`).sort(),
        transport: transport.map((t) => transportLine(byId.get(Number(t.lesson_id))!, t)).sort(),
        edition: editionLines(settings),
        links: links
          .map((l) => linkLine({ scope: l.scope, trainee: l.subject_id == null ? "-" : (l.full_name ?? `#${l.subject_id}`), revoked: l.revoked_at != null, created_at: l.created_at, expires_at: l.expires_at, by: member(l.created_by) }))
          .sort(),
        kk: [
          ...tracks.map((t) => `track|${t.day}|${t.start_min}-${t.end_min}`),
          ...groups.map((g) => `group|${names.track(Number(g.track_id))}|${g.title}|a=${g.author ?? "-"}|room=${g.room ?? "-"}|cap=${g.capacity ?? "-"}|open=${g.open}|lead=${g.leaders ?? "-"}`),
          ...signups.map((x) => `signup|${names.track(Number(x.track_id))}|${names.trainee(Number(x.roster_id))}|${names.group(Number(x.group_id))}|${x.via}`),
          ...orders.map((o) => `order|${names.group(Number(o.group_id))}|${o.copies}|ord=${o.ordered_at == null ? "-" : "y"}`),
        ].sort(),
        ticks: ticks.map((t) => `${byId.get(Number(t.lesson_id))}|${t.item}`).sort(),
      };
    },

    async close() {
      await dropDatabase(db, dbName);
    },
  };
}
