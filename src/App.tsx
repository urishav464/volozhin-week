import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { gateFor, gateForError, handlesSpeakers, isSettingsAdmin, type Gate } from "./data/gate";
import { makePort } from "./data";
import type { Me } from "./data/types";
import { waitingForApproval } from "./domain/mine";
import type { Week } from "./domain/types";
import { EXPECTED_SCHEMA_VERSION } from "./lib/schema";
import { ROLE_LABEL, topRole } from "./lib/labels";
import { Notice } from "./screens/Notice";
import { SettingsScreen } from "./screens/settings/SettingsScreen";
import { type NavItem, Shell } from "./screens/Shell";
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
const HelpScreen = lazy(() => import("./screens/HelpScreen").then((m) => ({ default: m.HelpScreen })));
const KkScreen = lazy(() => import("./screens/kk/KkScreen").then((m) => ({ default: m.KkScreen })));
const ReaderScreen = lazy(() => import("./screens/reader/ReaderScreen").then((m) => ({ default: m.ReaderScreen })));

type State = { kind: "loading" } | { kind: "gate"; gate: Gate; email: string | null } | { kind: "error"; message: string };

export default function App() {
  const port = useMemo(makePort, []);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const path = useLocation().pathname;
  const shown = useRef<State>(state);
  shown.current = state;

  const refresh = useCallback(async () => {
    try {
      const w = await port.whoami();
      const email = w.status === "signed_out" ? null : await port.sessionEmail();
      if (w.status === "signed_out") setAuthError(await port.authError());
      setState({ kind: "gate", gate: gateFor(w, EXPECTED_SCHEMA_VERSION), email });
    } catch (e) {
      const gate = gateForError(e, EXPECTED_SCHEMA_VERSION);
      if (gate) setState({ kind: "gate", gate, email: await port.sessionEmail() });
      // A blip on a later check (back to the tab, a flaky network) keeps the
      // screen people are working in; only a first load shows the error page.
      else if (shown.current.kind !== "gate") setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [port]);

  useEffect(() => {
    void refresh();
    return port.onAuthChange(() => void refresh());
  }, [port, refresh]);

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
    await port.signOut();
    await refresh();
  };

  const demo = port.mode === "demo";
  const signedIn = state.kind === "gate" && state.gate.screen !== "signed_out";
  const me = state.kind === "gate" && state.gate.screen === "home" ? state.gate.me : null;
  // One loaded edition for the week, «המרצים שלי» and the approvals queue (src/screens/weekStore.tsx).
  const store = useWeekStoreState(port, me ? me.email : null);
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
        full={!!me && (path === "/" || path === "/tracking")}
        user={me ? { name: me.display_name || me.email, roleLabel: ROLE_LABEL[topRole(me)] } : null}
        nav={me ? navFor(me, store.week) : undefined}
        onSignOut={signedIn && !demo ? () => void signOut() : undefined}
      >
        {state.kind === "loading" && <p className="text-ink-soft text-center mt-10">טוען…</p>}
        {state.kind === "error" && (
          <Notice
            title="משהו השתבש בטעינה"
            actions={[{ label: "לנסות שוב", onClick: () => void refresh() }, ...(demo ? [] : [{ label: "התנתקות", onClick: () => void signOut() }])]}
          >
            <p>לא הצלחנו לדבר עם השרת. אם זה חוזר, כדאי לספר למדריך/ה.</p>
            <p className="text-xs text-ink-faint" dir="ltr">
              {state.message}
            </p>
          </Notice>
        )}
        {state.kind === "gate" && (
          <GateScreen port={port} gate={state.gate} email={state.email} busy={busy} authError={authError} onSignIn={signIn} onSignOut={signOut} onRefresh={refresh} store={store} />
        )}
      </Shell>
    </WeekCtx.Provider>
  );
}

/**
 * The header's sections: what this member may open. The approvals queue is a global admin's (only they vet
 * speakers and decide payment and transport); its badge counts both.
 */
function navFor(me: Me, week: Week | null): NavItem[] {
  const items: NavItem[] = [{ to: "/", label: "השבוע" }];
  if (handlesSpeakers(me)) items.push({ to: "/mine", label: "המרצים שלי" });
  // the outputs (milestone 4): the tracking table, the escorts' list, the designer's export — one section
  items.push({ to: "/tracking", label: "תוצרים", match: ["/tracking", "/print/", "/export/", "/reader"] });
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
      // only, the approvals queue for a global admin, «המרצים שלי» for whoever
      // handles speakers; anyone else who opens one lands on the week. The
      // outputs, מכריכה לכריכה, «ידע» and «עזרה» are every member's — the designer's export an
      // admin's, the reader content's and admins' (the screens also check the edition on screen).
      return (
        <Suspense fallback={<p className="text-ink-soft text-center mt-10">טוען…</p>}>
        <Routes>
          <Route path="/" element={<WeekScreen port={props.port} me={gate.me} />} />
          <Route path="/mine" element={handlesSpeakers(gate.me) ? <MineScreen port={props.port} me={gate.me} /> : <Navigate to="/" replace />} />
          <Route path="/approvals" element={gate.me.global_admin ? <ApprovalsScreen port={props.port} me={gate.me} /> : <Navigate to="/" replace />} />
          <Route path="/tracking" element={<TrackingScreen port={props.port} me={gate.me} />} />
          <Route path="/print/escorts" element={<EscortsScreen port={props.port} me={gate.me} />} />
          <Route path="/export/designer" element={isSettingsAdmin(gate.me) ? <DesignerScreen port={props.port} me={gate.me} /> : <Navigate to="/tracking" replace />} />
          <Route path="/reader" element={<ReaderScreen port={props.port} me={gate.me} />} />
          <Route path="/kk" element={<KkScreen port={props.port} me={gate.me} />} />
          <Route path="/knowledge" element={<KnowledgeScreen port={props.port} me={gate.me} />} />
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
      );
  }
}
