// «קישורים» — links without an account (DESIGN «גישה בלי חשבון»), issued by an
// edition's admins: a personal link for each trainee who escorts, one sign-up
// link for מכריכה לכריכה, one schedule link. The token is shown once, right
// after it is issued, under the row that issued it (scrolled to, its address in
// focus; several may be open at once) — copy it, send it on WhatsApp, open it — and never again:
// the database keeps only its hash, so afterwards a link can only be replaced
// (a new token; the old one stops at once) or revoked. The list shows each
// link's state and expiry, never a token. Everything goes through port.links.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { demoToken } from "../../data/demoLinks";
import { type IssuedLink, type LinkScope, linkState, linkUrl, type ShareLink } from "../../data/links";
import type { DataPort } from "../../data/port";
import { whatsappTextHref } from "../../domain/contactLinks";
import { israelMoment } from "../../domain/israelTime";
import type { Edition, Week } from "../../domain/types";
import { Badge, Button, Confirm, EditionPicker, INPUT, LoadError, Loading, Panel, Row, Rows, useAction, useSettings } from "./kit";

interface Props {
  data: DataPort;
  editions: Edition[];
  editionId: number | null;
  setEditionId: (id: number) => void;
}

/** What a link is for, in the list and in the message it is sent with. */
const SCOPE_WORDS: Record<LinkScope, string> = { escort: "הדף שלך כמלווה", kk_signup: "הרשמה למכריכה לכריכה", schedule: 'הלו"ז' };

/** The one line a link is sent with: the week, what it opens, the address — nothing else. */
export function linkMessage(scope: LinkScope, editionLabel: string, url: string): string {
  return `שבוע וולוז'ין ${editionLabel} — ${SCOPE_WORDS[scope]}:\n${url}`;
}

/** The subject's current link (the newest), if any. */
function currentOf(links: ShareLink[], scope: LinkScope, subject: number | null): ShareLink | null {
  return links.filter((l) => l.scope === scope && l.subject_id === subject).sort((a, b) => b.id - a.id)[0] ?? null;
}

type Issued = IssuedLink & { scope: LinkScope; subject: number | null; who: string };

/** Which row a just-issued link belongs to. */
const rowKey = (scope: LinkScope, subject: number | null) => `${scope}-${subject ?? 0}`;

/** The links just issued, by row, until each is closed: shown under its own row, never all in one place. */
interface IssuedSlot {
  of: (scope: LinkScope, subject: number | null) => Issued | null;
  put: (x: Issued) => void;
  close: (scope: LinkScope, subject: number | null) => void;
}

export function LinksTab({ data, editions, editionId, setEditionId }: Props) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [week, setWeek] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);
  const [issued, setIssued] = useState<Record<string, Issued>>({});

  const load = useCallback(async () => {
    if (editionId == null) return;
    setFailed(false);
    try {
      const [l, w] = await Promise.all([data.links.list(editionId), data.loadWeek(editionId)]);
      setLinks(l);
      setWeek(w);
    } catch {
      setFailed(true);
    }
  }, [data, editionId]);
  useEffect(() => {
    setLinks(null);
    setWeek(null);
    setIssued({}); // a token belongs to the edition it was issued in
    void load();
  }, [load]);

  if (editions.length === 0) {
    return (
      <Panel title="קישורים">
        <p className="text-ink-soft">הקישורים שייכים למחזור. קודם פותחים את המחזור של השנה (לשונית «מחזור»).</p>
      </Panel>
    );
  }
  const body = () => {
    if (failed) return <LoadError onRetry={() => void load()} />;
    if (!links || !week || week.edition.id !== editionId) return <Loading />;
    const archived = week.edition.kind === "archive" || week.edition.status === "archived";
    const slot: IssuedSlot = {
      of: (scope, subject) => issued[rowKey(scope, subject)] ?? null,
      put: (x) => setIssued((cur) => ({ ...cur, [rowKey(x.scope, x.subject)]: x })),
      close: (scope, subject) =>
        setIssued((cur) => {
          const { [rowKey(scope, subject)]: _, ...rest } = cur;
          return rest;
        }),
    };
    return (
      <>
        <p className="text-sm text-ink-soft">
          קישור נפתח בלי כניסה, ומציג רק את מה שהוא נועד לו. הקוד שבקישור מוצג רק ברגע ההנפקה: מעתיקים או שולחים אותו מיד. אחר כך אפשר רק להחליף אותו בקישור חדש (הישן מפסיק
          לעבוד) או לבטל.
        </p>
        {archived && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">המחזור בארכיון: לא מנפיקים בו קישורים, והקישורים שלו לא נפתחים.</p>}
        <EscortLinks data={data} week={week} links={links} archived={archived} issued={slot} reload={load} />
        <ClassLinks data={data} week={week} links={links} archived={archived} issued={slot} reload={load} />
        {data.mode === "demo" && week.edition.kind === "demo" && <DemoLinksPanel week={week} />}
      </>
    );
  };
  return (
    <>
      <EditionPicker editions={editions} value={editionId} onChange={setEditionId} />
      {body()}
    </>
  );
}

/**
 * The token, once: the address to copy, send or open — and the warning that it will not be shown again. Right under
 * the row that issued it, brought into view with its address in focus, so a click lower on the page is never followed
 * by nothing visible (and a second click that would revoke a link nobody saw).
 */
function IssuedBox({ issued, edition, onClose }: { issued: Issued; edition: Edition; onClose: () => void }) {
  const { notify } = useSettings();
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const url = linkUrl(window.location.origin, issued.scope, issued.token);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    box.current?.scrollIntoView({ block: "center" });
  }, [issued.link_id]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify("ok", "הקישור הועתק");
    } catch {
      (document.getElementById(`${id}-url`) as HTMLInputElement | null)?.select();
      notify("error", "לא הצלחנו להעתיק. הקישור מסומן בשדה: אפשר להעתיק אותו משם.");
    }
  };
  return (
    <section ref={box} aria-label={`הקישור החדש: ${issued.who}`} className="space-y-3 rounded-xl border-2 border-ink bg-card p-4 shadow-sm sm:p-5">
      <h3 className="font-display text-lg font-semibold">הקישור החדש: {issued.who}</h3>
      <div>
        <label htmlFor={`${id}-url`} className="mb-1 block text-sm font-semibold">
          הקישור
        </label>
        <input ref={field} id={`${id}-url`} readOnly value={url} dir="ltr" onFocus={(e) => e.target.select()} className={`${INPUT} font-mono text-sm`} />
      </div>
      <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">
        <b>הקישור מוצג רק עכשיו.</b> אחרי שסוגרים את המסגרת הזו אי אפשר לראות אותו שוב, רק להחליף אותו בקישור חדש. בתוקף עד {israelMoment(issued.expires_at)}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button kind="primary" onClick={() => void copy()}>
          העתקה
        </Button>
        <a
          href={whatsappTextHref(linkMessage(issued.scope, edition.label, url))}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-paper px-3 font-semibold hover:bg-line/50"
        >
          שליחה ב-WhatsApp
        </a>
        {/* a new tab, a fresh page: the team's own session never meets the public page */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-paper px-3 font-semibold hover:bg-line/50"
        >
          פתיחה
        </a>
        <Button kind="quiet" onClick={onClose}>
          סגירה
        </Button>
      </div>
    </section>
  );
}

function StateBadge({ link }: { link: ShareLink | null }) {
  if (!link) return <Badge tone="muted">אין קישור</Badge>;
  const s = linkState(link);
  if (s === "revoked") return <Badge tone="muted">בוטל</Badge>;
  if (s === "expired") return <Badge tone="bad">פג ב-{israelMoment(link.expires_at)}</Badge>;
  return <Badge tone="ok">בתוקף עד {israelMoment(link.expires_at)}</Badge>;
}

interface RowProps {
  data: DataPort;
  week: Week;
  links: ShareLink[];
  archived: boolean;
  issued: IssuedSlot;
  reload: () => Promise<void>;
}

/** A trainee who escorts a closed lesson, or still holds a live link. */
function EscortLinks({ data, week, links, archived, issued, reload }: RowProps) {
  const lessons = useMemo(() => {
    const m = new Map<number, number>();
    for (const l of week.lessons) if (l.state === "closed" && l.escort_roster_id != null) m.set(l.escort_roster_id, (m.get(l.escort_roster_id) ?? 0) + 1);
    return m;
  }, [week]);
  const escorts = [...week.roster]
    .filter((r) => lessons.has(r.id) || links.some((l) => l.scope === "escort" && l.subject_id === r.id && linkState(l) === "live"))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "he") || a.id - b.id);
  return (
    <Panel title="קישורים למלווים" aside={escorts.length === 1 ? "מלווה אחד/ת" : `${escorts.length} מלווים`}>
      <p className="mb-3 text-sm text-ink-soft">
        לכל חניך/ה שמלווה: השיעורים שלו/ה, «משהו שחשוב לדעת» וארבעת הסימונים. הטלפון של המרצה מופיע רק משבוע לפני השבוע. הקישור פג בסוף השבוע (או 30 יום אחרי ההנפקה, כל עוד
        התאריך TBD) (הצעה).
      </p>
      {escorts.length === 0 ? (
        <p className="text-ink-soft">עוד אין חניכים שמלווים שיעור סגור. משבצים מלווה בלוח של שיעור סגור, בשלב «מלווה».</p>
      ) : (
        <Rows label="קישורים למלווים" head={["מלווה", "שיעורים", "הקישור"]}>
          {escorts.map((r) => (
            <LinkRow
              key={r.id}
              data={data}
              week={week}
              scope="escort"
              subject={r.id}
              who={r.full_name}
              cells={[r.full_name, (lessons.get(r.id) ?? 0) === 1 ? "שיעור אחד" : `${lessons.get(r.id) ?? 0} שיעורים`]}
              link={currentOf(links, "escort", r.id)}
              archived={archived}
              issued={issued}
              reload={reload}
            />
          ))}
        </Rows>
      )}
    </Panel>
  );
}

/** The class's two links: the sign-up for מכריכה לכריכה and the schedule. */
function ClassLinks({ data, week, links, archived, issued, reload }: RowProps) {
  const w = week.edition.settings?.kk_window;
  return (
    <Panel title="קישורים לכל החניכים">
      <ul className="mb-3 space-y-1 text-sm text-ink-soft">
        <li>
          <b className="text-ink">הרשמה למכריכה לכריכה:</b> רשימת החניכים בשמות בלבד והקבוצות שפתוחות להרשמה. פג כשחלון ההרשמה נסגר
          {w ? ` (${israelMoment(w.closes_at)})` : "; עוד אין חלון, ולכן ההרשמה סגורה"} (הצעה) —{" "}
          <Link to="/kk" className="font-semibold underline">
            החלון והקבוצות במסך «מכריכה לכריכה»
          </Link>
          .
        </li>
        <li>
          <b className="text-ink">הלו"ז:</b> הלו"ז הציבורי בלבד, כמו בייצוא למעצבת. פג בסוף השבוע (או 30 יום אחרי ההנפקה, כל עוד התאריך TBD) (הצעה).
        </li>
      </ul>
      <Rows label="קישורים לכל החניכים" head={["קישור", "הקישור"]}>
        <LinkRow data={data} week={week} scope="kk_signup" subject={null} who="הרשמה למכריכה לכריכה" cells={["הרשמה למכריכה לכריכה"]} link={currentOf(links, "kk_signup", null)} archived={archived} issued={issued} reload={reload} />
        <LinkRow data={data} week={week} scope="schedule" subject={null} who='הלו"ז' cells={['לו"ז לצפייה']} link={currentOf(links, "schedule", null)} archived={archived} issued={issued} reload={reload} />
      </Rows>
    </Panel>
  );
}

function LinkRow({
  data,
  week,
  scope,
  subject,
  who,
  cells,
  link,
  archived,
  issued,
  reload,
}: {
  data: DataPort;
  week: Week;
  scope: LinkScope;
  subject: number | null;
  who: string;
  cells: string[];
  link: ShareLink | null;
  archived: boolean;
  issued: IssuedSlot;
  reload: () => Promise<void>;
}) {
  const { busy, run } = useAction();
  const [asking, setAsking] = useState<"replace" | "revoke" | null>(null);
  const live = link != null && linkState(link) === "live";
  const all = [...cells, <StateBadge key="s" link={link} />];
  const mine = issued.of(scope, subject);
  const below = mine ? <IssuedBox issued={mine} edition={week.edition} onClose={() => issued.close(scope, subject)} /> : undefined;
  const issue = async () => {
    setAsking(null);
    const box: { out?: IssuedLink } = {};
    const ok = await run(`issue-${scope}-${subject}`, async () => (box.out = await data.links.issue(week.edition.id, scope, subject)), "הקישור הונפק — מעתיקים או שולחים אותו עכשיו.");
    if (ok && box.out) issued.put({ ...box.out, scope, subject, who });
    await reload();
  };
  const revoke = async () => {
    setAsking(null);
    if (link) await run(`revoke-${link.id}`, () => data.links.revoke(link.id), "הקישור בוטל. הוא כבר לא נפתח.");
    await reload();
  };
  if (asking) {
    return (
      <Row
        cells={all}
        editing={
          <Confirm
            text={
              asking === "replace" ? (
                <>
                  הקישור הקיים של <b>{who}</b> יפסיק לעבוד מיד, ובמקומו יונפק קישור חדש. צריך לשלוח אותו שוב.
                </>
              ) : (
                <>
                  הקישור של <b>{who}</b> יפסיק לעבוד מיד.
                </>
              )
            }
            confirm={asking === "replace" ? "קישור חדש במקומו" : "כן, לבטל את הקישור"}
            cancel="חזרה"
            onConfirm={() => void (asking === "replace" ? issue() : revoke())}
            onCancel={() => setAsking(null)}
          />
        }
      />
    );
  }
  return (
    <Row
      cells={all}
      below={below}
      actions={
        archived ? undefined : live ? (
          <>
            <Button onClick={() => setAsking("replace")} busy={busy === `issue-${scope}-${subject}`} aria-label={`קישור חדש: ${who}`}>
              קישור חדש
            </Button>
            <Button kind="danger" onClick={() => setAsking("revoke")} busy={busy === `revoke-${link!.id}`} aria-label={`ביטול הקישור: ${who}`}>
              ביטול הקישור
            </Button>
          </>
        ) : (
          <Button kind="primary" onClick={() => void issue()} busy={busy === `issue-${scope}-${subject}`} aria-label={`הנפקת קישור: ${who}`}>
            הנפקת קישור
          </Button>
        )
      }
    />
  );
}

/** The demo's links, issued in advance: synthetic, opened in this tab on the demo's data (src/data/demoLinks.ts). */
function DemoLinksPanel({ week }: { week: Week }) {
  const ed = week.edition.id;
  const escorts = [...new Set(week.lessons.filter((l) => l.state === "closed" && l.escort_roster_id != null).map((l) => l.escort_roster_id!))]
    .map((id) => week.roster.find((r) => r.id === id))
    .filter((r) => !!r)
    .sort((a, b) => a!.full_name.localeCompare(b!.full_name, "he"));
  const to = (scope: LinkScope, subject: number | null) => `${linkUrl("", scope, demoToken(scope, ed, subject, true))}`;
  const cls = "inline-flex min-h-11 items-center underline underline-offset-4";
  return (
    <Panel title="קישורים לדוגמה" aside="מצב הדגמה">
      <p className="mb-2 text-sm text-ink-soft">
        בהדגמה יש קישורים שהונפקו מראש. הם לדוגמה בלבד ונפתחים בלשונית הזו, על נתוני ההדגמה. קישור שהוחלף או בוטל כאן כבר לא נפתח.
      </p>
      <ul className="flex flex-wrap gap-x-4">
        {escorts.map((r) => (
          <li key={r!.id}>
            <Link to={to("escort", r!.id)} className={cls}>
              הדף של {r!.full_name}
            </Link>
          </li>
        ))}
        <li>
          <Link to={to("kk_signup", null)} className={cls}>
            טופס ההרשמה למכריכה לכריכה
          </Link>
        </li>
        <li>
          <Link to={to("schedule", null)} className={cls}>
            הלו"ז לצפייה
          </Link>
        </li>
      </ul>
    </Panel>
  );
}
