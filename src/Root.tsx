// Which app a path opens: /e, /k and /s are the public pages of a link without
// an account — outside the sign-in gate, reading through the anon functions
// alone (src/screens/public/) — and everything else is the team's app. Both load
// on demand, so opening a link downloads neither the team's screens nor
// supabase-js, and starts no auth client.
import { lazy, Suspense, useLayoutEffect, useState } from "react";
import { useLocation } from "react-router";
import type { LinkScope } from "./data/links";
import { publicScopeOf, tokenOf } from "./screens/public/token";

const App = lazy(() => import("./App"));
const PublicApp = lazy(() => import("./screens/public/PublicApp"));

const loading = <p className="mt-10 text-center text-ink-soft">טוען…</p>;

export function Root() {
  const location = useLocation();
  const scope = publicScopeOf(location.pathname);
  return <Suspense fallback={loading}>{scope ? <PublicRoute key={location.key} scope={scope} /> : <App />}</Suspense>;
}

/** The token in the address bar, if any — taken out of it at once (history.replaceState: no new entry, nothing saved). */
function takeToken(): string | null {
  const t = tokenOf(window.location.hash);
  if (t != null) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return t;
}

/**
 * Takes the token out of the hash before anything else happens and keeps it in memory for the page. Keyed by the
 * navigation, so another link opened in the same tab is read afresh — also one that only changes the hash (the
 * browser then keeps the page: `hashchange`). Reading twice (React's strict mode) keeps what was read first.
 */
function PublicRoute({ scope }: { scope: LinkScope }) {
  const [token, setToken] = useState<{ value: string | null; n: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const t = takeToken();
    setToken((cur) => (t != null ? { value: t, n: (cur?.n ?? 0) + 1 } : (cur ?? { value: null, n: 0 })));
    const again = () => {
      const next = takeToken();
      if (next != null) setToken((cur) => ({ value: next, n: (cur?.n ?? 0) + 1 }));
    };
    window.addEventListener("hashchange", again);
    return () => window.removeEventListener("hashchange", again);
  }, []);
  if (token === undefined) return loading;
  return <PublicApp key={token.n} scope={scope} token={token.value} />;
}
