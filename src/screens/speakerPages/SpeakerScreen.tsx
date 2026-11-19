// The speaker page (/speakers/:id, the reset, phase 2) — the wide twin of the grid's speaker sheet, in the order a
// trainee works with a speaker: who they are (the title and the name, the institution, large topic chips, the
// approval as a chip, the bio only when there is one); «הפנייה» (#call) — who handles them and where the call
// stands, its points, its result, a hand-over, the contacts for whoever may see them; «זמינות» (#availability) —
// the day-by-day ranges editor, the slot grid folded under it; «איפה אפשר לשבץ» (#placement); «שיעורים»
// (#lessons) — the pitches and closed lessons, each to its lesson page; «לימד/ה אצלנו»; and «מה קרה», curated.
// Every change is a port command (docs/CONTRACT.md «The speaker pool»): the page hides only what cannot be done.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import type { DataPort } from "../../data/port";
import type { Me } from "../../data/types";
import { curate, timeline } from "../../domain/activityText";
import { telHref, waHref } from "../../domain/contactLinks";
import { byGender, displayName } from "../../domain/names";
import { lessonPath, pageStepOf, parseSpeakerSection } from "../../domain/routes";
import { nextLessonStep, readerFilesOf } from "../../domain/stages";
import { DAY_NAMES, fmt, fmtRange } from "../../domain/time";
import { LIVE_PITCH, type Lesson, type Speaker, type Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Chip, GenderDot, ReconfirmDot, StageDots, TopicChip, topicsOf } from "../../grid/bits";
import { buildModel } from "../../grid/model";
import { statusLabel } from "../../lib/labels";
import { Button, Fold, useFocusRescue, useRunner } from "../settings/kit";
import { CallPoints, CallResults } from "../speakers/call";
import { SlotGrid, useToast } from "../speakers/parts";
import {
  ApproachView,
  CALLING,
  CallResultFrame,
  Contacts,
  DAY_ONLY,
  HandOver,
  HandOverOffer,
  handOverText,
  LINK_PREFERRED,
  mayEditSpeaker,
  ProfileEdit,
  Timeline,
  useSpeakerSide,
  vetText,
  when,
} from "../speakers/sheetParts";
import { TaughtHere } from "../speakers/SpeakerReviews";
import { LINK_BUTTON } from "../stages/parts";
import { actorIn, useWeekStore } from "../weekStore";
import { BACK_LINK, PageSection, useHandedNotice, weekProblem } from "./page";
import { PlacementSection } from "./PlacementSection";
import { RangesEditor } from "./RangesEditor";
import { VettingChip } from "./VettingChip";

export function SpeakerScreen({ port, me }: { port: DataPort; me: Me }) {
  const store = useWeekStore();
  const { id } = useParams();
  const { notify, clear, node } = useToast();
  useHandedNotice(notify);
  const problem = weekProblem(store);
  const s = store.week?.speakers.find((x) => String(x.id) === id);
  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-20">
      <Link to="/speakers" className={`-ms-3 ${BACK_LINK}`}>
        <span aria-hidden>→</span> מרצים
      </Link>
      {problem ??
        (s && store.week ? (
          <Body key={s.id} port={port} me={me} week={store.week} s={s} reload={store.reload} notify={notify} clear={clear} />
        ) : (
          <p className="mt-6 text-ink-soft">המרצה לא נמצא/ה במאגר.</p>
        ))}
      {node}
    </div>
  );
}

function Body({ port, me, week, s, reload, notify, clear }: { port: DataPort; me: Me; week: Week; s: Speaker; reload: () => Promise<void>; notify: ReturnType<typeof useToast>["notify"]; clear: () => void }) {
  const edition = week.edition;
  const model = useMemo(() => buildModel(week), [week]);
  const actor = actorIn(me, edition);
  const a = week.approaches.find((x) => x.speaker_id === s.id) ?? null;
  const names = useMemo(() => new Map(week.team.map((t) => [t.id, t.display_name])), [week.team]);
  const nameOf = (mid: number | null | undefined) => (mid == null ? "—" : (names.get(mid) ?? "חבר/ת צוות"));
  const { busy, run } = useRunner(notify, clear);
  const side = useSpeakerSide(port, s.id, [s.version, a?.version, a?.owner_member_id]);
  const [editing, setEditing] = useState(false);

  // Opened at a section (`#call` from «היום שלי», `#placement` from an old screen's «שבץ»): scrolled there, the focus on it.
  const location = useLocation();
  const section = parseSpeakerSection(location.hash);
  useEffect(() => {
    if (!section) return;
    const el = document.getElementById(section);
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
  }, [section]);

  /** A command, then the week and the page's own reads again. */
  const act = async (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => {
    const done = await run(key, fn, ok, onRefused);
    await reload();
    void side.reload();
    return done;
  };
  // A result takes the pressed button away (the status it set is not offered again, «אני מטפל/ת» is gone once I handle
  // them, a form closes): the focus stays in its section — «הפנייה», «זמינות» — or goes back to «עריכה».
  const rescue = useFocusRescue();
  const inCall = async (key: string, fn: () => Promise<unknown>, ok: string | null, onRefused?: (code: string | null) => boolean) => {
    const done = await act(key, fn, ok, onRefused);
    rescue(() => document.getElementById("call"));
    return done;
  };
  const header = useRef<HTMLElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const edit = (on: boolean) => {
    setEditing(on);
    rescue(() => (on ? header.current?.querySelector<HTMLElement>("form select, form input") : editButton.current));
  };

  const handler = !!a && a.owner_member_id != null && a.owner_member_id === actor.memberId;
  const mayManage = actor.canEdit && !!a && (actor.isAdmin || handler);
  const mayClaim = actor.canEdit && !s.retired && (!a || a.owner_member_id == null);
  const mayEdit = mayEditSpeaker(actor, edition, handler);
  const mayMark = actor.canEdit && !s.retired;
  const closedHere = (model.closedOf.get(s.id) ?? []).slice().sort((x, y) => x.day - y.day || x.start_min - y.start_min);
  const pitched = (a ? week.pitches.filter((p) => p.approach_id === a.id && LIVE_PITCH.has(p.state)) : [])
    .map((p) => week.lessons.find((l) => l.id === p.lesson_id))
    .filter((l): l is Lesson => !!l && l.state === "draft")
    .sort((x, y) => x.day - y.day || x.start_min - y.start_min);
  const calling = !!a && CALLING.has(a.status);
  const contacts = side.contacts;
  const tel = mayManage && calling ? telHref(contacts?.phone) : null;
  const wa = mayManage && calling ? waHref(contacts?.phone) : null;
  const lastNote = a && side.log?.find((e) => e.entity === "approaches" && e.entity_id === a.id && e.kind !== "availability" && typeof e.detail?.note === "string" && e.detail.note !== "");
  const mySlots = useMemo(() => week.slotAvailability.filter((v) => v.speaker_id === s.id), [week.slotAvailability, s.id]);
  const topics = topicsOf(s.topics, week.categories);
  const where = [s.disambiguator, s.affiliation].filter(Boolean).join(" · ");
  const lines = useMemo(
    () =>
      side.log
        ? timeline(curate(side.log), {
            name: (mid) => names.get(mid) ?? null,
            gender: s.gender,
            lesson: (lid) => {
              const l = week.lessons.find((x) => x.id === lid);
              return l ? `${DAY_NAMES[l.day]} ${fmt(l.start_min)}` : null;
            },
          })
        : null,
    [side.log, names, s.gender, week.lessons],
  );

  return (
    <>
      <header ref={header} className="space-y-3 rounded-xl border border-line bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <GenderDot gender={s.gender} className="size-3" />
          <h2 className="font-display text-2xl font-extrabold leading-tight text-navy sm:text-3xl">{displayName(s)}</h2>
          <VettingChip s={s} actor={actor} nameOf={nameOf} busy={busy} onVet={(st, note) => act(`vet:${st}`, () => port.speakers.vet([s.id], st, note), vetText(st, s))} />
          {s.retired && <Chip>{byGender(s.gender, "לא פעיל", "לא פעילה")}</Chip>}
          {mayEdit && !editing && (
            <Button ref={editButton} kind="quiet" className="ms-auto" onClick={() => edit(true)}>
              עריכה
            </Button>
          )}
        </div>
        {editing ? (
          <ProfileEdit
            s={s}
            week={week}
            actor={actor}
            busy={busy}
            onDone={() => edit(false)}
            onSave={(patch, onRefused) => act("profile", () => port.speakers.update(edition.id, s.id, s.version, patch), "הפרטים נשמרו", onRefused)}
          />
        ) : (
          <>
            {where && <p className="text-lg text-ink-soft">{where}</p>}
            {topics.length > 0 && (
              <ul aria-label="נושאים" className="flex flex-wrap gap-1.5">
                {topics.map((t) => (
                  <li key={t.name}>
                    <TopicChip name={t.name} category={t.category} size="lg" />
                  </li>
                ))}
              </ul>
            )}
            {s.bio_short && <p className="max-w-prose whitespace-pre-line leading-relaxed">{s.bio_short}</p>}
            {!s.gender && <p className="text-sm font-bold text-warn">מגדר לא ידוע: צריך להשלים לפני סגירת שיעור</p>}
          </>
        )}
      </header>

      <PageSection id="call" title="הפנייה">
        <div className="space-y-3">
          <ApproachView s={s} a={a} actor={actor} handler={handler} nameOf={nameOf} />
          {lastNote && (
            <p className="break-words text-sm">
              <span className="text-ink-soft">
                הערה אחרונה{lastNote.actor != null && ` (${nameOf(lastNote.actor)}, ${when(lastNote.at, DAY_ONLY)})`}:
              </span>{" "}
              «{String(lastNote.detail.note)}»
            </p>
          )}
          {a && (
            <HandOverOffer
              a={a}
              actor={actor}
              handler={handler}
              busy={busy}
              nameOf={nameOf}
              onAnswer={(accept) => void inCall(accept ? "accept" : "decline", () => port.speakers.answerHandOver(edition.id, a.id, accept), accept ? "הטיפול עבר אליך" : "ההצעה נדחתה")}
              onWithdraw={() => void inCall("withdraw", () => port.speakers.handOver(edition.id, a.id, actor.isAdmin ? a.owner_member_id : null), "ההצעה בוטלה")}
            />
          )}
          {mayClaim && (
            <Button kind="primary" busy={busy === "claim"} onClick={() => void inCall("claim", () => port.speakers.claim(edition.id, s.id), "המרצה בטיפולך")}>
              אני מטפל/ת
            </Button>
          )}
          {(tel || wa) && (
            <div className="flex flex-wrap gap-1.5">
              {tel && (
                <a href={tel} className={s.contact_pref === "phone" ? LINK_PREFERRED : LINK_BUTTON}>
                  חיוג
                </a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className={s.contact_pref === "whatsapp" ? LINK_PREFERRED : LINK_BUTTON}>
                  WhatsApp
                </a>
              )}
            </div>
          )}
          {mayManage && a && calling && (
            <Fold title="נקודות לשיחה" defaultOpen={section === "call"} className="rounded-xl border border-line bg-paper-light px-3 py-0.5">
              <CallPoints week={week} speakerGender={s.gender} memberId={actor.memberId} />
            </Fold>
          )}
          {mayManage && a && closedHere.length === 0 && (
            <CallResultFrame calling={calling}>
              <CallResults
                status={a.status}
                gender={s.gender}
                busy={busy === "call"}
                onResult={(st, note) => inCall("call", () => port.speakers.setStatus(edition.id, a.id, a.version, st, note), `עודכן: ${statusLabel(st, s.gender)}`)}
              />
            </CallResultFrame>
          )}
          {mayManage && closedHere.length > 0 && <p className="text-xs text-ink-soft">יש שיעור סגור במחזור. כדי לשנות את המצב, קודם פותחים אותו מחדש.</p>}
          {mayManage && a && <HandOver key={`${a.id}:${a.owner_member_id}`} team={week.team} a={a} actor={actor} busy={busy} onGo={(to, note) => inCall("handover", () => port.speakers.handOver(edition.id, a.id, to, note), handOverText(s, to, actor, nameOf))} />}

          <div className="space-y-2 border-t border-line/70 pt-3">
            <h4 className="font-bold text-navy">פרטי קשר</h4>
            {side.failed && contacts === undefined ? (
              <p role="alert" className="text-sm text-bad">
                לא הצלחנו לטעון.{" "}
                <button type="button" className="inline-flex min-h-11 items-center font-bold text-navy underline underline-offset-4" onClick={() => void side.reload()}>
                  לנסות שוב
                </button>
              </p>
            ) : contacts === undefined ? (
              <p className="text-sm text-ink-soft">טוען…</p>
            ) : contacts === null ? (
              <p className="text-sm text-ink-soft">{handler && !(edition.kind === "real" && edition.status !== "archived") ? "פרטי הקשר נפתחים רק במחזור האמיתי של השנה." : errorMessage("contacts_hidden")}</p>
            ) : (
              <Contacts key={`${s.id}`} s={s} c={contacts} busy={busy} onSave={(c, onRefused) => act("contacts", () => port.speakers.setContacts(s.id, c), "פרטי הקשר נשמרו", onRefused)} />
            )}
          </div>
        </div>
      </PageSection>

      <PageSection id="availability" title="זמינות">
        <div className="space-y-3">
          <RangesEditor
            week={week}
            speaker={s}
            canEdit={mayMark}
            onSave={(days, ranges) =>
              act("ranges", () => port.speakers.setAvailabilityRanges(edition.id, s.id, days, ranges, null), days.length === 1 ? `הזמינות נשמרה: יום ${DAY_NAMES[days[0]]}` : "הזמינות נשמרה")
            }
          />
          <Fold title="דיוק לפי משבצת" hint="משבצת אחת בכל הקשה, והערות" size="sm">
            <SlotGrid
              rows={week.rows}
              edition={edition}
              slots={mySlots}
              gender={s.gender}
              onSet={mayMark ? (day, rowId, kind, note) => act("slot", () => port.speakers.setSlotAvailability(edition.id, s.id, day, rowId, kind, note), null) : undefined}
            />
          </Fold>
        </div>
      </PageSection>

      <PageSection id="placement" title="איפה אפשר לשבץ">
        <PlacementSection port={port} week={week} model={model} speaker={s} actor={actor} notify={notify} clear={clear} reload={reload} />
      </PageSection>

      <PageSection id="lessons" title="שיעורים" count={pitched.length + closedHere.length || undefined}>
        {pitched.length + closedHere.length === 0 ? (
          <p className="text-sm text-ink-soft">עוד אין שיעור במחזור הזה.</p>
        ) : (
          <ul className="space-y-1.5">
            {pitched.map((l) => (
              <LessonRow key={l.id} lesson={l} to={lessonPath(l.id, "place")}>
                <Chip tone="info">{byGender(s.gender, "מועמד", "מועמדת")}</Chip>
              </LessonRow>
            ))}
            {closedHere.map((l) => {
              const step = nextLessonStep(l, readerFilesOf(week, l.id));
              return (
                <LessonRow key={l.id} lesson={l} to={lessonPath(l.id, step ? pageStepOf(step) : null)}>
                  <StageDots lesson={l} week={week} />
                  {l.needs_reconfirm && <ReconfirmDot />}
                </LessonRow>
              );
            })}
          </ul>
        )}
      </PageSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5">
          <TaughtHere port={port} s={s} actor={actor} edition={edition} categories={week.categories} history={side.history} failed={side.failed} titled />
        </div>
        <div className="rounded-xl border border-line bg-card p-4 shadow-sm sm:p-5">
          <Timeline lines={lines} failed={side.failed} />
        </div>
      </div>
    </>
  );
}

/** One of the speaker's lessons this edition: the day and the time, the title, what the caller adds, «לשיעור». */
function LessonRow({ lesson: l, to, children }: { lesson: Lesson; to: string; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line bg-paper-light px-3 py-2">
      <span className="min-w-0 flex-1 basis-48">
        <span className="font-bold text-navy">
          {DAY_NAMES[l.day]}{" "}
          <bdi dir="ltr" className="tabular-nums">
            {fmtRange(l.start_min, l.end_min)}
          </bdi>
        </span>
        <span className="text-sm"> · {l.title ?? (l.state === "closed" ? "כותרת: TBD" : "בלי כותרת עדיין")}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
      <Link to={to} className={LINK_BUTTON}>
        לשיעור
      </Link>
    </li>
  );
}
