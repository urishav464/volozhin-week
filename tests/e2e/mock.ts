// A fake Supabase for the mock build: a stored session, and a recorder that
// answers the auth and RPC endpoints.
import type { Page, Route } from "@playwright/test";
import { MOCK_URL } from "./global-setup";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function fakeSession(email = "member@example.org") {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: {},
    created_at: "2026-10-01T00:00:00Z",
  };
  const token = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: user.id, email, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now, app_metadata: user.app_metadata }),
    "c2ln",
  ].join(".");
  return { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "mock-refresh", user };
}

/** Store a signed-in session in the browser; returns it (its access_token is what requests must carry). */
export async function signIn(page: Page, email?: string) {
  const key = `sb-${new URL(MOCK_URL).hostname.split(".")[0]}-auth-token`;
  const session = fakeSession(email);
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(session)] as const);
  return session;
}

export interface Call {
  path: string;
  query: URLSearchParams;
  method: string;
  auth: string | undefined;
}

export class FakeSupabase {
  readonly calls: Call[] = [];
  /** Bodies of every RPC call, by function name. */
  readonly rpc = new Map<string, unknown[]>();
  /** Answers for RPCs other than whoami, and for GET /rest/v1/editions. */
  readonly answers = new Map<string, unknown>();
  /** When set, whoami answers 401 unless the request carries exactly this bearer — like PostgREST. */
  token: string | null = null;
  /** What /auth/v1/token?grant_type=pkce answers (and the body it was sent). */
  pkceSession: unknown = null;
  pkceBody: { auth_code?: string; code_verifier?: string } | null = null;
  constructor(private whoami: { status: number; body: unknown } = { status: 200, body: {} }) {}

  async attach(page: Page) {
    await page.route(`${MOCK_URL}/**`, (route) => this.handle(route));
  }

  count(path: string) {
    return this.calls.filter((c) => c.path === path).length;
  }

  private handle(route: Route) {
    const req = route.request();
    const u = new URL(req.url());
    this.calls.push({ path: u.pathname, query: u.searchParams, method: req.method(), auth: req.headers()["authorization"] });
    if (u.pathname === "/auth/v1/authorize") {
      return route.fulfill({ status: 200, contentType: "text/html", body: "<p>mock Google</p>" });
    }
    if (u.pathname === "/rest/v1/rpc/whoami") {
      if (this.token && req.headers()["authorization"] !== `Bearer ${this.token}`) {
        return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "PGRST301", message: "JWT required" }) });
      }
      return route.fulfill({ status: this.whoami.status, contentType: "application/json", body: JSON.stringify(this.whoami.body) });
    }
    if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "pkce" && this.pkceSession) {
      this.pkceBody = req.postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(this.pkceSession) });
    }
    if (u.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, body: "" });
    if (u.pathname === "/rest/v1/editions") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(this.answers.get("editions") ?? []) });
    }
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.slice("/rest/v1/rpc/".length);
      this.rpc.set(fn, [...(this.rpc.get(fn) ?? []), req.postDataJSON()]);
      const answer = this.answers.get(fn);
      if (answer !== undefined) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  }
}
