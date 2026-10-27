// One group's card on /kk: its name (the book, or — before the book — its leaders), the author, the place, the leaders,
// the sign-ups against the capacity (behind their count; an admin moves one to another group or removes it), the books
// to order (a group with a book), and the admin's «עריכה» and «מחיקה».
import { useId, useMemo, useState } from "react";
import type { KkData, KkGroup } from "../../data/kk";
import type { DataPort } from "../../data/port";
import { LEADER_KIND_LABEL, groupName, leaderName, leadersOf } from "../../domain/kk";
import type { Week } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Badge, Button, Confirm, Fold, useFocusBack } from "../settings/kit";
import { BookOrder } from "./BookOrder";
import { GroupForm } from "./GroupForm";
import type { Act } from "./parts";

export function GroupCard({ g, groups, week, kk, admin, books, busy, act, port }: { g: KkGroup; groups: KkGroup[]; week: Week; kk: KkData; admin: boolean; books: boolean; busy: string | null; act: Act; port: DataPort }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // the form or the confirm closed: the button that opened it has the focus back
  const focusBack = useFocusBack();
  const names = useMemo(() => new Map(week.roster.map((r) => [r.id, r.full_name])), [week.roster]);
  const name = groupName(g, kk, week.roster);
  const leaders = leadersOf(kk, g.id);
  const signups = kk.signups.filter((s) => s.group_id === g.id).sort((a, b) => (names.get(a.roster_id) ?? "").localeCompare(names.get(b.roster_id) ?? "", "he"));
  const full = g.capacity != null && signups.length >= g.capacity;
  const count = g.capacity != null ? `נרשמו ${signups.length} מתוך ${g.capacity}` : signups.length === 1 ? "נרשם/ה אחד/ת" : `נרשמו ${signups.length}`;
  const others = groups.filter((x) => x.id !== g.id).map((x) => ({ id: x.id, name: groupName(x, kk, week.roster) }));

  if (editing) {
    return (
      <GroupForm
        week={week}
        kk={kk}
        title={`עריכה · ${name}`}
        initial={{ g, leaders }}
        busy={busy === `edit-${g.id}`}
        onCancel={() => {
          setEditing(false);
          focusBack.back("edit");
        }}
        onSave={async (fields, onRefused) => {
          const ok = await act(`edit-${g.id}`, () => port.kk.updateGroup(g.id, fields), "הקבוצה נשמרה", onRefused);
          if (ok) {
            setEditing(false);
            focusBack.back("edit");
          }
        }}
      />
    );
  }
  return (
    <article aria-label={name} data-kk-group={g.id} className="space-y-2 rounded-lg border border-line bg-paper/40 p-3">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <h4 className="font-semibold break-words">
            {name}
            {g.author && <span className="font-normal"> — {g.author}</span>}
          </h4>
          <p className="text-sm text-ink-soft break-words">
            {[g.place ?? "עוד אין מרחב", leaders.length ? `מעבירים: ${leaders.map((x) => `${leaderName(x, week.roster)} (${LEADER_KIND_LABEL[x.kind]})`).join(", ")}` : "עוד אין מעבירים"].join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {g.title == null && <Badge tone="accent">עוד לא מוצעת בקישור</Badge>}
          {g.title != null && g.capacity == null && <Badge tone="accent">אין תפוסה: לא מוצעת בקישור</Badge>}
          {!g.open && <Badge tone="muted">סגורה להרשמה</Badge>}
          {full && <Badge tone="neutral">מלאה</Badge>}
        </div>
      </div>
      {signups.length === 0 ? (
        <p className="text-sm font-semibold" data-kk-count>
          {count}
        </p>
      ) : (
        // the names behind their count: open, the list — and for an admin, moving one or removing them
        <Fold title={<span data-kk-count>{count}</span>} size="sm">
          <ul aria-label={`הנרשמים · ${name}`} className="divide-y divide-line rounded-md border border-line bg-card">
            {signups.map((s) => (
              <SignupItem
                key={s.id}
                name={names.get(s.roster_id) ?? "חניך/ה שנמחק/ה"}
                via={s.via}
                group={name}
                others={others}
                admin={admin}
                moveBusy={busy === `move-${s.id}`}
                removeBusy={busy === `remove-${s.id}`}
                onMove={(to) => act(`move-${s.id}`, () => port.kk.place(to, s.roster_id), "ההרשמה הועברה")}
                onRemove={() => act(`remove-${s.id}`, () => port.kk.unplace(week.edition.id, s.roster_id), "ההרשמה הוסרה")}
              />
            ))}
          </ul>
        </Fold>
      )}
      {g.title != null && <BookOrder g={g} kk={kk} signed={signups.length} leaders={leaders.length} editable={books} folded busy={busy} act={act} port={port} />}
      {problem && (
        <p role="alert" className="text-sm text-bad">
          {problem}
        </p>
      )}
      {admin &&
        (deleting ? (
          <Confirm
            text={
              <>
                למחוק את הקבוצה <b>{name}</b>?{signups.length > 0 && " יש בה נרשמים: קודם מעבירים אותם או מסירים."}
              </>
            }
            confirm="מחיקה"
            busy={busy === `delete-${g.id}`}
            onConfirm={() =>
              void act(`delete-${g.id}`, () => port.kk.deleteGroup(g.id), "הקבוצה נמחקה", (code) => {
                if (code !== "group_has_signups") return false;
                setProblem(errorMessage(code));
                return true;
              }).then((ok) => {
                setDeleting(false);
                if (!ok) focusBack.back("delete");
              })
            }
            onCancel={() => {
              setDeleting(false);
              focusBack.back("delete");
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-1">
            <Button
              ref={focusBack.ref("edit")}
              onClick={() => {
                setProblem(null);
                setEditing(true);
              }}
              aria-label={`עריכה: ${name}`}
            >
              עריכה
            </Button>
            <Button
              ref={focusBack.ref("delete")}
              kind="danger"
              onClick={() => {
                setProblem(null);
                setDeleting(true);
              }}
              aria-label={`מחיקה: ${name}`}
            >
              מחיקה
            </Button>
          </div>
        ))}
    </article>
  );
}

/** One sign-up: the name and how it came; for an admin, a move to another group and «הסרה» (asked first). */
function SignupItem({
  name,
  via,
  group,
  others,
  admin,
  moveBusy,
  removeBusy,
  onMove,
  onRemove,
}: {
  name: string;
  via: "link" | "staff";
  /** The group it is in, by its name on screen. */
  group: string;
  others: { id: number; name: string }[];
  admin: boolean;
  moveBusy: boolean;
  removeBusy: boolean;
  onMove: (to: number) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const id = useId();
  const [removing, setRemoving] = useState(false);
  // «ביטול» (or a refusal) takes the confirm away: «הסרה» takes the focus back
  const focusBack = useFocusBack();
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
      <span className="min-w-0 flex-1 basis-32 break-words">
        {name} <span className="text-xs text-ink-soft">{via === "link" ? "· בקישור" : "· שובץ/ה בידי הצוות"}</span>
      </span>
      {admin &&
        (removing ? (
          <div className="w-full">
            <Confirm
              text={
                <>
                  להסיר את ההרשמה של <b>{name}</b>?
                </>
              }
              confirm="הסרה"
              busy={removeBusy}
              onConfirm={() =>
                void onRemove().then((ok) => {
                  setRemoving(false);
                  if (!ok) focusBack.back();
                })
              }
              onCancel={() => {
                setRemoving(false);
                focusBack.back();
              }}
            />
          </div>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {others.length > 0 && (
              <>
                <label htmlFor={`${id}-m`} className="sr-only">
                  העברה של {name} לקבוצה אחרת
                </label>
                <select
                  id={`${id}-m`}
                  value=""
                  disabled={moveBusy}
                  onChange={(e) => e.target.value && void onMove(Number(e.target.value))}
                  className="min-h-11 max-w-48 rounded-lg border border-line bg-card px-2 text-sm"
                >
                  <option value="">{`בקבוצה: ${group}`}</option>
                  {others.map((x) => (
                    <option key={x.id} value={x.id}>
                      {`העברה ל: ${x.name}`}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button ref={focusBack.ref()} kind="danger" onClick={() => setRemoving(true)} aria-label={`הסרה: ${name}`}>
              הסרה
            </Button>
          </span>
        ))}
    </li>
  );
}
