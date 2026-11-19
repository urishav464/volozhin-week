// What a candidate's card and the lesson page's steps do (src/grid/Panels.tsx PanelActions), for the lesson page: the
// week's own commands with the week's own words (src/screens/WeekScreen.tsx), the page's toast instead of the grid's,
// and a speaker opened as their page (/speakers/:id), not a sheet beside the grid.
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { CommandError, type LessonPatch } from "../../data/commands";
import type { DataPort } from "../../data/port";
import { byGender, displayName } from "../../domain/names";
import { speakerPath } from "../../domain/routes";
import type { Speaker } from "../../domain/types";
import { errorMessage } from "../../errors";
import { type GridModel, pitchSpeaker } from "../../grid/model";
import type { PanelActions } from "../../grid/Panels";
import { statusLabel } from "../../lib/labels";
import type { Notify } from "../speakers/parts";

export function useLessonActions(port: DataPort, editionId: number, model: GridModel, notify: Notify, clear: () => void, reload: () => Promise<void>): PanelActions {
  const navigate = useNavigate();
  const cmds = useMemo(() => port.commands(editionId), [port, editionId]);

  /** A command, the week again, and what happened (or why not) — a stale screen is read again either way. */
  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      clear();
      try {
        await fn();
        await reload();
        if (ok) notify("ok", ok);
        return true;
      } catch (e) {
        const code = e instanceof CommandError ? e.code : null;
        notify("error", errorMessage(code));
        if (code === "stale") await reload();
        return false;
      }
    },
    [notify, clear, reload],
  );

  return useMemo((): PanelActions => {
    const name = (s: Speaker | undefined) => (s ? displayName(s) : "המרצה");
    return {
      propose: (speakerId, target, mode = "self") =>
        void run(() => cmds.propose(speakerId, target, mode), `${name(model.speakerById.get(speakerId))} ${mode === "offer" ? "הוצע/ה לאחראי/ת" : "סומן/ה למשבצת"}`),
      unpropose: (id) => void run(() => cmds.unpropose(id), "הוסר/ה מהמשבצת"),
      revive: (id) => {
        const p = model.week.pitches.find((x) => x.id === id);
        const s = p && pitchSpeaker(model, p);
        void run(() => cmds.setPitch(id, "candidate"), `${name(s)} ${byGender(s?.gender, "חזר", "חזרה")} לתהליך`);
      },
      // v14: the call's result is the approach's status, recorded with what was said
      callResult: (a, status, note) => {
        const s = model.speakerById.get(a.speaker_id);
        return run(() => port.speakers.setStatus(editionId, a.id, a.version, status, note), `עודכן: ${name(s)} · ${statusLabel(status, s?.gender ?? null)}`);
      },
      approveSpeaker: (id) => {
        const s = model.speakerById.get(id);
        return run(() => port.speakers.vet([id], "approved", null), `${name(s)} ${byGender(s?.gender, "אושר", "אושרה")}`);
      },
      close: (id) => run(() => cmds.closeLesson(id), "השיעור נסגר"),
      reopen: (id) => void run(() => cmds.reopenLesson(id), "השיעור חזר לטיוטה"),
      update: (id, version, patch: LessonPatch) => void run(() => cmds.updateLesson(id, version, patch), "נשמר"),
      reshape: (day, rowStart, op) => void run(() => cmds.reshape(day, rowStart, op), "המשבצת עוצבה מחדש"),
      openSpeaker: (id) => navigate(speakerPath(id)),
    };
  }, [cmds, editionId, model, port, run, navigate]);
}
