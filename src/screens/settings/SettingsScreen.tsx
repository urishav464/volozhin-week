// «הגדרות» — admins run the year from here instead of the SQL Editor: the
// edition, the team, the trainees' roster, the rooms, the categories. One tab
// per path (/settings/<tab>); tabs on the side on a wide screen, a scrolling
// row on a phone. Everything goes through port.settings (src/data/settings.ts).
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { managedEditionIds } from "../../data/gate";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import type { Edition } from "../../domain/types";
import { useMedia } from "../../lib/useMedia";
import { CategoriesTab } from "./CategoriesTab";
import { EditionsTab } from "./EditionsTab";
import { Ctx, type SettingsContext } from "./kit";
import { RoomsTab } from "./RoomsTab";
import { RosterTab } from "./RosterTab";
import { TeamTab } from "./TeamTab";

const TABS = [
  { slug: "edition", label: "מחזור", globalOnly: false },
  { slug: "team", label: "צוות", globalOnly: false },
  { slug: "roster", label: "חניכים", globalOnly: false },
  { slug: "rooms", label: "חדרים", globalOnly: false },
  { slug: "categories", label: "קטגוריות", globalOnly: true },
] as const;
type Slug = (typeof TABS)[number]["slug"];

type Toast = { kind: "ok" | "error"; text: string; at: number } | null;

export function SettingsScreen({ port, me, onMeChanged }: { port: DataPort; me: Me; onMeChanged: () => Promise<void> | void }) {
  const { tab } = useParams();
  const navigate = useNavigate();
  const wide = useMedia("(min-width: 1024px)");
  const tabs = TABS.filter((t) => !t.globalOnly || me.global_admin);
  const current = tabs.find((t) => t.slug === tab);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const [editions, setEditions] = useState<Edition[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editionId, setEditionId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const loadEditions = useCallback(async () => {
    setLoadFailed(false);
    try {
      setEditions(await port.editions());
    } catch {
      setLoadFailed(true);
    }
  }, [port]);
  useEffect(() => void loadEditions(), [loadEditions]);

  // The editions whose team, roster and rooms this admin manages.
  const managed = useMemo(() => {
    if (!editions) return [];
    const ids = new Set(managedEditionIds(me, editions));
    return editions.filter((e) => ids.has(e.id));
  }, [editions, me]);
  useEffect(() => {
    if (managed.length && !managed.some((e) => e.id === editionId)) {
      setEditionId((managed.find((e) => e.status !== "archived") ?? managed[0]).id);
    }
  }, [managed, editionId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const ctx: SettingsContext = useMemo(
    () => ({ port: port.settings, me, wide, onMeChanged, notify: (kind, text) => setToast({ kind, text, at: Date.now() }), clear: () => setToast(null) }),
    [port, me, wide, onMeChanged],
  );

  // A tab opened by its address (/settings/categories) is scrolled into view on a narrow row.
  const slug = current?.slug;
  useEffect(() => {
    if (slug) tabRefs.current.get(slug)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [slug]);

  if (!tab) return <Navigate to="/settings/team" replace />;
  if (!current) return <Navigate to="/settings" replace />;

  const go = (to: Slug) => {
    setToast(null); // the last tab's news is not this tab's
    navigate(`/settings/${to}`);
    tabRefs.current.get(to)?.focus();
  };
  // Arrow keys move between tabs (right-to-left: ← is the next one), Home/End to the ends.
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.slug === current.slug);
    const next = { ArrowLeft: i + 1, ArrowDown: i + 1, ArrowRight: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    go(tabs[(next + tabs.length) % tabs.length].slug);
  };

  const body = (() => {
    if (loadFailed) return <p role="alert" className="text-bad">לא הצלחנו לטעון את המחזורים. כדאי לרענן את הדף.</p>;
    if (!editions) return <p className="py-6 text-center text-ink-soft">טוען…</p>;
    const picked = { editions: managed, editionId, setEditionId };
    switch (current.slug) {
      case "edition":
        return <EditionsTab editions={editions} reload={loadEditions} onStarted={(id) => setEditionId(id)} />;
      case "team":
        return <TeamTab {...picked} />;
      case "roster":
        return <RosterTab {...picked} />;
      case "rooms":
        return <RoomsTab {...picked} />;
      case "categories":
        return <CategoriesTab />;
    }
  })();

  return (
    <Ctx.Provider value={ctx}>
      <div className="mx-auto max-w-5xl">
        <h2 className="mb-3 font-display text-2xl font-extrabold">הגדרות</h2>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div
            role="tablist"
            aria-label="אזורי ההגדרות"
            aria-orientation={wide ? "vertical" : "horizontal"}
            onKeyDown={onKey}
            className="flex gap-0.5 overflow-x-auto pb-1 sm:gap-1 lg:sticky lg:top-4 lg:w-44 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {tabs.map((t) => {
              const selected = t.slug === current.slug;
              return (
                <button
                  key={t.slug}
                  ref={(el) => {
                    if (el) tabRefs.current.set(t.slug, el);
                  }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${t.slug}`}
                  aria-selected={selected}
                  aria-controls="settings-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => go(t.slug)}
                  className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-2 text-start font-semibold transition-colors sm:px-4 ${
                    selected ? "bg-ink text-paper" : "text-ink-soft hover:bg-line/60 hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {/* pb-20: on a phone the last control stays clear of a toast */}
          <div role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${current.slug}`} className="min-w-0 flex-1 space-y-4 pb-20 lg:pb-0">
            {body}
          </div>
        </div>
      </div>

      {toast && (
        <div
          key={toast.at}
          role={toast.kind === "error" ? "alert" : "status"}
          className={`fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-xl ${
            toast.kind === "error" ? "bg-bad text-paper" : "bg-ink text-paper"
          }`}
        >
          <span>{toast.text}</span>
          <button type="button" aria-label="סגירת ההודעה" onClick={() => setToast(null)} className="-my-1.5 -me-2 inline-flex size-11 items-center justify-center rounded-md text-lg leading-none hover:bg-paper/10">
            ×
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
