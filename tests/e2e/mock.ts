// A fake Supabase for the mock build: a stored session, and a recorder that
// answers the auth and RPC endpoints.
import type { BrowserContext, Page, Route } from "@playwright/test";
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
  /** The `apikey` header — the publishable key on every request. */
  apikey?: string | undefined;
  /** The full URL, as sent (a token must never be in it). */
  url?: string;
}

/** A table write (POST / PATCH / DELETE on /rest/v1/<table>), as PostgREST would receive it. */
export interface Write extends Call {
  table: string;
  body: unknown;
  prefer: string | undefined;
}

/** A request to the Storage API (/storage/v1/…), as it arrived. */
export interface StorageCall {
  method: string;
  path: string;
  auth: string | undefined;
  apikey: string | undefined;
  contentType: string | undefined;
  /** JSON bodies parsed; an upload's body is its byte length. */
  body: unknown;
}

export class FakeSupabase {
  readonly calls: Call[] = [];
  /** Bodies of every RPC call, by function name. */
  readonly rpc = new Map<string, unknown[]>();
  /** Answers for RPCs other than whoami, and for GET /rest/v1/editions. */
  readonly answers = new Map<string, unknown>();
  /** Rows a GET of /rest/v1/<table> answers (any filter); [] when unset. */
  readonly tables = new Map<string, unknown[]>();
  /** Every table write, in order. A POST answers its rows back with ids, as `return=representation` does. */
  readonly writes: Write[] = [];
  /** When set, whoami answers 401 unless the request carries exactly this bearer — like PostgREST. */
  token: string | null = null;
  /** What /auth/v1/token?grant_type=pkce answers (and the body it was sent). */
  pkceSession: unknown = null;
  pkceBody: { auth_code?: string; code_verifier?: string } | null = null;
  /** Every Storage request, in order. Uploads answer 200; signing answers a signed URL per path; a DELETE echoes the paths; a signed URL serves `storageFiles`. */
  readonly storage: StorageCall[] = [];
  /** The bytes a signed URL serves, by object path. */
  readonly storageFiles = new Map<string, Buffer>();
  /** When set, an upload answers this instead of 200. */
  uploadAnswer: { status: number; body: unknown } | null = null;
  constructor(private whoami: { status: number; body: unknown } = { status: 200, body: {} }) {}

  /** A page — or a whole context, so a page it opens (a link's tab) is answered too. */
  async attach(target: Page | BrowserContext) {
    await target.route(`${MOCK_URL}/**`, (route) => this.handle(route));
  }

  count(path: string) {
    return this.calls.filter((c) => c.path === path).length;
  }

  private handle(route: Route) {
    const req = route.request();
    const u = new URL(req.url());
    this.calls.push({ path: u.pathname, query: u.searchParams, method: req.method(), auth: req.headers()["authorization"], apikey: req.headers()["apikey"], url: req.url() });
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
    if (u.pathname.startsWith("/storage/v1/")) return this.storageAnswer(route);
    if (u.pathname === "/rest/v1/editions" && req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(this.answers.get("editions") ?? []) });
    }
    if (u.pathname.startsWith("/rest/v1/") && !u.pathname.startsWith("/rest/v1/rpc/")) {
      const table = u.pathname.slice("/rest/v1/".length);
      const one = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      if (req.method() === "GET") {
        const rows = this.tables.get(table) ?? [];
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(one ? rows[0] : rows) });
      }
      const body = req.postData() ? req.postDataJSON() : null;
      this.writes.push({ path: u.pathname, query: u.searchParams, method: req.method(), auth: req.headers()["authorization"], table, body, prefer: req.headers()["prefer"] });
      const rows = (Array.isArray(body) ? body : [body ?? {}]).map((r, i) => ({ id: 100 + this.writes.length + i, active: true, ...r }));
      return route.fulfill({ status: req.method() === "POST" ? 201 : 200, contentType: "application/json", body: JSON.stringify(one ? rows[0] : rows) });
    }
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.slice("/rest/v1/rpc/".length);
      this.rpc.set(fn, [...(this.rpc.get(fn) ?? []), req.postDataJSON()]);
      const answer = this.answers.get(fn);
      if (answer !== undefined) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  }

  private storageAnswer(route: Route) {
    const req = route.request();
    const u = new URL(req.url());
    const h = req.headers();
    const raw = req.postDataBuffer();
    const json = (h["content-type"] ?? "").includes("application/json") && raw ? JSON.parse(raw.toString("utf8")) : raw ? raw.length : null;
    this.storage.push({ method: req.method(), path: u.pathname, auth: h["authorization"], apikey: h["apikey"], contentType: h["content-type"], body: json });
    const ok = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    const signPrefix = "/storage/v1/object/sign/sources/";
    if (req.method() === "GET" && u.pathname.startsWith(signPrefix)) {
      const file = this.storageFiles.get(decodeURIComponent(u.pathname.slice(signPrefix.length)));
      return file ? route.fulfill({ status: 200, contentType: "application/pdf", body: file }) : route.fulfill({ status: 404, body: "" });
    }
    if (req.method() === "POST" && u.pathname === "/storage/v1/object/sign/sources") {
      const paths = (json as { paths: string[] }).paths;
      return ok(paths.map((p) => ({ error: null, path: p, signedURL: `/object/sign/sources/${p}?token=signed-test-token` })));
    }
    if (req.method() === "DELETE" && u.pathname === "/storage/v1/object/sources") {
      return ok(((json as { prefixes: string[] }).prefixes ?? []).map((name) => ({ name, bucket_id: "sources" })));
    }
    if (req.method() === "POST" && u.pathname.startsWith("/storage/v1/object/sources/")) {
      if (this.uploadAnswer) return route.fulfill({ status: this.uploadAnswer.status, contentType: "application/json", body: JSON.stringify(this.uploadAnswer.body) });
      return ok({ Key: u.pathname.slice("/storage/v1/object/".length), Id: "00000000-0000-4000-8000-000000000099" });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  }
}
