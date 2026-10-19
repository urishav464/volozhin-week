import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Edition, Week } from "../domain/types";
import { type CellTarget, CommandError, type LessonPatch, type ReshapeOp, type WeekCommands } from "./commands";
import type { DataPort } from "./port";
import { REALTIME_TABLES } from "./realtime";
import { SupabaseSettings } from "./supabaseSettings";
import { PortError, type WhoAmI } from "./types";

export class SupabasePort implements DataPort {
  readonly mode = "live" as const;
  readonly settings: SupabaseSettings;
  private readonly sb: SupabaseClient;
  private topicSeq = 0;

  constructor(url: string, key: string) {
    // PKCE: Google sends back a one-time code, never the tokens themselves, so
    // no token lands in the address bar or the browser history.
    this.sb = createClient(url, key, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
    this.settings = new SupabaseSettings(this.sb);
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
    // This browser only: a trainee signing out of a shared midrasha computer
    // must not be signed out of their phone in the middle of the week.
    await this.sb.auth.signOut({ scope: "local" });
  }

  onAuthChange(cb: () => void): () => void {
    // auth-js re-emits SIGNED_IN on every return to the tab (and to every open
    // tab); only a different user, or a sign-out, changes what we show.
    let user: string | null | undefined;
    const { data } = this.sb.auth.onAuthStateChange((event, session) => {
      const next = session?.user.id ?? null;
      if (event === "SIGNED_OUT" || (event === "SIGNED_IN" && next !== user)) {
        const first = user === undefined;
        user = next;
        if (!first || event === "SIGNED_OUT") cb();
      } else if (user === undefined) user = next;
    });
    return () => data.subscription.unsubscribe();
  }

  async authError(): Promise<string | null> {
    const { error } = await this.sb.auth.initialize(); // the cached result of the URL detection at start-up
    if (!error) return null;
    const u = new URL(window.location.href);
    for (const k of ["error", "error_code", "error_description"]) u.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", u.pathname + u.search); // also drops #error=…
    return error.message;
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
    let retry: ReturnType<typeof setTimeout> | undefined;
    let channel: RealtimeChannel | null = null;
    let attempt = 0;
    let closed = false;
    const bounce = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 250);
    };
    // The server refuses a postgres_changes subscription for good (a table not
    // yet published, Realtime switched off, a stale token) and says so only in
    // a status or `system` message — so listen, and join again with backoff.
    const again = (why: unknown) => {
      if (closed || retry) return;
      console.warn("realtime:", why);
      const old = channel;
      channel = null;
      if (old) void this.sb.removeChannel(old);
      retry = setTimeout(() => {
        retry = undefined;
        join();
      }, Math.min(60_000, 2_000 * 2 ** attempt++));
    };
    const join = () => {
      if (closed) return;
      // A fresh topic each time: reusing one whose leave is still in flight
      // hands back the leaving channel, and the new subscription never starts.
      const ch = this.sb.channel(`edition-${editionId}-${++this.topicSeq}`);
      for (const table of REALTIME_TABLES) {
        ch.on("postgres_changes", { event: "*", schema: "public", table }, bounce);
      }
      ch.on("system", {}, (p: { extension?: string; status?: string; message?: string }) => {
        if (p.extension === "postgres_changes" && p.status === "error") again(p.message);
        else if (p.extension === "postgres_changes" && p.status === "ok") attempt = 0;
      });
      ch.subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") again(err ?? status);
      });
      channel = ch;
    };
    join();
    // A missed event (sleeping laptop, dropped socket) is healed on return.
    const onFocus = () => document.visibilityState === "visible" && onChange();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onFocus);
      if (channel) void this.sb.removeChannel(channel);
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
