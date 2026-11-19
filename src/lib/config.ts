// The only build variables: the project URL and its PUBLISHABLE key, set in
// Cloudflare Pages (Production). Preview builds have neither and run on demo
// data, so a preview link is always safe to share.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfig: { url: string; key: string } | null = url && key ? { url, key } : null;

// `?demo` forces demo data even on a configured build.
export const demoRequested = new URLSearchParams(window.location.search).has("demo");

/**
 * `?as=trainee` (demo builds only, read once when the page loads): the demo acts as a trainee who owns days with a
 * partner — the persona the reset's phase 2 is for; the PR's Cloudflare preview opens with it. A configured build
 * ignores it (src/data/index.ts uses it only for the demo). The tab remembers it (sessionStorage), so a reload or an
 * address typed later stays the trainee's; `?as=` with anything else (`?as=staff`) goes back to the instructor.
 */
export const demoAs: "trainee" | null = readDemoAs(new URLSearchParams(window.location.search).get("as"));

function readDemoAs(asked: string | null): "trainee" | null {
  const KEY = "volozhin-demo-as";
  try {
    if (asked === "trainee") window.sessionStorage.setItem(KEY, "trainee");
    else if (asked != null) window.sessionStorage.removeItem(KEY);
    return asked === "trainee" || (asked == null && window.sessionStorage.getItem(KEY) === "trainee") ? "trainee" : null;
  } catch {
    // no storage here (a private window, blocked site data): the address alone decides
    return asked === "trainee" ? "trainee" : null;
  }
}
