import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
}
