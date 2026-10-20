// SupabasePort on the wire, for the day without internet: the real supabase-js client with a stub fetch and an
// in-memory storage. No answer at all is «network» (the app may show the device's snapshot); an answer that refuses
// is never «network»; an expired token that cannot be refreshed offline is not a sign-out; the device's user is read
// without the network; and a sign-out removes the session even when auth-js gives up for want of a network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNetworkError, NETWORK } from "../offline/network";
import { returnedFromAuth, sessionStorageKey, SupabasePort } from "./supabasePort";
import { PortError } from "./types";

const URL_ = "https://abcdefgh.supabase.co";
const KEY = sessionStorageKey(URL_);
const UID = "00000000-0000-4000-8000-0000000000aa";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function session(expiresIn: number) {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: UID, aud: "authenticated", role: "authenticated", email: "member@example.org", app_metadata: { provider: "google" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" };
  const token = [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: UID, exp: now + expiresIn, iat: now, role: "authenticated" }), "c2ln"].join(".");
  return JSON.stringify({ access_token: token, token_type: "bearer", expires_in: expiresIn, expires_at: now + expiresIn, refresh_token: "r-synthetic", user });
}

type Answer = [number, unknown] | "offline";
function port(answers: Answer[], stored?: string) {
  const sent: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    sent.push(`${req.method} ${new URL(req.url).pathname}`);
    const a = answers.shift() ?? "offline";
    if (a === "offline") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(a[1]), { status: a[0], headers: { "content-type": "application/json" } });
  };
  const storage = memoryStorage(stored ? { [KEY]: stored } : {});
  return { p: new SupabasePort(URL_, "stub-publishable-key", { fetch: fetch as typeof globalThis.fetch, storage }), sent, storage };
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof PortError ? `PortError:${e.code}` : `raw:${String(e)}`;
  }
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SupabasePort, without a connection", () => {
  it("nobody signed in: «signed_out», without a request; nobody is the device's user", async () => {
    const { p, sent } = port([]);
    expect(await p.whoami()).toEqual({ status: "signed_out" });
    expect(sent).toEqual([]);
    expect(p.deviceUserId()).toBeNull();
  });

  it("the device's user is read from the stored session alone; a malformed one is nobody", () => {
    expect(port([], session(3600)).p.deviceUserId()).toBe(UID);
    expect(port([], session(-3600)).p.deviceUserId()).toBe(UID); // expired, still this device's
    expect(port([], "{not json").p.deviceUserId()).toBeNull();
    expect(port([], JSON.stringify({ user: { id: UID } })).p.deviceUserId()).toBeNull(); // no refresh token: no session
  });

  it("whoami with no answer at all is «network»; with an answer that refuses it is that answer", async () => {
    expect(await failure(port(["offline"], session(3600)).p.whoami())).toBe(`PortError:${NETWORK}`);
    expect(await failure(port([[401, { code: "PGRST301", message: "JWT expired" }]], session(3600)).p.whoami())).toBe("PortError:PGRST301");
    expect(await failure(port([[404, { code: "PGRST202", message: "no function" }]], session(3600)).p.whoami())).toBe("PortError:PGRST202");
    const ok = port([[200, { status: "not_member", schema_version: 10 }]], session(3600));
    expect(await ok.p.whoami()).toEqual({ status: "not_member", schema_version: 10 });
  });

  it("an expired token that cannot be refreshed for want of a network is «network», not a sign-out — and the session stays", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { p, storage } = port([], session(-3600));
    const answer = failure(p.whoami());
    await vi.advanceTimersByTimeAsync(60_000); // auth-js retries its refresh with backoff for up to half a minute
    expect(await answer).toBe(`PortError:${NETWORK}`);
    expect(storage.data.has(KEY)).toBe(true);
    expect(p.deviceUserId()).toBe(UID);
  });

  it("an expired token the server refuses to refresh is a sign-out", async () => {
    const { p } = port([[400, { error: "invalid_grant", error_description: "Refresh Token Not Found" }]], session(-3600));
    expect(await p.whoami()).toEqual({ status: "signed_out" });
  });

  it("loading the week or the editions with no answer is «network»; a refusal is not", async () => {
    expect(await failure(port(["offline"], session(3600)).p.loadWeek(1))).toBe(`PortError:${NETWORK}`);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const editions = failure(port(["offline", "offline", "offline", "offline"], session(3600)).p.editions());
    await vi.advanceTimersByTimeAsync(60_000); // postgrest-js tries a GET again, with backoff
    expect(await editions).toBe(`PortError:${NETWORK}`);
    vi.useRealTimers();
    expect(await failure(port([[400, { code: "22P02", message: "bad input" }]], session(3600)).p.loadWeek(1))).toBe("PortError:22P02");
    expect(await failure(port([[401, { code: "PGRST301", message: "JWT expired" }]], session(3600)).p.editions())).toBe("PortError:PGRST301");
  });

  it("sign-out removes the stored session — also offline, with an expired token auth-js gives up on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { p, storage } = port([], session(-3600));
    const done = p.signOut();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;
    expect(storage.data.has(KEY)).toBe(false);
    expect(p.deviceUserId()).toBeNull();
    expect(await p.whoami()).toEqual({ status: "signed_out" });
  });

  it("the browser says there is no network: whoami and sign-out answer at once, without a request", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const signedIn = port([], session(-3600));
    expect(await failure(signedIn.p.whoami())).toBe(`PortError:${NETWORK}`);
    expect(signedIn.sent).toEqual([]);
    await signedIn.p.signOut();
    expect(signedIn.sent).toEqual([]);
    expect(signedIn.storage.data.has(KEY)).toBe(false);
    expect(await signedIn.p.whoami()).toEqual({ status: "signed_out" }); // nobody here: no network needed to say so
  });

  it("only an address back from the sign-in has an auth error to wait for", () => {
    expect(returnedFromAuth("https://site.example/?code=abc")).toBe(true);
    expect(returnedFromAuth("https://site.example/?error=access_denied&error_description=x")).toBe(true);
    expect(returnedFromAuth("https://site.example/#error=server_error&error_code=500")).toBe(true);
    expect(returnedFromAuth("https://site.example/#access_token=t")).toBe(true);
    expect(returnedFromAuth("https://site.example/")).toBe(false);
    expect(returnedFromAuth("https://site.example/kk?demo")).toBe(false);
  });

  it("signed out offline while auth-js was still retrying a refresh: when that refresh lands, the session goes again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fresh = JSON.parse(session(3600));
    const { p, storage, sent } = port(["offline", [200, fresh], [204, {}]], session(-3600)); // start-up's refresh fails once, then lands
    vi.stubGlobal("navigator", { onLine: false });
    await p.signOut();
    expect(storage.data.has(KEY)).toBe(false);
    vi.unstubAllGlobals(); // the connection is back
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(sent).toContain("POST /auth/v1/logout"));
    await vi.waitFor(() => expect(storage.data.has(KEY)).toBe(false));
    expect(sent.filter((x) => x.includes("/auth/v1/token"))).toHaveLength(2);
  });

  it("isNetworkError: no answer only", () => {
    expect(isNetworkError(new PortError(NETWORK, "x"))).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError(new PortError("PGRST202", "x"))).toBe(false);
    expect(isNetworkError(new PortError(null, "x"))).toBe(false);
    expect(isNetworkError(new TypeError("x is not a function"))).toBe(false);
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(false);
  });
});
