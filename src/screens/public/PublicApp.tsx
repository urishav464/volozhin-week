// A link's public page — /e (an escort), /k (the sign-up for מכריכה לכריכה), /s
// (the schedule). Outside the team's sign-in gate: nobody signs in, no session
// is read, and the only calls are the anon functions (PublicPort, loaded by
// src/data/publicEntry.ts). The token arrives from src/Root.tsx, already out of
// the address bar.
import { useEffect, useState } from "react";
import type { LinkScope } from "../../data/links";
import { loadPublicPort } from "../../data/publicEntry";
import type { PublicPort } from "../../data/publicPort";
import { EscortPage } from "./EscortPage";
import { KkSignupPage } from "./KkSignupPage";
import { LinkMissing, LoadFailed, Loading, PublicFrame } from "./parts";
import { SchedulePage } from "./SchedulePage";

const TITLE: Record<LinkScope, string> = { escort: "הדף שלך כמלווה", kk_signup: "הרשמה למכריכה לכריכה", schedule: 'לו"ז' };

export default function PublicApp({ scope, token }: { scope: LinkScope; token: string | null }) {
  const [port, setPort] = useState<PublicPort | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    loadPublicPort().then(
      (p) => live && setPort(p),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  useEffect(() => {
    document.title = `${TITLE[scope]} · שבוע וולוז'ין`;
  }, [scope]);

  const body = () => {
    if (token == null) return <LinkMissing />;
    if (failed) return <LoadFailed onRetry={() => setAttempt((n) => n + 1)} />;
    if (!port) return <Loading />;
    switch (scope) {
      case "escort":
        return <EscortPage port={port} token={token} />;
      case "kk_signup":
        return <KkSignupPage port={port} token={token} />;
      case "schedule":
        return <SchedulePage port={port} token={token} />;
    }
  };
  return <PublicFrame>{body()}</PublicFrame>;
}
