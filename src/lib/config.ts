// The only build variables: the project URL and its PUBLISHABLE key, set in
// Cloudflare Pages (Production). Preview builds have neither and run on demo
// data, so a preview link is always safe to share.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfig: { url: string; key: string } | null = url && key ? { url, key } : null;

// `?demo` forces demo data even on a configured build.
export const demoRequested = new URLSearchParams(window.location.search).has("demo");
