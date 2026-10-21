// «מעבר לשנה הבאה» and the purge's default: the edition a year closes — never an archive the import made (it was
// never open, and its id is the newest), unless there is nothing else.
import { describe, expect, it } from "vitest";
import type { Edition } from "../../domain/types";
import { closingEdition } from "./AfterWeek";

const ed = (id: number, label: string, kind: Edition["kind"], status: Edition["status"] = "planning"): Edition => ({
  id, label, kind, status, start_date: null, first_day_from: null, last_day_until: 1140, settings: {},
});
const archive = ed(9, "תשפ\"ו לדוגמה", "archive", "archived");

describe("closingEdition", () => {
  it("the live real edition, whatever an import made after it", () => {
    expect(closingEdition([ed(1, "תשפ\"ז", "real"), archive])?.label).toBe("תשפ\"ז");
  });

  it("no live real edition: the newest that is not an import's archive — the demo, a practice week, last year's real one", () => {
    expect(closingEdition([ed(1, "הדגמה", "demo"), archive])?.label).toBe("הדגמה");
    expect(closingEdition([ed(1, "תרגול", "practice"), archive])?.label).toBe("תרגול");
    expect(closingEdition([ed(1, "תשפ\"ז", "real", "archived"), archive])?.label).toBe("תשפ\"ז");
    expect(closingEdition([archive])).toBeNull();
  });
});
