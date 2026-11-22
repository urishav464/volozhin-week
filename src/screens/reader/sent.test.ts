// «נשלח לדפוס» on /reader (src/screens/reader/sent.ts): who may mark it (≡ app.require_logistics) and what the panel says.
import { describe, expect, it } from "vitest";
import { emptyWeek } from "../../testing/week";
import { afterSentLine, maySendReader, sentLine } from "./sent";

describe("maySendReader", () => {
  const live = { kind: "real" as const, status: "active" as const };
  it("logistics and the edition's admins; a content member never; an archived edition (or an archive) its admins only", () => {
    expect(maySendReader({ isAdmin: false, role: "logistics" }, live)).toBe(true);
    expect(maySendReader({ isAdmin: true, role: "admin" }, live)).toBe(true);
    expect(maySendReader({ isAdmin: false, role: "content" }, live)).toBe(false);
    expect(maySendReader({ isAdmin: false, role: "logistics" }, { kind: "real", status: "archived" })).toBe(false);
    expect(maySendReader({ isAdmin: false, role: "logistics" }, { kind: "archive", status: "active" })).toBe(false);
    expect(maySendReader({ isAdmin: true, role: "admin" }, { kind: "real", status: "archived" })).toBe(true);
  });
});

describe("sentLine", () => {
  it("not marked; marked — the day and the time in Israel, and who", () => {
    const w = emptyWeek();
    expect(sentLine(w)).toBe("עוד לא סומן שהמקראה נשלחה לדפוס.");
    const team = [{ id: 5, display_name: "לוגיסטיקה לדוגמה" }];
    // 22:05 UTC on 7.2 is 00:05 on 8.2 in Israel (UTC+2 in winter)
    w.edition.settings = { ...w.edition.settings, reader_sent: { at: "2027-02-07T22:05:00.000Z", by: 5 } };
    expect(sentLine(w, team)).toBe("נשלחה לדפוס ב-8.2.2027 בשעה 00:05 · סימן/ה: לוגיסטיקה לדוגמה.");
    // a member who left the team, or none recorded: no name
    expect(sentLine(w, [])).toBe("נשלחה לדפוס ב-8.2.2027 בשעה 00:05.");
    w.edition.settings = { ...w.edition.settings, reader_sent: { at: "2027-02-07T10:00:00.000Z", by: null } };
    expect(sentLine(w, team)).toBe("נשלחה לדפוס ב-7.2.2027 בשעה 12:00.");
  });
});

describe("afterSentLine", () => {
  it("nothing when none; one file; N files", () => {
    expect(afterSentLine(0)).toBeNull();
    expect(afterSentLine(1)).toBe("נוסף קובץ אחד אחרי השליחה — אולי צריך לשלוח שוב.");
    expect(afterSentLine(3)).toBe("נוספו 3 קבצים אחרי השליחה — אולי צריך לשלוח שוב.");
  });
});
