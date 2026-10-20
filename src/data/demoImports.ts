// The import of 5786 in demo mode: the commit runs on src/data/engine.ts — the engine tests/parity holds to the SQL —
// so the wizard refuses, matches and replaces exactly as production does. An archive edition becomes one more of the
// demo's engines (its own edition, the 2026 grid, the shared pool), so «לימד/ה אצלנו» shows it at once. The demo
// user is the global admin. Nothing leaves the tab; the sample tables are synthetic (src/import/sample.ts).
import { titlesOf } from "./speakerRules";
import type { Category, Week } from "../domain/types";
import type { Engine, ImportHost } from "./engine";
import type { ImportCommit, ImportLookup, ImportPort, ImportResult } from "./imports";

/** What DemoPort shares with the import. */
export interface DemoImportStore {
  readonly engines: Map<number, Engine>;
  categories: Category[];
  /** The archive's week: a new engine, or the edition of that label with its week replaced. */
  installWeek(week: Week): void;
  /** After a command: the pool to every engine, and open screens told. */
  poolChanged(from: Engine): void;
}

const nextId = (rows: { id: number }[]) => Math.max(0, ...rows.map((r) => r.id)) + 1;

export class DemoImports implements ImportPort {
  constructor(private readonly s: DemoImportStore) {}

  private any(): Engine {
    return [...this.s.engines.values()][0];
  }

  private weeks(): Week[] {
    return [...this.s.engines.values()].map((e) => e.week);
  }

  private host(): ImportHost {
    return {
      titles: (id) => titlesOf(id == null ? null : this.s.engines.get(id)?.week.edition.settings),
      byLabel: (label) => {
        const w = this.weeks().find((x) => x.edition.label === label);
        return w ? { kind: w.edition.kind, week: w.edition.kind === "archive" ? w : null } : null;
      },
      categoryIds: () => new Set(this.s.categories.map((c) => c.id)),
      nextEditionId: () => nextId(this.weeks().map((w) => w.edition)),
      nextRoomId: () => nextId(this.weeks().flatMap((w) => w.rooms)),
      install: (week) => this.s.installWeek(week),
    };
  }

  async pool() {
    return structuredClone(this.any().week.speakers);
  }

  async lookup(speakerIds: number[], phoneKeys: string[]): Promise<ImportLookup> {
    return structuredClone(this.any().importLookup(speakerIds, phoneKeys));
  }

  async commit(c: ImportCommit): Promise<ImportResult> {
    const e = this.any();
    try {
      return structuredClone(e.importCommit(c.kind, c.payload, this.host()));
    } finally {
      this.s.poolChanged(e);
    }
  }
}
