import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { gateFor, gateForError, handlesLogistics, handlesSpeakers, isSettingsAdmin, type Gate } from "./data/gate";
import { makePort } from "./data";
import type { Me } from "./data/types";
import { waitingForApproval } from "./domain/mine";
import type { Week } from "./domain/types";
import { EXPECTED_SCHEMA_VERSION } from "./lib/schema";
import { ROLE_LABEL, topRole } from "./lib/labels";
import { isNetworkError } from "./offline/network";
import { useShellWorker } from "./offline/register";
import type { WeekSnapshot } from "./offline/snapshot";
import { indexedDbKeyValue, OfflineCopy } from "./offline/store";
import { Notice } from "./screens/Notice";
import { ScreenBoundary } from "./screens/ScreenBoundary";
import { OfflineWeek } from "./screens/OfflineWeek";
import { SettingsScreen } from "./screens/settings/SettingsScreen";
import { type NavItem, Shell, UpdateBanner } from "./screens/Shell";
import { SignIn } from "./screens/SignIn";
import { ApprovalsScreen } from "./screens/speakers/ApprovalsScreen";
import { MineScreen } from "./screens/speakers/MineScreen";
import { WeekScreen } from "./screens/WeekScreen";
import { WeekCtx, type WeekStore, useWeekStoreState } from "./screens/weekStore";
import type { DataPort } from "./data/port";

// The outputs, «ידע» and «עזרה» load on first visit: the week stays as light as it was on a phone.
const TrackingScreen = lazy(() => import("./screens/outputs/TrackingScreen").then((m) => ({ default: m.TrackingScreen })));
const EscortsScreen = lazy(() => import("./screens/outputs/EscortsScreen").then((m) => ({ default: m.EscortsScreen })));
const DesignerScreen = lazy(() => import("./screens/outputs/DesignerScreen").then((m) => ({ default: m.DesignerScreen })));
const KnowledgeScreen = lazy(() => import("./screens/knowledge/KnowledgeScreen").then((m) => ({ default: m.KnowledgeScreen })));
const SummaryScreen = lazy(() => import("./screens/knowledge/SummaryScreen").then((m) => ({ default: m.SummaryScreen })));
const HelpScreen = lazy(() => import("./screens/HelpScreen").then((m) => ({ default: m.HelpScreen })));
const KkScreen = lazy(() => import("./screens/kk/KkScreen").then((m) => ({ default: m.KkScreen })));
const ReaderScreen = lazy(() => import("./screens/reader/ReaderScreen").then((m) => ({ default: m.ReaderScreen })));
const MemorialScreen = lazy(() => import("./screens/memorial/MemorialScreen").then((m) => ({ default: m.MemorialScreen })));
const LogisticsScreen = lazy(() => import("./screens/logistics/LogisticsScreen").then((m) => ({ default: m.LogisticsScreen })));

/** How long the first check may go unanswered before the device's snapshot is shown meanwhile (src/offline/). */
const SLOW_FIRST_CHECK_MS = 8000;

type State =
  | { kind: "loading" }
  | { kind: "gate"; gate: Gate; email: string | null }
  /**
   * `network`: no answer at all (and no snapshot here to show) — tried again when the connection returns. `newer`: a
   * copy saved by a newer build of the site is on the device, which this one cannot show (the waiting worker can).
   */
  | { kind: "error"; message: string; network?: boolean; newer?: boolean }
  /** No connection: the day view from the device's snapshot, read-only, until the server answers again (src/offline/). */
  | { kind: "offline"; snapshot: WeekSnapshot; me: Me };

export default function App() {
  const port = useMemo(makePort, []);
  // The device's copy of the week for a day without internet — the real database only: the demo's data is in memory.
  const offline = useMemo(() => (port.mode === "live" ? new OfflineCopy(indexedDbKeyValue(), () => port.deviceUserId(), EXPECTED_SCHEMA_VERSION) : null), [port]);
  const update = useShellWorker();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const path = useLocation().pathname;
  const shown = useRef<State>(state);
  shown.current = state;

  /**
   * No answer from the server: the device's snapshot, when it may be shown here (its own user's, this schema's) —
   * and only while the screen is still the one it was asked from (`still`): an answer that came meanwhile wins.
   * "newer": a newer build's copy is here, kept — the screen says so (and offers the waiting worker's «רענון»).
   */
  const showOffline = useCallback(
    async (still: (s: State) => boolean): Promise<"shown" | "newer" | "none"> => {
      const d = offline ? await offline.decide() : null;
      if (d?.kind === "newer") return "newer";
      if (d?.kind !== "show" || !still(shown.current)) return "none";
      setState({ kind: "offline", snapshot: d.snapshot, me: d.me });
      return "shown";
    },
    [offline],
  );

  const refresh = useCallback(async () => {
    // A first check that hangs (a network that takes requests and never answers) shows the snapshot meanwhile;
    // the check goes on, and its answer still decides.
    const slow = window.setTimeout(() => {
      if (shown.current.kind === "loading") void showOffline((s) => s.kind === "loading");
    }, SLOW_FIRST_CHECK_MS);
    try {
      const w = await port.whoami();
      const email = w.status === "signed_out" ? null : await port.sessionEmail();
      if (w.status === "signed_out") setAuthError(await port.authError());
      const gate = gateFor(w, EXPECTED_SCHEMA_VERSION);
      // The server's answer decides: a member's whoami is kept for the day without internet; any other answer
      // (signed out, not a member, another provider, another schema) leaves nothing on the device.
      if (gate.screen === "home") void offline?.saveWhoami(gate.me);
      else void offline?.clear();
      setState({ kind: "gate", gate, email });
    } catch (e) {
      const gate = gateForError(e, EXPECTED_SCHEMA_VERSION);
      if (gate) {
        void offline?.clear();
        setState({ kind: "gate", gate, email: await port.sessionEmail() });
        return;
      }
      // A blip on a later check (back to the tab, a flaky network) keeps the
      // screen people are working in — the offline day view included; only a
      // first load shows the snapshot (no connection) or the error page.
      if (shown.current.kind === "gate" || shown.current.kind === "offline") return;
      const network = isNetworkError(e);
      const copy = network ? await showOffline((s) => s.kind === "loading" || s.kind === "error") : "none";
      if (copy === "shown") return;
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e), network, newer: copy === "newer" });
    } finally {
      window.clearTimeout(slow);
    }
  }, [port, offline, showOffline]);

  useEffect(() => {
    void refresh();
    return port.onAuthChange(() => void refresh());
  }, [port, refresh]);

  // Offline: back to the live week by itself — when the browser says the connection is back, and every half minute.
  const isOffline = state.kind === "offline" || (state.kind === "error" && !!state.network);
  useEffect(() => {
    if (!isOffline) return;
    const retry = () => void refresh();
    window.addEventListener("online", retry);
    const timer = window.setInterval(retry, 30_000);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(timer);
    };
  }, [isOffline, refresh]);

  const signIn = async () => {
    setBusy(true);
    try {
      await port.signInWithGoogle();
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  const signOut = async () => {
    // The snapshot and the cached whoami go with the session: before (nothing to show while it signs out), and after
    // (a load that was on its way meanwhile is undone, src/offline/store.ts).
    await offline?.clear();
    try {
      await port.signOut();
    } finally {
      await offline?.clear();
    }
    await refresh();
  };

  const demo = port.mode === "demo";
  const signedIn = (state.kind === "gate" && state.gate.screen !== "signed_out") || state.kind === "offline";
  const me = state.kind === "gate" && state.gate.screen === "home" ? state.gate.me : null;
  // One loaded edition for the week, «המרצים שלי» and the approvals queue (src/screens/weekStore.tsx); every
  // load is kept on the device for a day without internet.
  const store = useWeekStoreState(port, me ? me.email : null, offline ? (id, week) => void offline.saveWeek(id, week) : undefined);
  // The week itself could not be loaded for want of a connection: the snapshot, if there is one for this member.
  const { lostConnection } = store;
  useEffect(() => {
    if (lostConnection) void showOffline((s) => s.kind === "gate" && s.gate.screen === "home");
  }, [lostConnection, showOffline]);
  const offlineMe = state.kind === "offline" ? state.me : null;
  const header = me ?? offlineMe;
  // Back from «הגדרות»: an edition may have been opened, renamed or re-dated there.
  const inSettings = path.startsWith("/settings");
  const wasInSettings = useRef(inSettings);
  const { refresh: refreshWeek } = store;
  useEffect(() => {
    if (wasInSettings.current && !inSettings) void refreshWeek();
    wasInSettings.current = inSettings;
  }, [inSettings, refreshWeek]);

  return (
    <WeekCtx.Provider value={store}>
      <Shell
        demo={demo}
        full={(!!me && (path === "/" || path === "/tracking")) || !!offlineMe}
        user={header ? { name: header.display_name || header.email, roleLabel: ROLE_LABEL[topRole(header)] } : null}
        nav={me ? navFor(me, store.week) : undefined}
        onSignOut={signedIn && !demo ? () => void signOut() : undefined}
        notice={update.ready ? <UpdateBanner onApply={update.apply} /> : undefined}
      >
        {state.kind === "loading" && <p className="text-ink-soft text-center mt-10">טוען…</p>}
        {state.kind === "error" && (
          <Notice
            title={state.network ? "אין חיבור לאינטרנט" : "משהו השתבש בטעינה"}
            actions={[
              // a newer build's copy is here: the waiting worker's «רענון» brings the build that shows it
              ...(state.network && state.newer && update.ready ? [{ label: "רענון", onClick: update.apply }] : []),
              { label: "לנסות שוב", onClick: () => void refresh() },
              ...(demo ? [] : [{ label: "התנתקות", onClick: () => void signOut() }]),
            ]}
          >
            {state.network && state.newer ? (
              <div data-newer-copy className="space-y-2">
                <p>
                  {update.ready
                    ? "אין חיבור לאינטרנט. במכשיר יש עותק מגרסה חדשה יותר של האתר — «רענון» מציג אותו."
                    : "אין חיבור לאינטרנט. במכשיר יש עותק מגרסה חדשה יותר של האתר, והגרסה שנפתחה עכשיו לא יכולה להציג אותו. כשהחיבור חוזר, המסך נטען לבד."}
                </p>
                {!demo && <p>«התנתקות» מוחקת גם את העותק הזה מהמכשיר.</p>}
              </div>
            ) : state.network ? (
              <p>אין חיבור לאינטרנט, ובמכשיר הזה עוד אין עותק של השבוע. העותק נשמר בכל פעם שהשבוע נטען עם חיבור. כשהחיבור חוזר, המסך נטען לבד.</p>
            ) : (
              <p>לא הצלחנו לדבר עם השרת. אם זה חוזר, כדאי לספר למדריך/ה.</p>
            )}
            <p className="text-xs text-ink-faint" dir="ltr">
              {state.message}
            </p>
          </Notice>
        )}
        {state.kind === "offline" && <OfflineWeek snapshot={state.snapshot} path={path} />}
        {state.kind === "gate" && (
          <GateScreen port={port} gate={state.gate} email={state.email} busy={busy} authError={authError} onSignIn={signIn} onSignOut={signOut} onRefresh={refresh} store={store} />
        )}
      </Shell>
    </WeekCtx.Provider>
  );
}

/**
 * The header's sections: what this member may open. The approvals queue is a global admin's (only they vet
 * speakers and decide payment and transport); its badge counts what holds the team up — speakers who agreed and
 * wait for the approval before their time is closed, and the requests (src/domain/mine.ts waitingForApproval).
 * «המרצים שלי» holds the team's board too (/mine/team), so the header keeps its ten sections.
 */
function navFor(me: Me, week: Week | null): NavItem[] {
  const items: NavItem[] = [{ to: "/", label: "השבוע" }];
  if (handlesSpeakers(me)) items.push({ to: "/mine", label: "המרצים שלי" });
  // the outputs (milestone 4): the tracking table, the escorts' list, the designer's export — one section
  items.push({ to: "/tracking", label: "תוצרים", match: ["/tracking", "/print/", "/export/", "/reader"] });
  // the logistics team's lists (5ב-2): transports, payments, books, prints — logistics and admins
  if (handlesLogistics(me)) items.push({ to: "/logistics", label: "לוגיסטיקה" });
  // memorial times (5ב-2): every member reads them; admins plan and place
  items.push({ to: "/memorial", label: "זמני זיכרון" });
  // מכריכה לכריכה (milestone 5a): every member reads it; admins write, logistics the book orders
  items.push({ to: "/kk", label: "מכריכה לכריכה" });
  items.push({ to: "/knowledge", label: "ידע" });
  if (me.global_admin) {
    const waiting = week ? waitingForApproval(week) : 0;
    items.push({ to: "/approvals", label: "אישורים", badge: waiting, badgeLabel: waiting === 1 ? "ממתין" : "ממתינים" });
  }
  if (isSettingsAdmin(me)) items.push({ to: "/settings", label: "הגדרות" });
  items.push({ to: "/help", label: "עזרה" });
  return items;
}

function GateScreen(props: {
  port: DataPort;
  gate: Gate;
  email: string | null;
  busy: boolean;
  authError: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  /** Re-reads whoami() — after an admin renames themselves, the header follows. */
  onRefresh: () => Promise<void>;
  store: WeekStore;
}) {
  const { gate, email } = props;
  switch (gate.screen) {
    case "signed_out":
      return <SignIn onSignIn={props.onSignIn} busy={props.busy} error={props.authError} />;
    case "wrong_provider":
      return (
        <Notice title="הכניסה רק עם Google" actions={[{ label: "התנתקות", onClick: props.onSignOut }]}>
          <p>החשבון הזה לא נכנס דרך Google. צריך להתנתק ולהיכנס שוב עם חשבון Google.</p>
        </Notice>
      );
    case "not_member":
      return (
        <Notice title="הכתובת עדיין לא ברשימת הצוות" actions={[{ label: "התנתקות", onClick: props.onSignOut }]}>
          <p>
            נכנסת עם <bdi className="font-semibold">{email ?? "חשבון Google"}</bdi>, והכתובת הזו לא מופיעה ברשימת הצוות.
          </p>
          <p>כדאי לפנות למדריך/ה כדי שיוסיפו אותה, או להתנתק ולהיכנס עם חשבון אחר.</p>
        </Notice>
      );
    case "schema_stale":
      return (
        <Notice title="מסד הנתונים לא מעודכן">
          <p>
            גרסת מסד הנתונים היא {gate.have} והמערכת צריכה גרסה {gate.want}.
          </p>
          <p>
            מי שמנהל/ת את Supabase צריך/ה להריץ שוב את הקובץ <bdi dir="ltr">supabase/schema.sql</bdi> ב-SQL Editor. ההרצה
            בטוחה וחוזרת על עצמה בלי נזק.
          </p>
        </Notice>
      );
    case "home":
      // The gate above stays in front of every route. «הגדרות» is for admins
      // only, the approvals queue for a global admin, «המרצים שלי» (both its tabs) for
      // whoever handles speakers; anyone else who opens one lands on the week. The
      // outputs, זמני זיכרון, מכריכה לכריכה, «ידע» and «עזרה» are every member's — the designer's export an
      // admin's, the reader content's and admins', «לוגיסטיקה» logistics' and admins' (the screens also check the
      // edition on screen).
      return (
        <ScreenBoundary>
        <Suspense fallback={<p className="text-ink-soft text-center mt-10">טוען…</p>}>
        <Routes>
          <Route path="/" element={<WeekScreen port={props.port} me={gate.me} />} />
          <Route path="/mine/:tab?" element={handlesSpeakers(gate.me) ? <MineScreen port={props.port} me={gate.me} /> : <Navigate to="/" replace />} />
          <Route path="/approvals" element={gate.me.global_admin ? <ApprovalsScreen port={props.port} me={gate.me} /> : <Navigate to="/" replace />} />
          <Route path="/tracking" element={<TrackingScreen port={props.port} me={gate.me} />} />
          <Route path="/print/escorts" element={<EscortsScreen port={props.port} me={gate.me} />} />
          <Route path="/export/designer" element={isSettingsAdmin(gate.me) ? <DesignerScreen port={props.port} me={gate.me} /> : <Navigate to="/tracking" replace />} />
          <Route path="/reader" element={<ReaderScreen port={props.port} me={gate.me} />} />
          <Route path="/kk" element={<KkScreen port={props.port} me={gate.me} />} />
          <Route path="/memorial" element={<MemorialScreen port={props.port} me={gate.me} />} />
          <Route path="/logistics/:tab?" element={handlesLogistics(gate.me) ? <LogisticsScreen port={props.port} me={gate.me} /> : <Navigate to="/" replace />} />
          <Route path="/knowledge" element={<KnowledgeScreen port={props.port} me={gate.me} />} />
          <Route path="/knowledge/summary" element={<SummaryScreen port={props.port} me={gate.me} />} />
          <Route path="/help" element={<HelpScreen />} />
          <Route
            path="/settings/:tab?"
            element={
              isSettingsAdmin(gate.me) ? (
                <SettingsScreen port={props.port} me={gate.me} onMeChanged={props.onRefresh} onEditionStarted={(id) => void props.store.refresh(id)} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ScreenBoundary>
      );
  }
}
