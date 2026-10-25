// «תבניות» — the instructor's own wording, per edition (an admin of the
// edition writes it): the summary message's template, and the escorts'
// «משהו שחשוב לדעת» phrases. Neither is ever seeded: both start empty and the
// tab asks for last year's wording to be pasted (the bottom of the tracking
// sheet; the escorts file). The template is checked as it is typed — the
// variables, the gender forms, the brackets — and previewed on a synthetic
// lesson (src/domain/message.ts), so what blocks a message shows here first.
import { type FormEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { DUTY_WHENS, STAGE_LIMITS } from "../../data/stageRules";
import { DUTY_WHEN_LABEL } from "../../domain/escorts";
import { composeConfirmation, MESSAGE_VARIABLES, type MessageVariable } from "../../domain/message";
import type { DutyPhrase, DutyWhen, Edition, Gender } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Choice } from "../stages/parts";
import { Badge, Button, Confirm, EditionPicker, Field, INPUT, Panel, Row, Rows, useAction, useFocusBack, useSettings } from "./kit";

interface Props {
  editions: Edition[];
  editionId: number | null;
  setEditionId: (id: number) => void;
  /** Re-reads the editions (their settings hold the template and the phrases). */
  reload: () => Promise<void>;
}

export function TemplatesTab({ editions, editionId, setEditionId, reload }: Props) {
  if (editions.length === 0) {
    return (
      <Panel title="תבניות">
        <p className="text-ink-soft">התבניות שייכות למחזור. קודם פותחים את המחזור של השנה (לשונית «מחזור»).</p>
      </Panel>
    );
  }
  const e = editions.find((x) => x.id === editionId);
  return (
    <>
      <EditionPicker editions={editions} value={editionId} onChange={setEditionId} />
      {e && (
        <>
          {/* keyed by what is saved: after a save (or a change elsewhere) the form starts from it */}
          <TemplatePanel key={`${e.id}:${e.settings.confirm_template ?? ""}`} edition={e} onSaved={reload} />
          <PhrasesPanel key={`phrases:${e.id}`} edition={e} onSaved={reload} />
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ the summary message

/** What each variable becomes — the cheat-sheet under the template. */
const VARIABLE_HELP: Record<MessageVariable, string> = {
  פנייה: "תואר ושם המרצה",
  יום: "היום בשבוע, לפי לוח השנה (שיעור ב-00:30 שייך כבר ליום שאחריו)",
  תאריך: "התאריך הלועזי והעברי. כל עוד תאריך השבוע TBD, ההודעה חסומה",
  מקום: "החדר",
  כותרת: "כותרת השיעור. כותרת TBD חוסמת",
  שעה: "זמן ההוראה, התחלה–סוף",
  משך: "זמן ההוראה במילים: «שעה ורבע», «שעה וחצי», «שעה»…",
  תשלום: "הסכום בספרות בלבד. את ₪ או ש״ח כותבים בנוסח",
};

/** The forms: what is inserted, where the cursor lands, and what it means. */
const FORMS: { insert: string; caret: number; label: string; help: string }[] = [
  { insert: "[[|]]", caret: 2, label: "[[זכר|נקבה]]", help: "לפי מגדר המרצה. למשל: [[מוזמן|מוזמנת]]" },
  { insert: "{{אני:|}}", caret: 6, label: "{{אני:זכר|נקבה}}", help: "לפי המגדר שלך, מי ששולח/ת. למשל: {{אני:שמח|שמחה}}" },
  { insert: "[[תשלום:|]]", caret: 8, label: "[[תשלום:…|…]]", help: "החלק הראשון כשהתבקש סכום, השני כשלא (התנדבות). רק כך נכנס נוסח להתנדבות" },
];

/** A preview amount for the synthetic lesson — shown as such, never stored. */
const SAMPLE_AMOUNT = 500;

/** «{{אני:…}}», spaces forgiven as the parser forgives them. */
const SENDER_FORM = /\{\{\s*אני\s*:/;

function TemplatePanel({ edition, onSaved }: { edition: Edition; onSaved: () => Promise<void> }) {
  const { port, me } = useSettings();
  const { busy, run } = useAction();
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const saved = edition.settings.confirm_template ?? "";
  const [text, setText] = useState(saved);
  const [deleting, setDeleting] = useState(false);
  // «ביטול» takes the confirm (and its focus) away: «מחיקת הנוסח» takes it back
  const focusBack = useFocusBack();
  const [problem, setProblem] = useState<string | null>(null);
  const [speakerGender, setSpeakerGender] = useState<Gender>("f");
  const [senderGender, setSenderGender] = useState<Gender>("f");
  const [paid, setPaid] = useState<"paid" | "free">("paid");
  const dirty = text !== saved;
  // My own gender on the team list (undefined until read): a template with {{אני:…}} blocks every message I send without it.
  const [myGender, setMyGender] = useState<Gender | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const mine = new Set(me.memberships.map((m) => m.member_id));
    port.team(edition.id).then(
      (team) => live && setMyGender(team.find((t) => mine.has(t.id))?.gender ?? null),
      () => live && setMyGender(undefined),
    );
    return () => {
      live = false;
    };
  }, [port, me.memberships, edition.id]);

  // The preview: a synthetic lesson on Monday 20:00, this edition's date (or TBD), and the genders chosen above.
  const preview = useMemo(
    () =>
      composeConfirmation({
        template: text,
        lesson: { state: "closed", day: 1, start_min: 1200, end_min: 1290, title: "כותרת לדוגמה", teach_min: null, pay_amount: paid === "paid" ? SAMPLE_AMOUNT : null, approval: paid === "paid" ? "approved" : "none" },
        speaker: { title: "ד״ר", name: speakerGender === "f" ? "פלונית לדוגמה" : "פלוני לדוגמה", gender: speakerGender },
        sender: { gender: senderGender },
        room: "חדר לדוגמה",
        startDate: edition.start_date,
        lessonMinutes: edition.settings.lesson_minutes,
      }),
    [text, paid, speakerGender, senderGender, edition.start_date, edition.settings.lesson_minutes],
  );

  // Where the cursor goes once an inserted variable is on screen. Placed in the
  // same commit (a layout effect), never a frame later: keys typed in between
  // would land where the cursor was, and the late jump would split the text.
  const caretAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    const at = caretAt.current;
    if (at == null) return;
    caretAt.current = null;
    ref.current?.focus();
    ref.current?.setSelectionRange(at, at);
  }, [text]);

  const insert = (token: string, caret = token.length) => {
    const el = ref.current;
    const from = el?.selectionStart ?? text.length;
    const to = el?.selectionEnd ?? text.length;
    caretAt.current = from + caret;
    setText(text.slice(0, from) + token + text.slice(to));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const ok = await run("template", () => port.setConfirmTemplate(edition.id, text.trim() ? text : null), text.trim() ? "הנוסח נשמר" : "הנוסח נמחק", (code) => {
      if (code !== "bad_value") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) await onSaved();
  };
  const remove = async () => {
    const ok = await run("template-delete", () => port.setConfirmTemplate(edition.id, null), "הנוסח נמחק");
    if (ok) {
      setDeleting(false);
      await onSaved();
    }
  };

  return (
    <Panel title="הודעת הסיכום למרצה" aside={saved ? "יש נוסח" : <Badge tone="bad">ריק: ההודעות חסומות</Badge>}>
      <form onSubmit={(e) => void save(e)} aria-label="נוסח הודעת הסיכום" className="space-y-3" noValidate>
        {!saved && (
          <div className="rounded-lg border border-accent bg-accent-soft p-3 text-sm">
            <p className="font-semibold">עוד אין נוסח, ועד שיהיה ההודעות למרצים חסומות.</p>
            <p>מדביקים כאן את הנוסח של אשתקד, מתחתית גיליון המעקב, בלי מספרי טלפון. אחר כך מחליפים בו את הפרטים של השיעור במשתנים שלמטה. המערכת לא כותבת נוסח משלה.</p>
          </div>
        )}
        <Field id={`${id}-text`} label="הנוסח" hint={`עד ${STAGE_LIMITS.template.toLocaleString("he-IL")} תווים. שורות ריקות נשמרות כמו שהן.`}>
          <textarea
            id={`${id}-text`}
            ref={ref}
            rows={10}
            value={text}
            maxLength={STAGE_LIMITS.template}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${id}-text-hint`}
            className={`${INPUT} py-2 leading-relaxed`}
          />
        </Field>

        <details className="rounded-lg border border-line bg-paper p-3" open={!saved}>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">המשתנים והצורות</summary>
          <p className="mb-2 text-xs text-ink-soft">הקשה על משתנה מכניסה אותו לנוסח, במקום הסמן.</p>
          <ul aria-label="משתנים" className="space-y-1.5">
            {MESSAGE_VARIABLES.map((v) => (
              <li key={v} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Button onClick={() => insert(`{{${v}}}`)} aria-label={`הוספת {{${v}}} לנוסח`}>
                  <bdi>{`{{${v}}}`}</bdi>
                </Button>
                <span className="min-w-0 flex-1 basis-36 text-sm text-ink-soft">{VARIABLE_HELP[v]}</span>
              </li>
            ))}
          </ul>
          <ul aria-label="צורות" className="mt-3 space-y-1.5 border-t border-line pt-3">
            {FORMS.map((f) => (
              <li key={f.label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Button onClick={() => insert(f.insert, f.caret)} aria-label={`הוספת ${f.label} לנוסח`}>
                  <bdi>{f.label}</bdi>
                </Button>
                <span className="min-w-0 flex-1 basis-36 text-sm text-ink-soft">{f.help}</span>
              </li>
            ))}
          </ul>
        </details>

        {problem && (
          <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button kind="primary" type="submit" disabled={!dirty} busy={busy === "template"} busyLabel="שומר…">
            שמירת הנוסח
          </Button>
          {dirty && <Button onClick={() => setText(saved)}>ביטול השינויים</Button>}
          {saved && !deleting && (
            <Button ref={focusBack.ref()} kind="danger" className="ms-auto" onClick={() => setDeleting(true)}>
              מחיקת הנוסח
            </Button>
          )}
        </div>
        {deleting && (
          <Confirm
            text="למחוק את הנוסח? עד שיודבק נוסח חדש, אי אפשר לשלוח הודעות סיכום."
            confirm="מחיקה"
            busy={busy === "template-delete"}
            onConfirm={() => void remove()}
            onCancel={() => {
              setDeleting(false);
              focusBack.back();
            }}
          />
        )}
      </form>

      {text.trim() && (
        <section aria-label="תצוגה מקדימה של הנוסח" className="mt-4 space-y-2 border-t border-line pt-4">
          <h4 className="font-display font-semibold">תצוגה מקדימה, על שיעור לדוגמה</h4>
          <p className="text-xs text-ink-soft">
            שני 20:00, «כותרת לדוגמה», «חדר לדוגמה»{paid === "paid" ? `, ${SAMPLE_AMOUNT} לדוגמה` : ""}. התאריך הוא של המחזור{edition.start_date ? "" : " (עוד TBD)"}. שום דבר מזה לא נשמר.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Choice name={`${id}-sg`} legend="המרצה" value={speakerGender} options={[["f", "נקבה"], ["m", "זכר"]]} onChange={setSpeakerGender} />
            <Choice name={`${id}-me`} legend="השולח/ת" value={senderGender} options={[["f", "נקבה"], ["m", "זכר"]]} onChange={setSenderGender} />
            <Choice name={`${id}-pay`} legend="תשלום" value={paid} options={[["paid", "עם סכום"], ["free", "בהתנדבות"]]} onChange={setPaid} />
          </div>
          {myGender === null && SENDER_FORM.test(text) && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              הנוסח משתנה לפי מגדר השולח/ת, והמגדר שלך לא רשום ברשימת הצוות: הודעות שתשלח/י ייחסמו עד שיירשם.{" "}
              <Link to="/settings/team" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
                למגדר שלי ‹
              </Link>
            </p>
          )}
          {preview.problems.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <p className="font-semibold">בשיעור כזה ההודעה הייתה חסומה:</p>
              <ul aria-label="מה חסר בתצוגה" className="list-disc space-y-0.5 ps-5">
                {preview.problems.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="whitespace-pre-wrap break-words rounded-lg border border-line bg-paper p-3 text-sm leading-relaxed">{preview.text}</div>
        </section>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ the escorts' phrases

/** «משהו שחשוב לדעת»: the instructor's phrases, each with the lesson fact it applies to, in their order. */
function PhrasesPanel({ edition, onSaved }: { edition: Edition; onSaved: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const id = useId();
  const list = edition.settings.duty_phrases ?? [];
  const [when, setWhen] = useState<DutyWhen>("always");
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  /** The phrase whose «מחיקה» waits for a yes (by its row key, so a shifted list never asks about another) — a pasted phrase is not typed again lightly. */
  const [deleting, setDeleting] = useState<string | null>(null);
  // «ביטול» takes the confirm (and its focus) away: that row's «מחיקה» takes it back
  const focusBack = useFocusBack();
  const rowKey = (i: number, p: DutyPhrase) => `${i}:${p.when}:${p.text}`;
  const full = list.length >= STAGE_LIMITS.duty_count;

  const save = async (key: string, next: DutyPhrase[], ok: string) => {
    setProblem(null);
    const done = await run(key, () => port.setDutyPhrases(edition.id, next), ok, (code) => {
      if (code !== "bad_value") return false;
      setProblem(`${errorMessage(code)} עד ${STAGE_LIMITS.duty_count} ניסוחים, ועד ${STAGE_LIMITS.duty_text} תווים בכל אחד.`);
      return true;
    });
    if (done) await onSaved();
    return done;
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const lines = text
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ when, text: t }));
    if (lines.length === 0) return;
    if (await save("phrase-add", [...list, ...lines], lines.length === 1 ? "הניסוח נוסף" : `נוספו ${lines.length} ניסוחים`)) setText("");
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    void save(`phrase-move:${i}`, next, "הסדר נשמר");
  };

  return (
    <Panel title="«משהו שחשוב לדעת»: ניסוחים למלווים" aside={list.length === 0 ? <Badge tone="muted">ריק</Badge> : list.length === 1 ? "ניסוח אחד" : `${list.length} ניסוחים`}>
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          ברשימת המלווים, ליד כל שיעור, מופיעים הניסוחים שחלים עליו, בסדר שלהם, ואחריהם ההערה של השיעור. לעולם לא הסכום.
        </p>
        {list.length === 0 ? (
          <div className="rounded-lg border border-accent bg-accent-soft p-3 text-sm">
            <p className="font-semibold">עוד אין ניסוחים.</p>
            <p>מדביקים את הניסוחים מקובץ המלווים של אשתקד, בלי שמות ובלי מספרי טלפון. המערכת לא כותבת ניסוחים משלה.</p>
          </div>
        ) : (
          <Rows label="הניסוחים" head={["מתי", "ניסוח"]}>
            {list.map((p, i) => (
              <Row
                key={rowKey(i, p)}
                cells={[DUTY_WHEN_LABEL[p.when], p.text]}
                editing={
                  deleting === rowKey(i, p) ? (
                    <Confirm
                      text={<>למחוק את הניסוח? «{p.text}»</>}
                      confirm="מחיקה"
                      busy={busy === `phrase-del:${i}`}
                      onConfirm={() => void save(`phrase-del:${i}`, list.filter((_, j) => j !== i), "הניסוח נמחק").then((done) => done && setDeleting(null))}
                      onCancel={() => {
                        setDeleting(null);
                        focusBack.back(rowKey(i, p));
                      }}
                    />
                  ) : undefined
                }
                actions={
                  <>
                    <Button kind="quiet" disabled={i === 0 || !!busy} onClick={() => move(i, -1)} aria-label={`העברה למעלה: ${p.text}`}>
                      ↑
                    </Button>
                    <Button kind="quiet" disabled={i === list.length - 1 || !!busy} onClick={() => move(i, 1)} aria-label={`העברה למטה: ${p.text}`}>
                      ↓
                    </Button>
                    <Button ref={focusBack.ref(rowKey(i, p))} kind="danger" disabled={!!busy} onClick={() => setDeleting(rowKey(i, p))} aria-label={`מחיקת הניסוח: ${p.text}`}>
                      מחיקה
                    </Button>
                  </>
                }
              />
            ))}
          </Rows>
        )}
        <form onSubmit={(e) => void add(e)} aria-label="הוספת ניסוחים" className="space-y-3 rounded-lg border border-line bg-paper p-3" noValidate>
          <Field id={`${id}-when`} label="מתי הניסוח חל">
            <select id={`${id}-when`} value={when} onChange={(e) => setWhen(e.target.value as DutyWhen)} className={INPUT}>
              {DUTY_WHENS.map((w) => (
                <option key={w} value={w}>
                  {DUTY_WHEN_LABEL[w]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-text`} label="ניסוח (אפשר כמה, ניסוח בכל שורה)" hint={`עד ${STAGE_LIMITS.duty_text} תווים בכל ניסוח, ועד ${STAGE_LIMITS.duty_count} ניסוחים.`}>
            <textarea id={`${id}-text`} rows={3} value={text} disabled={full} onChange={(e) => setText(e.target.value)} aria-describedby={`${id}-text-hint`} className={`${INPUT} py-2`} />
          </Field>
          {problem && (
            <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
              {problem}
            </p>
          )}
          <Button kind="primary" type="submit" disabled={!text.trim() || full} busy={busy === "phrase-add"} busyLabel="מוסיף…">
            הוספה
          </Button>
        </form>
      </div>
    </Panel>
  );
}
