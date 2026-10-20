// The speaker pool: search, filters, who-handles-whom, and the source of every
// placement (drag on a desktop, «שבץ» everywhere). A speaker's name opens their
// sheet; «+ מרצה חדש/ה» starts the search-first create flow with what was typed.
import { useMemo, useState } from "react";
import { byGender, displayName } from "../domain/names";
import { DAYS, DAY_NAMES, fmtRange } from "../domain/time";
import type { Gender, Speaker } from "../domain/types";
import { Chip, GenderDot } from "./bits";
import { type GridModel, POOL_SECTION_LABEL, type PoolSection, poolSection, speakerMatches } from "./model";

interface Props {
  model: GridModel;
  me: number;
  canEdit: boolean;
  placingId: number | null;
  onPlace: (speakerId: number) => void;
  /** The speaker sheet. */
  onOpen: (speakerId: number) => void;
  /** «+ מרצה חדש/ה», with the search box's text as the name to look up. */
  onCreate: (name: string) => void;
  /** Show the pool as the drop target "back to the pool". */
  dropTarget?: boolean;
}

const SECTIONS: PoolSection[] = ["mine", "free", "others", "closed", "declined"];

export function Pool({ model, me, canEdit, placingId, onPlace, onOpen, onCreate, dropTarget }: Props) {
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [category, setCategory] = useState<string>("");
  const [section, setSection] = useState<PoolSection>("free");

  const bySection = useMemo(() => {
    const out = new Map<PoolSection, Speaker[]>(SECTIONS.map((s) => [s, []]));
    for (const s of model.week.speakers) {
      if (s.retired) continue;
      if (gender && s.gender !== gender) continue;
      if (category && !s.topics.includes(category)) continue;
      if (!speakerMatches(s, query)) continue;
      out.get(poolSection(model, s.id, me))!.push(s);
    }
    for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name, "he"));
    return out;
  }, [model, me, query, gender, category]);

  const list = bySection.get(section) ?? [];

  return (
    <section aria-label="מאגר המרצים" data-drop={dropTarget ? "pool" : undefined} className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש מרצה, נושא או מוסד"
            aria-label="חיפוש מרצה"
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm"
          />
          {canEdit && (
            <button type="button" onClick={() => onCreate(query.trim())} className="min-h-11 shrink-0 rounded-lg bg-ink px-3 text-sm font-semibold text-paper hover:bg-ink/90">
              + מרצה חדש/ה
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <select aria-label="מגדר" value={gender} onChange={(e) => setGender(e.target.value as Gender | "")} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-sm">
            <option value="">כל המגדרים</option>
            <option value="f">נשים</option>
            <option value="m">גברים</option>
          </select>
          <select aria-label="קטגוריה" value={category} onChange={(e) => setCategory(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-sm">
            <option value="">כל הקטגוריות</option>
            {model.week.categories.filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div role="tablist" aria-label="מצב" className="flex flex-wrap gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
              className={`rounded-full border px-2.5 py-1 text-xs ${section === s ? "border-ink bg-ink text-paper" : "border-line bg-card text-ink-soft"}`}
            >
              {POOL_SECTION_LABEL[s]} <span className="tabular-nums opacity-80">{bySection.get(s)?.length ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {dropTarget && <p className="rounded-lg border-2 border-dashed border-accent bg-accent-soft p-2 text-center text-xs">שחררו כאן כדי להחזיר למאגר</p>}

      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pe-0.5" aria-label={POOL_SECTION_LABEL[section]}>
        {list.length === 0 && <li className="p-4 text-center text-sm text-ink-faint">אין כאן מרצים</li>}
        {list.map((s) => (
          <SpeakerCard key={s.id} model={model} speaker={s} section={section} canEdit={canEdit} placing={placingId === s.id} onPlace={() => onPlace(s.id)} onOpen={() => onOpen(s.id)} />
        ))}
      </ul>
    </section>
  );
}

function SpeakerCard({
  model,
  speaker: s,
  section,
  canEdit,
  placing,
  onPlace,
  onOpen,
}: {
  model: GridModel;
  speaker: Speaker;
  section: PoolSection;
  canEdit: boolean;
  placing: boolean;
  onPlace: () => void;
  onOpen: () => void;
}) {
  const a = model.approachBySpeaker.get(s.id);
  const owner = a?.owner_member_id != null ? model.memberName.get(a.owner_member_id) : undefined;
  const closedLesson = model.week.lessons.find((l) => l.state === "closed" && model.week.lessonSpeakers.some((x) => x.lesson_id === l.id && x.speaker_id === s.id));
  const draggable = canEdit && section !== "closed";
  return (
    <li
      data-drag={draggable ? `speaker:${s.id}` : undefined}
      data-drag-label={displayName(s)}
      data-speaker-id={s.id}
      className={`relative rounded-lg border bg-card p-2 ${placing ? "border-accent ring-2 ring-accent/40" : "border-line"} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <GenderDot gender={s.gender} />
        {/* The whole card is this button's target (a phone needs more than a line of text); «שבץ» sits above it. */}
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 truncate text-start text-sm font-semibold underline-offset-2 after:absolute after:inset-0 after:rounded-lg after:content-[''] hover:underline"
          aria-label={`כרטיס ${displayName(s)}`}
        >
          {displayName(s)}
        </button>
        {s.vetted !== "approved" && <Chip tone="warn">{byGender(s.gender, "ממתין", "ממתינה")} לאישור</Chip>}
      </div>
      {(s.bio_short || s.affiliation) && <p className="truncate text-xs text-ink-soft">{s.bio_short ?? s.affiliation}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {s.topics.slice(0, 2).map((t) => (
          <Chip key={t}>{t}</Chip>
        ))}
        <Availability model={model} speakerId={s.id} />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-soft">
        {section === "others" && owner && <span className="truncate">בטיפול: {owner}</span>}
        {section === "mine" && <span>{a?.status === "positive" ? "חיובי" : a?.status === "claimed" ? "נתפס/ה" : "פנית"}</span>}
        {section === "declined" && <span>{byGender(s.gender, "סירב", "סירבה")} השנה</span>}
        {section === "closed" && closedLesson && (
          <span className="truncate">
            {DAY_NAMES[closedLesson.day]} <bdi>{fmtRange(closedLesson.start_min, closedLesson.end_min)}</bdi>
          </span>
        )}
        {canEdit && section !== "closed" && (
          <button
            type="button"
            onClick={onPlace}
            aria-pressed={placing}
            className={`relative z-10 ms-auto rounded-md border px-2 py-0.5 text-xs font-semibold ${placing ? "border-accent bg-accent text-paper" : "border-line bg-paper hover:bg-line/50"}`}
          >
            {placing ? "בוחרים משבצת…" : "שבץ"}
          </button>
        )}
      </div>
    </li>
  );
}

function Availability({ model, speakerId }: { model: GridModel; speakerId: number }) {
  const a = model.approachBySpeaker.get(speakerId);
  if (!a) return null;
  const said = model.week.availability.filter((v) => v.approach_id === a.id);
  if (said.length === 0) return null;
  return (
    <span className="relative z-10 ms-auto inline-flex gap-0.5" aria-label="זמינות לפי ימים">
      {DAYS.map((d) => {
        const v = said.filter((x) => x.day === d);
        const tone = v.some((x) => x.kind === "cannot") ? "bg-red-300" : v.some((x) => x.kind === "can") ? "bg-emerald-400" : "bg-line";
        return <span key={d} title={`${DAY_NAMES[d]}: ${v.map((x) => `${x.kind === "can" ? "יכול/ה" : "לא"} ${fmtRange(x.from_min, x.to_min)}`).join(", ") || "לא נמסר"}`} className={`h-2 w-2.5 rounded-sm ${tone}`} />;
      })}
    </span>
  );
}
