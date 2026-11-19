// «איפה אפשר לשבץ» on the speaker page (the reset, phase 2): the open slots of the week this speaker fits
// (src/domain/placement.ts) — free cells and drafts, by day, each day with its pair, mine first. «להציע כאן» is the
// grid's `propose`; on a day that is another pair's it asks first (they see in «היום שלי» that the placement is mine).
import { useRef, useState } from "react";
import type { DataPort } from "../../data/port";
import { byGender, displayName } from "../../domain/names";
import { type PlaceOption, placementFor, proposeMode, targetOf } from "../../domain/placement";
import { DAY_NAMES, fmtRange } from "../../domain/time";
import type { Speaker, Week } from "../../domain/types";
import { Chip } from "../../grid/bits";
import type { GridModel } from "../../grid/model";
import { Button, Confirm, Fold, useFocusBack, useFocusRescue, useRunner } from "../settings/kit";
import type { Notify } from "../speakers/parts";
import type { Actor } from "../weekStore";
import { namesOf, otherDayText } from "./page";

const optionKey = (o: Pick<PlaceOption, "day" | "start" | "lessonId">) => `${o.day}:${o.start}:${o.lessonId ?? ""}`;

export function PlacementSection({
  port,
  week,
  model,
  speaker: s,
  actor,
  notify,
  clear,
  reload,
}: {
  port: DataPort;
  week: Week;
  model: GridModel;
  speaker: Speaker;
  actor: Actor;
  notify: Notify;
  clear: () => void;
  reload: () => Promise<void>;
}) {
  const { busy, run } = useRunner(notify, clear);
  const [asking, setAsking] = useState<string | null>(null);
  const focus = useFocusBack();
  // a proposal takes its slot off the list (and the day, when it was the last): the focus to the section, not the page
  const rescue = useFocusRescue();
  const root = useRef<HTMLDivElement>(null);
  const days = placementFor(model, s.id, actor.memberId);
  const mode = proposeMode(model, s.id, actor.memberId);
  const handler = model.approachBySpeaker.get(s.id)?.owner_member_id ?? null;
  const handlerName = handler != null ? (model.memberName.get(handler) ?? "חבר/ת צוות") : null;
  const mayPropose = actor.canEdit && !s.retired;
  const label = mode === "offer" ? `להציע ל-${handlerName}` : "להציע כאן";
  const anyMine = days.some((d) => d.mine);

  const propose = async (o: PlaceOption) => {
    setAsking(null);
    const k = optionKey(o);
    const ok = await run(
      k,
      () => port.commands(week.edition.id).propose(s.id, targetOf(o), mode),
      mode === "offer" ? `${displayName(s)} ${byGender(s.gender, "הוצע", "הוצעה")} ל${handlerName}` : `${displayName(s)} ${byGender(s.gender, "הוצע", "הוצעה")} למשבצת`,
    );
    if (ok) await reload();
    rescue(() => root.current?.closest<HTMLElement>("section[tabindex]"));
  };

  if (days.length === 0)
    return (
      <div ref={root}>
        <p className="text-sm text-ink-soft">אין כרגע משבצת פנויה שמתאימה לזמינות.</p>
      </div>
    );

  return (
    <div ref={root} className="space-y-1">
      {mode === "offer" && handlerName && <p className="text-sm text-ink-soft">{`${displayName(s)} בטיפול ${handlerName}: ההצעה נשלחת ל${handlerName}, והטיפול לא עובר.`}</p>}
      {days.map((d) => {
        const owners = namesOf(week, d.owners);
        const partners = d.owners.filter((id) => id !== actor.memberId);
        const who = d.mine ? (partners.length > 0 ? `היום שלך, עם ${namesOf(week, partners)}` : "היום שלך") : (owners ?? "אין עדיין זוג ליום");
        const can = d.options.filter((o) => o.fit === "can").length;
        const count = `${d.options.length === 1 ? "משבצת אחת" : `${d.options.length} משבצות`}${can > 0 ? ` · ${can} ${byGender(s.gender, "יכול", "יכולה")}` : ""}`;
        const list = (
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {d.options.map((o) => {
              const k = optionKey(o);
              const ask = otherDayText(week, d.owners, actor.memberId);
              return (
                <li key={k} data-place-option={`${o.day}:${o.start}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5">
                  <span className="min-w-0 flex-1 basis-48">
                    <bdi dir="ltr" className="font-bold tabular-nums text-navy">
                      {fmtRange(o.start, o.end)}
                    </bdi>
                    {o.label && <span className="text-sm text-ink-soft"> · {o.label}</span>}
                    <span className="ms-2 inline-flex flex-wrap gap-1 align-middle">
                      {o.fit === "can" && <Chip tone="ok">{byGender(s.gender, "יכול", "יכולה")}</Chip>}
                      {o.candidates > 0 && <Chip>{o.candidates === 1 ? "יש מועמד/ת" : `${o.candidates} מועמדים`}</Chip>}
                    </span>
                  </span>
                  {mayPropose &&
                    (asking === k && ask ? (
                      <div className="w-full basis-full">
                        <Confirm
                          text={ask}
                          confirm={label}
                          danger={false}
                          busy={busy === k}
                          onConfirm={() => void propose(o)}
                          onCancel={() => {
                            setAsking(null);
                            focus.back(k);
                          }}
                        />
                      </div>
                    ) : (
                      <Button ref={focus.ref(k)} kind={d.mine ? "primary" : "secondary"} busy={busy === k} onClick={() => (ask ? setAsking(k) : void propose(o))}>
                        {label}
                      </Button>
                    ))}
                </li>
              );
            })}
          </ul>
        );
        // my days open; another pair's folded — unless I own none, then the days where they said «יכול/ה»
        return (
          <div key={d.day} data-place-day={d.day}>
            <Fold
              title={`יום ${DAY_NAMES[d.day]}`}
              hint={
                <>
                  {who} · {count}
                </>
              }
              defaultOpen={d.mine || (!anyMine && can > 0)}
            >
              {list}
            </Fold>
          </div>
        );
      })}
    </div>
  );
}
