// The offline shell's switches and names — shared by the build (src/offline/swBuild.ts writes /sw.js), the
// worker itself (src/offline/sw.ts) and the app that registers it (src/offline/register.ts).

/**
 * The kill switch. `false` makes the build write a /sw.js that deletes this site's caches and unregisters itself
 * (`killWorker`, src/offline/sw.ts), and makes the app unregister any worker it finds — for the day a worker
 * misbehaves. Flip, commit, deploy: every browser fetches /sw.js afresh (no-cache, public/_headers) on its next visit.
 * docs/DECISIONS.md «אבן דרך 5ב-2, חלק ב: בלי רשת».
 */
export const OFFLINE_SHELL_ENABLED = true;

/** Every cache this site makes starts with this; the kill switch and `activate` delete by it. */
export const CACHE_PREFIX = "volozhin-";
/** The app shell's cache: `volozhin-shell-<the build's version>` — a new build, a new cache. */
export const SHELL_CACHE_PREFIX = `${CACHE_PREFIX}shell-`;
/** Google Fonts' files and CSS (public, no personal data), kept across builds. */
export const FONT_CACHE = `${CACHE_PREFIX}fonts`;
/** Where the fonts come from — the only other origins the worker answers for. */
export const FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];
/** The message the update banner's «רענון» sends the waiting worker. */
export const SKIP_WAITING = "skip-waiting";
/**
 * How long a navigation waits for the network before the worker answers with the cached shell (a network that takes
 * the request and never answers: crowded Wi-Fi, one bar, a captive portal). A technical choice, not a policy: the app's
 * own 8 seconds (SLOW_FIRST_CHECK_MS) then decide between the live week and the device's copy.
 */
export const NAVIGATE_TIMEOUT_MS = 3500;
