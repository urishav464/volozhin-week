// The week's commands against the real database: one RPC each (supabase/schema.sql,
// docs/CONTRACT.md), called by its parameter names. A refusal comes back as a
// CommandError with the contract's code — never a raw Postgres message. Apart
// from SupabasePort so a test can drive it with a stub fetch
// (src/data/supabaseCommands.test.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransportDetails } from "../domain/types";
import { type CellTarget, CommandError, type LessonPatch, type ReshapeOp, type WeekCommands } from "./commands";
import { portError } from "../offline/network";

/** An RPC; a refusal comes back as the contract's code (raise … message = '<code>'). */
export async function callRpc(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error, status } = await sb.rpc(fn, args);
  if (error) {
    if (error.code === "P0001") throw new CommandError(error.message);
    // The RPCs re-raise constraint violations under their code; this is the
    // backstop if one ever slips through raw.
    if (error.code === "23P01") throw new CommandError(/speaker/.test(error.message) ? "speaker_busy" : "room_taken");
    // A function this role may not execute (the grants at the end of schema.sql).
    if (error.code === "42501") throw new CommandError("forbidden");
    // no answer at all (status 0): «network», which may fall back to the device's snapshot (src/offline/network.ts)
    throw portError(error, status);
  }
  return data;
}

export function supabaseCommands(sb: SupabaseClient, editionId: number): WeekCommands {
  const call = (fn: string, args: Record<string, unknown>) => callRpc(sb, fn, args);
  const cell = (t: CellTarget) =>
    "lesson_id" in t
      ? { p_lesson: t.lesson_id, p_day: null, p_start: null, p_end: null, p_room: null }
      : { p_lesson: null, p_day: t.day, p_start: t.start_min, p_end: t.end_min, p_room: t.room_id };
  const reshapeArgs = (op: ReshapeOp) => ({
    p_op: op.op,
    p_count: op.op === "split_parallel" ? op.count : null,
    p_reason: op.op === "split_parallel" ? op.reason : null,
    p_parts: op.op === "split_time" ? op.parts : null,
  });
  return {
    propose: async (speakerId, target, mode = "self") =>
      (await call("propose", { p_edition: editionId, p_speaker: speakerId, ...cell(target), p_mode: mode })) as { lesson_id: number; pitch_id: number },
    unpropose: async (pitchId) => void (await call("unpropose", { p_pitch: pitchId })),
    setPitch: async (pitchId, state) => void (await call("set_pitch", { p_pitch: pitchId, p_state: state })),
    closeLesson: async (pitchId) => void (await call("close_lesson", { p_pitch: pitchId })),
    reopenLesson: async (lessonId) => void (await call("reopen_lesson", { p_lesson: lessonId })),
    moveLesson: async (lessonId, to) =>
      void (await call("move_lesson", { p_lesson: lessonId, p_day: to.day, p_start: to.start_min, p_end: to.end_min, p_room: to.room_id })),
    reshape: async (day, rowStart, op) => void (await call("reshape", { p_edition: editionId, p_day: day, p_row_start: rowStart, ...reshapeArgs(op) })),
    updateLesson: async (lessonId, version, patch: LessonPatch) => void (await call("update_lesson", { p_lesson: lessonId, p_version: version, p_patch: patch })),

    // ---- milestone 3 (CONTRACT.md «From placement to arrival»)
    setPayment: async (lessonId, version, amount, transport) =>
      void (await call("set_payment", { p_lesson: lessonId, p_version: version, p_pay_amount: amount, p_transport: transport })),
    decidePayments: async (items, decision, note = null) =>
      void (await call("decide_payments", {
        p_lessons: items.map((i) => i.lesson_id),
        p_versions: items.map((i) => i.version),
        p_decision: decision,
        p_note: note,
      })),
    markConfirmSent: async (lessonId, version) => void (await call("mark_confirm_sent", { p_lesson: lessonId, p_version: version })),
    setEscort: async (lessonId, version, e) =>
      void (await call("set_escort", { p_lesson: lessonId, p_version: version, p_roster: e.roster_id, p_self_intro: e.self_intro, p_note: e.escort_note })),
    setSources: async (lessonId, version, s) =>
      void (await call("set_sources", {
        p_lesson: lessonId,
        p_version: version,
        p_kind: s.sources_kind,
        p_print_when: s.print_when,
        p_note: s.sources_note,
        p_url: s.presentation_url,
        p_in_reader: s.in_reader,
      })),
    setPaid: async (lessonId, paid) => void (await call("set_paid", { p_lesson: lessonId, p_paid: paid })),
    transport: async (lessonId) => {
      const t = (await call("get_transport_details", { p_lesson: lessonId })) as TransportDetails | null;
      return t == null
        ? null
        : { pickup_address: t.pickup_address ?? null, pickup_time: t.pickup_time ?? null, driver_name: t.driver_name ?? null, driver_phone: t.driver_phone ?? null, arranged: t.arranged === true };
    },
    setTransport: async (lessonId, d) =>
      void (await call("set_transport_details", {
        p_lesson: lessonId,
        p_pickup_address: d.pickup_address,
        p_pickup_time: d.pickup_time,
        p_driver_name: d.driver_name,
        p_driver_phone: d.driver_phone,
        p_arranged: d.arranged,
      })),

    // ---- milestone 5ב-2 (CONTRACT.md «Memorial times and logistics»)
    transports: async () =>
      (((await call("get_transports_for", { p_edition: editionId })) ?? []) as Record<string, unknown>[]).map((t) => ({
        lesson_id: Number(t.lesson_id),
        pickup_address: (t.pickup_address as string | null) ?? null,
        pickup_time: (t.pickup_time as string | null) ?? null,
        driver_name: (t.driver_name as string | null) ?? null,
        driver_phone: (t.driver_phone as string | null) ?? null,
        arranged: t.arranged === true,
      })),
    addMemorialSlot: async (day, start, end, roomId) =>
      Number(await call("add_memorial_slot", { p_edition: editionId, p_day: day, p_start: start, p_end: end, p_room: roomId })),
    removeMemorialSlot: async (lessonId) => void (await call("remove_memorial_slot", { p_lesson: lessonId })),
    addMemorialPlan: async (fallenId) => Number(await call("add_memorial_plan", { p_edition: editionId, p_fallen: fallenId })),
    updateMemorialPlan: async (planId, version, patch) => void (await call("update_memorial_plan", { p_plan: planId, p_version: version, p_patch: patch })),
    placeMemorialPlan: async (planId, version, lessonId) => void (await call("place_memorial_plan", { p_plan: planId, p_version: version, p_lesson: lessonId })),
    deleteMemorialPlan: async (planId) => void (await call("delete_memorial_plan", { p_plan: planId })),
    setMemorialPolicy: async (policy) =>
      void (await call("set_memorial_policy", {
        p_edition: editionId,
        p_placement: policy.placement ?? null,
        p_max_minutes: policy.max_minutes ?? null,
        p_warn_adjacent_meal: policy.warn_adjacent_meal ?? null,
      })),
  };
}
