// The public pages' addresses — /e#<token>, /k#<token>, /s#<token> — and reading
// the token out of the hash. The token never travels in the path or the query
// (no server log, no Referer); the page takes it from the hash, removes it from
// the address bar at once (history.replaceState) and keeps it in memory only.
import type { LinkScope } from "../../data/links";

const PATHS: Record<string, LinkScope> = { "/e": "escort", "/k": "kk_signup", "/s": "schedule" };

/** Which public page a path is, or null for the team's app. A trailing slash is forgiven. */
export function publicScopeOf(pathname: string): LinkScope | null {
  return PATHS[pathname.replace(/\/+$/, "")] ?? null;
}

/** The token in a location's hash («#abc…»), or null when there is none. */
export function tokenOf(hash: string): string | null {
  const raw = hash.replace(/^#/, "").trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
