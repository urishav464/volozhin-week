// A screen that loads on first visit (App.tsx's lazy routes) whose file is no longer there — a tab left on the previous
// version after a deploy, whose files went with it (Cloudflare Pages then answers the old name with index.html): not
// a blank page, but a plain notice with «רענון», the header and its navigation still in place. This predates the
// offline shell (any tab open across a deploy); the shell's worker spares the one-tab case, not a second tab left
// behind after another pressed «רענון». Any other error goes on as before.
import { Component, type ReactNode } from "react";
import { useLocation } from "react-router";
import { Notice } from "./Notice";

/** A dynamic import that failed — as Chromium, Firefox and Safari word it, and Vite's preload helper. */
export function isChunkLoadError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : "";
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(m);
}

class Boundary extends Component<{ path: string; children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  // another address starts afresh — without remounting the screens (a key would: a settings tab's keyboard focus,
  // a half-typed field, would go with it)
  componentDidUpdate(prev: { path: string }) {
    if (prev.path !== this.props.path && this.state.error != null) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (error == null) return this.props.children;
    if (!isChunkLoadError(error)) throw error;
    return (
      <Notice title="המסך הזה לא נטען" actions={[{ label: "רענון", onClick: () => window.location.reload() }]}>
        <p>כנראה שהאתר התעדכן מאז שהדף נפתח, והקבצים של הגרסה הקודמת כבר לא שם. «רענון» טוען את הגרסה החדשה.</p>
      </Notice>
    );
  }
}

/** Moving to another address after a failure starts afresh. */
export function ScreenBoundary({ children }: { children: ReactNode }) {
  const path = useLocation().pathname;
  return <Boundary path={path}>{children}</Boundary>;
}
