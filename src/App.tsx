import { useCallback, useEffect, useMemo, useState } from "react";
import { gateFor, gateForError, type Gate } from "./data/gate";
import { makePort } from "./data";
import { EXPECTED_SCHEMA_VERSION } from "./lib/schema";
import { ROLE_LABEL, topRole } from "./lib/labels";
import { Notice } from "./screens/Notice";
import { Shell } from "./screens/Shell";
import { SignIn } from "./screens/SignIn";
import { WeekScreen } from "./screens/WeekScreen";
import type { DataPort } from "./data/port";

type State = { kind: "loading" } | { kind: "gate"; gate: Gate; email: string | null } | { kind: "error"; message: string };

export default function App() {
  const port = useMemo(makePort, []);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const w = await port.whoami();
      const email = w.status === "signed_out" ? null : await port.sessionEmail();
      setState({ kind: "gate", gate: gateFor(w, EXPECTED_SCHEMA_VERSION), email });
    } catch (e) {
      const gate = gateForError(e, EXPECTED_SCHEMA_VERSION);
      if (gate) setState({ kind: "gate", gate, email: await port.sessionEmail() });
      else setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
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
      full={!!me}
      user={me ? { name: me.display_name || me.email, roleLabel: ROLE_LABEL[topRole(me)] } : null}
      onSignOut={signedIn && !demo ? () => void signOut() : undefined}
    >
      {state.kind === "loading" && <p className="text-ink-soft text-center mt-10">טוען…</p>}
      {state.kind === "error" && (
        <Notice title="משהו השתבש בטעינה" actions={[{ label: "לנסות שוב", onClick: () => void refresh() }]}>
          <p>לא הצלחנו לדבר עם השרת. אם זה חוזר, כדאי לספר למדריך/ה.</p>
          <p className="text-xs text-ink-faint" dir="ltr">
            {state.message}
          </p>
        </Notice>
      )}
      {state.kind === "gate" && <GateScreen port={port} gate={state.gate} email={state.email} busy={busy} onSignIn={signIn} onSignOut={signOut} />}
    </Shell>
  );
}

function GateScreen(props: {
  port: DataPort;
  gate: Gate;
  email: string | null;
  busy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const { gate, email } = props;
  switch (gate.screen) {
    case "signed_out":
      return <SignIn onSignIn={props.onSignIn} busy={props.busy} />;
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
            מי שמנהל את Supabase צריך להריץ שוב את הקובץ <bdi dir="ltr">supabase/schema.sql</bdi> ב-SQL Editor. ההרצה
            בטוחה וחוזרת על עצמה בלי נזק.
          </p>
        </Notice>
      );
    case "home":
      return <WeekScreen port={props.port} me={gate.me} />;
  }
}
