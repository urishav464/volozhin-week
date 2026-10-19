// «חדרים» — an edition's rooms. A proposed speaker lands in the default room;
// the order decides which room a parallel lesson takes first. The database
// keeps exactly one default (set_default_room) and refuses deleting it or a
// room a lesson uses (rooms_guard).
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import type { Edition, Room } from "../../domain/types";
import { errorMessage } from "../../errors";
import { Badge, Button, Confirm, EditionPicker, Field, INPUT, LoadError, Loading, Panel, Row, Rows, useAction, useSettings } from "./kit";

interface Props {
  editions: Edition[];
  editionId: number | null;
  setEditionId: (id: number) => void;
}

export function RoomsTab({ editions, editionId, setEditionId }: Props) {
  const { port } = useSettings();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { busy, run } = useAction();

  const load = useCallback(async () => {
    if (editionId == null) return;
    setFailed(false);
    try {
      setRooms(await port.rooms(editionId));
    } catch {
      setFailed(true);
    }
  }, [port, editionId]);
  useEffect(() => {
    setRooms(null);
    void load();
  }, [load]);

  if (editions.length === 0) {
    return (
      <Panel title="חדרים">
        <p className="text-ink-soft">החדרים שייכים למחזור. קודם פותחים את המחזור של השנה (לשונית «מחזור»).</p>
      </Panel>
    );
  }

  const move = async (room: Room, by: -1 | 1) => {
    if (!rooms || editionId == null) return;
    const ids = rooms.map((r) => r.id);
    const i = ids.indexOf(room.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    if (await run(`move-${room.id}`, () => port.reorderRooms(editionId, ids), "הסדר נשמר")) await load();
  };

  return (
    <>
      <EditionPicker editions={editions} value={editionId} onChange={setEditionId} />
      {failed ? (
        <LoadError onRetry={() => void load()} />
      ) : !rooms || editionId == null ? (
        <Loading />
      ) : (
        <>
          <Panel title="חדרים" aside={rooms.length === 1 ? "חדר אחד" : `${rooms.length} חדרים`}>
            <p className="mb-3 text-sm text-ink-soft">מרצה שמשבצים נכנס/ת לחדר ברירת המחדל. בפיצול למקבילים, השיעור הנוסף הולך לחדר הפנוי הבא לפי הסדר כאן.</p>
            {rooms.length === 0 ? (
              <p className="text-ink-soft">עוד אין חדרים. החדר הראשון שמוסיפים יהיה ברירת המחדל.</p>
            ) : (
              <Rows label="חדרים" head={["חדר", ""]}>
                {rooms.map((r, i) => (
                  <RoomItem key={r.id} r={r} first={i === 0} last={i === rooms.length - 1} moving={busy === `move-${r.id}`} onMove={(by) => void move(r, by)} onChanged={load} />
                ))}
              </Rows>
            )}
          </Panel>
          <AddRoom key={editionId} editionId={editionId} onAdded={load} />
        </>
      )}
    </>
  );
}

function RoomItem({ r, first, last, moving, onMove, onChanged }: { r: Room; first: boolean; last: boolean; moving: boolean; onMove: (by: -1 | 1) => void; onChanged: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [mode, setMode] = useState<"view" | "rename" | "delete" | "used">("view");
  const [name, setName] = useState(r.name);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const cells = [r.name, r.is_default ? <Badge tone="accent">ברירת מחדל</Badge> : ""];

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const ok = await run("rename", () => port.renameRoom(r.id, name), "השם נשמר", (code) => {
      if (code !== "room_exists" && code !== "name_required") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) {
      setMode("view");
      await onChanged();
    }
  };
  const makeDefault = async () => {
    if (await run("default", () => port.setDefaultRoom(r.id), `«${r.name}» הוא עכשיו חדר ברירת המחדל`)) await onChanged();
  };
  const remove = async () => {
    const ok = await run("delete", () => port.deleteRoom(r.id), `«${r.name}» נמחק`, (code) => {
      if (code !== "room_in_use") return false;
      setMode("used"); // said in the row, like a member or a category with history
      return true;
    });
    if (ok) await onChanged();
    else setMode((m) => (m === "delete" ? "view" : m));
  };

  if (mode === "rename") {
    return (
      <Row
        cells={cells}
        editing={
          <form onSubmit={rename} className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-paper p-3" noValidate>
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-48">
              <Field id={`${id}-name`} label="שם החדר">
                <input id={`${id}-name`} className={INPUT} value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <Button kind="primary" type="submit" busy={busy === "rename"} busyLabel="שומר…">
              שמירה
            </Button>
            <Button
              onClick={() => {
                setName(r.name);
                setProblem(null);
                setMode("view");
              }}
            >
              ביטול
            </Button>
            {problem && (
              <p role="alert" className="w-full text-sm text-bad">
                {problem}
              </p>
            )}
          </form>
        }
      />
    );
  }
  if (mode === "used") {
    return (
      <Row
        cells={cells}
        editing={
          <div role="group" aria-label="אי אפשר למחוק" className="rounded-lg border border-line bg-paper p-3 text-sm">
            <p className="mb-2">
              <b>{r.name}</b>: {errorMessage("room_in_use")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button kind="primary" autoFocus onClick={() => setMode("rename")}>
                שינוי שם
              </Button>
              <Button onClick={() => setMode("view")}>הבנתי</Button>
            </div>
          </div>
        }
      />
    );
  }
  if (mode === "delete") {
    return (
      <Row
        cells={cells}
        editing={
          <Confirm
            text={
              <>
                למחוק את החדר <b>{r.name}</b>? אפשר רק כשאין בו שיעורים.
              </>
            }
            confirm="מחיקה"
            busy={busy === "delete"}
            onConfirm={() => void remove()}
            onCancel={() => setMode("view")}
          />
        }
      />
    );
  }
  return (
    <Row
      cells={cells}
      actions={
        // ↑↓ come last, so they sit at the same edge in every row (the default room has fewer buttons)
        <>
          {!r.is_default && (
            <Button kind="quiet" busy={busy === "default"} onClick={() => void makeDefault()} aria-label={`קביעת ${r.name} כחדר ברירת המחדל`}>
              לקבוע כברירת מחדל
            </Button>
          )}
          <Button kind="quiet" onClick={() => setMode("rename")} aria-label={`שינוי השם של ${r.name}`}>
            שינוי שם
          </Button>
          {!r.is_default && (
            <Button kind="danger" onClick={() => setMode("delete")} aria-label={`מחיקת ${r.name}`}>
              מחיקה
            </Button>
          )}
          <Button kind="quiet" disabled={first || moving} onClick={() => onMove(-1)} aria-label={`הזזת ${r.name} למעלה`} title="למעלה">
            ↑
          </Button>
          <Button kind="quiet" disabled={last || moving} onClick={() => onMove(1)} aria-label={`הזזת ${r.name} למטה`} title="למטה">
            ↓
          </Button>
        </>
      }
    />
  );
}

function AddRoom({ editionId, onAdded }: { editionId: number; onAdded: () => Promise<void> }) {
  const { port } = useSettings();
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const shown = name.trim();
    const ok = await run("add", () => port.addRoom(editionId, name), `החדר «${shown}» נוסף`, (code) => {
      if (code !== "room_exists" && code !== "name_required") return false;
      setProblem(errorMessage(code));
      return true;
    });
    if (ok) {
      setName("");
      await onAdded();
    }
  };
  return (
    <Panel title="הוספת חדר">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate>
        <div className="min-w-0 flex-1 basis-56">
          <Field id={`${id}-name`} label="שם החדר">
            <input id={`${id}-name`} className={INPUT} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button kind="primary" type="submit" busy={busy === "add"} busyLabel="מוסיף…" disabled={!name.trim()}>
          הוספה
        </Button>
        {problem && (
          <p role="alert" className="w-full text-sm text-bad">
            {problem}
          </p>
        )}
      </form>
    </Panel>
  );
}
