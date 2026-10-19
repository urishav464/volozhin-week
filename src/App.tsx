import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { gateFor, gateForError, isSettingsAdmin, type Gate } from "./data/gate";
import { makePort } from "./data";
import { EXPECTED_SCHEMA_VERSION } from "./lib/schema";
import { ROLE_LABEL, topRole } from "./lib/labels";
import { Notice } from "./screens/Notice";
import { SettingsScreen } from "./screens/settings/SettingsScreen";
import { Shell } from "./screens/Shell";
import { SignIn } from "./screens/SignIn";
import { WeekScreen } from "./screens/WeekScreen";
import type { DataPort } from "./data/port";

type State = { kind: "loading" } | { kind: "gate"; gate: Gate; email: string | null } | { kind: "error"; message: string };

export default function App() {
  const port = useMemo(makePort, []);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const atWeek = useLocation().pathname === "/";
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

  return (
    <Shell
      demo={demo}
      full={!!me && atWeek}
      user={me ? { name: me.display_name || me.email, roleLabel: ROLE_LABEL[topRole(me)] } : null}
      settingsLink={!!me && isSettingsAdmin(me)}
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
        <GateScreen port={port} gate={state.gate} email={state.email} busy={busy} authError={authError} onSignIn={signIn} onSignOut={signOut} onRefresh={refresh} />
      )}
    </Shell>
  );
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
      // only; anyone else who opens it lands on the week.
      return (
        <Routes>
          <Route path="/" element={<WeekScreen port={props.port} me={gate.me} />} />
          <Route
            path="/settings/:tab?"
            element={isSettingsAdmin(gate.me) ? <SettingsScreen port={props.port} me={gate.me} onMeChanged={props.onRefresh} /> : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      );
  }
}
