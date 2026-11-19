// The only build variables: the project URL and its PUBLISHABLE key, set in
// Cloudflare Pages (Production). Preview builds have neither and run on demo
// data, so a preview link is always safe to share.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfig: { url: string; key: string } | null = url && key ? { url, key } : null;

// `?demo` forces demo data even on a configured build.
export const demoRequested = new URLSearchParams(window.location.search).has("demo");

/**
 * `?as=trainee` / `?as=logistics` (demo builds only, read once when the page loads): the demo acts as a trainee who owns
 * days with a partner (the reset's phase 2), or as the edition's logistics member (phase 3: «אישורים» and the transport
 * board) — the PR's Cloudflare preview opens with either. A configured build ignores it (src/data/index.ts uses it only
 * for the demo). The tab remembers it (sessionStorage), so a reload or an address typed later stays the same persona;
 * `?as=` with anything else (`?as=staff`) goes back to the instructor.
 */
export type DemoAs = "trainee" | "logistics";
export const demoAs: DemoAs | null = readDemoAs(new URLSearchParams(window.location.search).get("as"));

// a function declaration, hoisted: `demoAs` above calls it while the module is still being evaluated
function isDemoAs(v: string | null): v is DemoAs {
  return v === "trainee" || v === "logistics";
}

function readDemoAs(asked: string | null): DemoAs | null {
  const KEY = "volozhin-demo-as";
  try {
    if (isDemoAs(asked)) window.sessionStorage.setItem(KEY, asked);
    else if (asked != null) window.sessionStorage.removeItem(KEY);
    if (isDemoAs(asked)) return asked;
    const kept = asked == null ? window.sessionStorage.getItem(KEY) : null;
    return isDemoAs(kept) ? kept : null;
  } catch {
    // no storage here (a private window, blocked site data): the address alone decides
    return isDemoAs(asked) ? asked : null;
  }
}
