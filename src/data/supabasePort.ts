import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Edition, Week } from "../domain/types";
import { type CellTarget, CommandError, type LessonPatch, type ReshapeOp, type WeekCommands } from "./commands";
import type { DataPort } from "./port";
import { PortError, type WhoAmI } from "./types";

export class SupabasePort implements DataPort {
  readonly mode = "live" as const;
  private readonly sb: SupabaseClient;

  constructor(url: string, key: string) {
    // PKCE: Google sends back a one-time code, never the tokens themselves, so
    // no token lands in the address bar or the browser history.
    this.sb = createClient(url, key, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
  }

  async sessionEmail(): Promise<string | null> {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.email ?? null;
  }

  async whoami(): Promise<WhoAmI> {
    const { data: s } = await this.sb.auth.getSession();
    if (!s.session) return { status: "signed_out" };
    const { data, error } = await this.sb.rpc("whoami");
    if (error) throw new PortError(error.code ?? null, error.message);
    return data as WhoAmI;
  }

  async signInWithGoogle(): Promise<void> {
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) throw new PortError(null, error.message);
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  onAuthChange(cb: () => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") cb();
    });
    return () => data.subscription.unsubscribe();
  }

  async editions(): Promise<Edition[]> {
    const { data, error } = await this.sb.from("editions").select("*").order("id", { ascending: false });
    if (error) throw new PortError(error.code ?? null, error.message);
    return data as Edition[];
  }

  async loadWeek(editionId: number): Promise<Week> {
    return (await this.call("load_week", { p_edition: editionId })) as Week;
  }

  commands(editionId: number): WeekCommands {
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
        (await this.call("propose", { p_edition: editionId, p_speaker: speakerId, ...cell(target), p_mode: mode })) as { lesson_id: number; pitch_id: number },
      unpropose: async (pitchId) => void (await this.call("unpropose", { p_pitch: pitchId })),
      setPitch: async (pitchId, state) => void (await this.call("set_pitch", { p_pitch: pitchId, p_state: state })),
      closeLesson: async (pitchId) => void (await this.call("close_lesson", { p_pitch: pitchId })),
      reopenLesson: async (lessonId) => void (await this.call("reopen_lesson", { p_lesson: lessonId })),
      moveLesson: async (lessonId, to) =>
        void (await this.call("move_lesson", { p_lesson: lessonId, p_day: to.day, p_start: to.start_min, p_end: to.end_min, p_room: to.room_id })),
      reshape: async (day, rowStart, op) => void (await this.call("reshape", { p_edition: editionId, p_day: day, p_row_start: rowStart, ...reshapeArgs(op) })),
      updateLesson: async (lessonId, version, patch: LessonPatch) => void (await this.call("update_lesson", { p_lesson: lessonId, p_version: version, p_patch: patch })),
    };
  }

  subscribe(editionId: number, onChange: () => void): () => void {
    // One channel per edition. Each event just asks the screen to reload; the
    // grid is small enough (~150 lessons) that a reload is cheaper than merging.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bounce = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 250);
    };
    const channel = this.sb.channel(`edition-${editionId}`);
    for (const table of ["lessons", "lesson_speakers", "pitches", "approaches", "speakers"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, bounce);
    }
    channel.subscribe();
    // A missed event (sleeping laptop, dropped socket) is healed on return.
    const onFocus = () => document.visibilityState === "visible" && onChange();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onFocus);
      void this.sb.removeChannel(channel);
    };
  }

  /** An RPC; a refusal comes back as the contract's code (raise … message = '<code>'). */
  private async call(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) {
      if (error.code === "P0001") throw new CommandError(error.message);
      // The RPCs re-raise constraint violations under their code; this is the
      // backstop if one ever slips through raw.
      if (error.code === "23P01") throw new CommandError(/speaker/.test(error.message) ? "speaker_busy" : "room_taken");
      throw new PortError(error.code ?? null, error.message);
    }
    return data;
  }
}
