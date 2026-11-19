// «אחרי השבוע» (`/after`, the reset, phase 3): «איך עבר» for MY closed lessons — the lessons whose speaker I handle
// (src/domain/handler.ts), in time order, each with where its window stands and, opened, the one form the lesson panel
// also uses (ReviewStage.tsx ReviewForm). An edition's admin (or a global one) may write any closed lesson at any time:
// «כל השיעורים» (`?all=1`) with «נכתב / עוד לא נכתב». The data is the loaded Week and ONE read of the edition's reviews
// (port.reviews.ofEdition — again after each save, never one per lesson). `?lesson=` opens that row and takes the focus
// there (from «סיכום המחזור»). Before any review can open a trainee sees one calm line. Content and admins only: logistics
// never reads an opinion about a person (App sends them to their home, /logistics; so does this page).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import type { DataPort } from "../../data/port";
import type { LessonReview } from "../../data/reviews";
import type { Me } from "../../data/types";
import { afterCounts, type AfterRow, afterRows } from "../../domain/after";
import { displayName } from "../../domain/names";
import { afterPath, parseAfterQuery } from "../../domain/routes";
import { reviewLine, reviewsOpen, reviewsOpenOn } from "../../domain/reviews";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import type { Week } from "../../domain/types";
import { LOGISTICS_HOME } from "../nav";
import { Button, useFocusRescue } from "../settings/kit";
import { EditionSelect, type Notify, useToast } from "../speakers/parts";
import { dateText, ReviewForm, reviewFormProps } from "../stages/ReviewStage";
import { actorIn, useWeekStore } from "../weekStore";

export function AfterScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { notify, clear, node } = useToast();
  const { week } = store;
  const actor = actorIn(me, week?.edition);

  let body;
  if (store.problem === "none") body = <p className="mt-6 text-ink-soft">עוד לא נפתח מחזור.</p>;
  else if (store.problem === "error") body = <p className="mt-10 text-center text-bad">לא הצלחנו לטעון את השבוע. כדאי לרענן את הדף.</p>;
  else if (!week) body = <p className="mt-10 text-center text-ink-soft">טוען…</p>;
  else if (actor.role === "logistics") return <Navigate replace to={LOGISTICS_HOME} />;
  else body = <Body key={week.edition.id} port={port} me={me} week={week} notify={notify} clear={clear} />;

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-extrabold text-navy">אחרי השבוע</h2>
        <EditionSelect />
      </div>
      <p className="text-ink-soft">איך עבר — מה עבד, מה פחות, והאם להזמין שוב.</p>
      {body}
      {node}
    </div>
  );
}

function Body({ port, me, week, notify, clear }: { port: DataPort; me: Me; week: Week; notify: Notify; clear: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const rescue = useFocusRescue();
  const query = useMemo(() => parseAfterQuery(location.search), [location.search]);
  const actor = actorIn(me, week.edition);
  const all = query.all && actor.isAdmin;
  // one «now» for the page: every row's window and every form's rule read the same moment
  const [nowIso] = useState(() => new Date().toISOString());

  // before any review can open, a trainee reads one line (an admin writes any time)
  const closed = !actor.isAdmin && !reviewsOpen(week.edition, nowIso);

  // the edition's reviews: ONE read for the page, again after each save
  const [reviews, setReviews] = useState<LessonReview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setReviews(await port.reviews.ofEdition(week.edition.id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [port, week.edition.id]);
  useEffect(() => {
    if (!closed) void load();
  }, [closed, load]);

  const rows = useMemo(() => afterRows(week, actor.memberId, all, nowIso), [week, actor.memberId, all, nowIso]);
  const byLesson = useMemo(() => new Map((reviews ?? []).map((r) => [r.lesson_id, r])), [reviews]);
  const counts = afterCounts(rows, new Set(byLesson.keys()));

  // the row the address names is open; opening another writes it back (so a reload keeps it)
  const [open, setOpen] = useState<number | null>(query.lesson);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused || query.lesson == null || reviews == null) return;
    setFocused(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`after-row-${query.lesson}`);
      el?.scrollIntoView({ block: "start" });
      el?.focus();
    });
  }, [focused, query.lesson, reviews]);
  const toggle = (id: number) => {
    const next = open === id ? null : id;
    setOpen(next);
    navigate(afterPath({ all, lesson: next ?? undefined }), { replace: true });
  };

  const opensOn = reviewsOpenOn(week.edition);
  if (closed) {
    return (
      <p data-after-closed className="rounded-xl border border-line bg-card px-4 py-4 text-ink shadow-sm">
        {opensOn ? `אפשר לכתוב «איך עבר» מ-${dateText(opensOn)}, היום שאחרי השיעור הראשון.` : "אפשר לכתוב «איך עבר» אחרי השבוע, כשהתאריך שלו ידוע."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {actor.isAdmin && (
          <div role="group" aria-label="אילו שיעורים" className="inline-flex rounded-full border border-line bg-card p-0.5">
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                aria-pressed={all === v}
                onClick={() => {
                  setOpen(null);
                  navigate(afterPath({ all: v }), { replace: true });
                }}
                className={`min-h-11 rounded-full px-4 text-sm font-bold transition-colors ${all === v ? "bg-navy text-white" : "text-ink-soft hover:bg-accent-soft hover:text-navy"}`}
              >
                {v ? "כל השיעורים" : "השיעורים שלי"}
              </button>
            ))}
          </div>
        )}
        {reviews && rows.length > 0 && (
          <p data-after-counts className="text-sm text-ink-soft tabular-nums">
            נכתב: {counts.written} · עוד לא נכתב: {counts.missing}
          </p>
        )}
      </div>

      {failed ? (
        <div className="space-y-2 rounded-xl border border-bad/40 bg-bad/5 px-4 py-3">
          <p className="text-bad">לא הצלחנו לטעון את «איך עבר».</p>
          <Button onClick={() => void load()}>לנסות שוב</Button>
        </div>
      ) : reviews == null ? (
        <p className="text-ink-soft">טוען…</p>
      ) : rows.length === 0 ? (
        <p data-after-empty className="rounded-xl border border-line bg-card px-4 py-4 text-ink-soft shadow-sm">
          {all ? "אין עדיין שיעורים סגורים במחזור." : "אין לך שיעורים סגורים במחזור הזה."}
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => (
            <AfterItem
              key={r.lesson.id}
              row={r}
              week={week}
              port={port}
              me={me}
              review={byLesson.get(r.lesson.id) ?? null}
              showHandler={all}
              open={open === r.lesson.id}
              onToggle={() => toggle(r.lesson.id)}
              nowIso={nowIso}
              notify={notify}
              clear={clear}
              reload={load}
              onSaved={() => rescue(() => document.getElementById(`after-toggle-${r.lesson.id}`))}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

const WINDOW_WORDS = { open: "פתוח לכתיבה", tbd: "התאריך עוד לא נקבע" } as const;

function AfterItem({
  row: r,
  week,
  port,
  me,
  review,
  showHandler,
  open,
  onToggle,
  nowIso,
  notify,
  clear,
  reload,
  onSaved,
}: {
  row: AfterRow;
  week: Week;
  port: DataPort;
  me: Me;
  review: LessonReview | null;
  showHandler: boolean;
  open: boolean;
  onToggle: () => void;
  nowIso: string;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
  onSaved: () => void;
}) {
  const actor = actorIn(me, week.edition);
  const access = reviewFormProps(week, r.lesson, actor, r.handler, review, nowIso);
  const lead = week.lessonSpeakers.find((x) => x.lesson_id === r.lesson.id && x.role === "lead");
  const speaker = lead ? week.speakers.find((s) => s.id === lead.speaker_id) : undefined;
  const handlerName = r.handler != null ? (week.team.find((m) => m.id === r.handler)?.display_name ?? "חבר/ת צוות") : "בלי אחראי/ת";
  const win = r.win.state === "before" ? `נפתח ב-${dateText(r.win.opensOn)}` : WINDOW_WORDS[r.win.state];
  const label = access.mayWrite ? (review ? "עריכה" : "כתיבה") : "קריאה";
  const formId = `after-form-${r.lesson.id}`;

  return (
    <li
      id={`after-row-${r.lesson.id}`}
      tabIndex={-1}
      data-after-row={r.lesson.id}
      data-written={review ? "yes" : "no"}
      data-window={r.win.state}
      className={`rounded-xl border bg-card shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-navy ${open ? "border-navy/40" : "border-line"}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
        <span className="w-32 shrink-0 text-sm">
          <span className="block font-bold text-navy">יום {DAY_NAMES[r.lesson.day]}</span>
          <bdi dir="ltr" className="tabular-nums text-ink-soft">
            {fmtRange(r.lesson.start_min, r.lesson.end_min)}
          </bdi>
        </span>
        <span className="min-w-0 flex-1 basis-48">
          <span className="block font-bold text-ink">{speaker ? displayName(speaker) : "שיעור"}</span>
          <span className="block truncate text-sm text-ink-soft">{r.lesson.title ?? "כותרת: TBD"}</span>
          {showHandler && <span className="block text-sm text-ink-faint">בטיפול: {handlerName}</span>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:shrink-0">
          <span className={`text-sm ${review ? "font-semibold text-ok" : "text-ink-soft"}`}>{review ? reviewLine(review, access.overranWord) : "עוד לא נכתב"}</span>
          <span className={`rounded-full px-2 text-xs font-bold leading-5 ${r.win.state === "open" ? "bg-ok/10 text-ok" : "bg-sand-soft text-ink-soft"}`}>{win}</span>
          <Button id={`after-toggle-${r.lesson.id}`} kind={open ? "quiet" : access.mayWrite && !review ? "primary" : "secondary"} aria-expanded={open} aria-controls={open ? formId : undefined} onClick={onToggle}>
            {open ? "סגירה" : label}
          </Button>
        </span>
      </div>
      {open && (
        <div id={formId} className="border-t border-line px-4 py-3">
          <ReviewForm key={`${review?.version ?? 0}`} {...access} port={port} week={week} lesson={r.lesson} review={review} notify={notify} clear={clear} reload={reload} onSaved={onSaved} />
        </div>
      )}
    </li>
  );
}
