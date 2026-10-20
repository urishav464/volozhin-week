import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Edition, Week } from "../domain/types";
import type { WeekCommands } from "./commands";
import type { DataPort } from "./port";
import { REALTIME_TABLES } from "./realtime";
import { callRpc, supabaseCommands } from "./supabaseCommands";
import { SupabaseKk, SupabaseLinks } from "./supabaseLinks";
import { SupabaseMemorial } from "./supabaseMemorial";
import { SupabaseKnowledge, SupabaseOutputs } from "./supabaseOutputs";
import { SupabaseSettings } from "./supabaseSettings";
import { SupabaseSources } from "./supabaseSources";
import { SupabaseSpeakers } from "./supabaseSpeakers";
import { PortError, type WhoAmI } from "./types";

export class SupabasePort implements DataPort {
  readonly mode = "live" as const;
  readonly settings: SupabaseSettings;
  readonly speakers: SupabaseSpeakers;
  readonly outputs: SupabaseOutputs;
  readonly knowledge: SupabaseKnowledge;
  readonly links: SupabaseLinks;
  readonly kk: SupabaseKk;
  readonly sources: SupabaseSources;
  readonly memorial: SupabaseMemorial;
  private readonly sb: SupabaseClient;
  private topicSeq = 0;

  constructor(url: string, key: string) {
    // PKCE: Google sends back a one-time code, never the tokens themselves, so
    // no token lands in the address bar or the browser history.
    this.sb = createClient(url, key, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
    this.settings = new SupabaseSettings(this.sb);
    this.speakers = new SupabaseSpeakers(this.sb);
    this.outputs = new SupabaseOutputs(this.sb);
    this.knowledge = new SupabaseKnowledge(this.sb);
    this.links = new SupabaseLinks(this.sb);
    this.kk = new SupabaseKk(this.sb);
    this.sources = new SupabaseSources(this.sb, url, key);
    this.memorial = new SupabaseMemorial(this.sb);
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
    const w = (await callRpc(this.sb, "load_week", { p_edition: editionId })) as Week;
    // A database from before v7 has no roster in the Week (the schema-version gate shows first; this keeps a screen from breaking under it).
    if (w && !Array.isArray(w.roster)) w.roster = [];
    if (w && !Array.isArray(w.escortTicks)) w.escortTicks = []; // and none of the escorts' ticks before v9
    if (w && !Array.isArray(w.sourceFiles)) w.sourceFiles = []; // nor a file before v10
    if (w && !Array.isArray(w.memorialPlans)) w.memorialPlans = []; // nor a memorial plan before v11
    if (w && !Array.isArray(w.fallen)) w.fallen = [];
    return w;
  }

  commands(editionId: number): WeekCommands {
    return supabaseCommands(this.sb, editionId);
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
}
