// The parity driver for supabase/schema.sql: a fresh PostgreSQL 16 database per
// scenario, every command called as the role a browser gets, with that
// member's Google claims — and committed, like PostgREST would.
import type pg from "pg";
import { SCHEMA, dropDatabase, freshDatabase, google } from "../sql/db";
import { type At, type Driver, EDITION, lessonKey, MEMBERS, type Normal, ROOMS, SPEAKERS, type Step } from "./fixture";

export async function sqlDriver(dbName: string): Promise<Driver> {
  const db: pg.Client = await freshDatabase(dbName, "new");
  await db.query(SCHEMA);

  const ed = Number((await db.query("insert into public.editions (label, first_day_from, last_day_until) values ($1, $2, $3) returning id", [EDITION.label, EDITION.first_day_from, EDITION.last_day_until])).rows[0].id);
  await db.query("insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days) select $1, start_min, end_min, kind, label, days from public.grid_template", [ed]);
  for (const r of ROOMS) await db.query("insert into public.rooms (edition_id, name, sort, is_default) values ($1, $2, $3, $4)", [ed, r.name, r.sort, r.is_default]);
  for (const m of MEMBERS) {
    await db.query("insert into public.members (email, display_name, role, edition_id) values ($1, $2, $3, $4)", [m.email, m.name, m.role, m.role === "admin" ? null : ed]);
  }
  for (const s of SPEAKERS) {
    await db.query("insert into public.speakers (name, gender, vetted, retired) values ($1, $2, $3, $4)", [s.name, s.gender, s.vetted ?? "approved", !!s.retired]);
  }

  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0];
  const roomId = async (name?: string) =>
    Number((await one(name ? "select id from public.rooms where edition_id = $1 and name = $2" : "select id from public.rooms where edition_id = $1 and is_default", name ? [ed, name] : [ed])).id);
  const lessonAt = async ([day, start, room]: At) =>
    one("select id, version from public.lessons where edition_id = $1 and day = $2 and start_min = $3 and room_id = $4 and state <> 'cancelled'", [ed, day, start, await roomId(room)]);
  const speakerId = async (name: string) => Number((await one("select id from public.speakers where name = $1", [name])).id);
  const pitchOf = async (speaker: string, at: At) => {
    const l = await lessonAt(at);
    if (!l) return -1;
    const p = await one("select p.id from public.pitches p join public.approaches a on a.id = p.approach_id where p.lesson_id = $1 and a.speaker_id = $2", [l.id, await speakerId(speaker)]);
    return p ? Number(p.id) : -1;
  };

  /** One RPC, as a member, committed — or rolled back with the contract's code. */
  async function call(actor: string, sql: string, params: unknown[]): Promise<string> {
    const m = MEMBERS.find((x) => x.key === actor)!;
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(google(m.email))]);
      await db.query(sql, params);
      await db.query("commit");
      return "ok";
    } catch (e) {
      await db.query("rollback");
      const err = e as { code?: string; message: string };
      return err.code === "P0001" ? err.message : `raw:${err.code}:${err.message}`;
    }
  }

  return {
    async run(step: Step): Promise<string> {
      if ("archive" in step) {
        await db.query("update public.editions set status = 'archived' where id = $1", [ed]);
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
      // update
      const l = await lessonAt(step.update);
      const patch: Record<string, unknown> = { ...step.patch };
      if ("category" in patch) {
        patch.category_id = patch.category == null ? null : Number((await one("select id from public.categories where name = $1", [patch.category])).id);
        delete patch.category;
      }
      return call(step.as, "select public.update_lesson($1, $2, $3)", [l?.id ?? -1, (l?.version ?? 0) - (step.staleBy ?? 0), JSON.stringify(patch)]);
    },

    async state(): Promise<Normal> {
      const lessons = (await db.query(`
        select l.*, r.name as room, c.name as cat from public.lessons l
          join public.rooms r on r.id = l.room_id left join public.categories c on c.id = l.category_id
         where l.edition_id = $1 and l.state <> 'cancelled'`, [ed])).rows;
      const byId = new Map(lessons.map((l) => [Number(l.id), lessonKey(l)]));
      const member = (id: number | null) => (id == null ? "-" : MEMBERS.find((_m, i) => i + 1 === Number(id))?.key ?? `#${id}`);
      const pitches = (await db.query(`
        select p.lesson_id, p.state, p.proposed_by, s.name from public.pitches p
          join public.approaches a on a.id = p.approach_id join public.speakers s on s.id = a.speaker_id
         where p.edition_id = $1`, [ed])).rows;
      const approaches = (await db.query(`
        select a.*, s.name from public.approaches a join public.speakers s on s.id = a.speaker_id where a.edition_id = $1`, [ed])).rows;
      const speakers = (await db.query(`
        select x.lesson_id, x.role, s.name from public.lesson_speakers x join public.speakers s on s.id = x.speaker_id where x.edition_id = $1`, [ed])).rows;
      return {
        lessons: lessons
          .map((l) => `${lessonKey(l)}|${l.kind}|${l.state}|t=${l.title ?? "-"}|c=${l.cat ?? "-"}|a=${l.audience ?? "-"}|tm=${l.teach_min ?? "-"}|p=${l.parallel_reason ?? "-"}|rc=${l.needs_reconfirm}|v=${l.version}`)
          .sort(),
        pitches: pitches.map((p) => `${byId.get(Number(p.lesson_id))}|${p.name}|${p.state}|by=${member(p.proposed_by)}`).sort(),
        approaches: approaches.map((a) => `${a.name}|owner=${member(a.owner_member_id)}|${a.status}|v=${a.version}`).sort(),
        speakers: speakers.map((x) => `${byId.get(Number(x.lesson_id))}|${x.name}|${x.role}`).sort(),
      };
    },

    async close() {
      await dropDatabase(db, dbName);
    },
  };
}
