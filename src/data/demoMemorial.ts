// The fallen and their families' contacts in the demo: the engine's cross-year
// store (shared.fallen, shared.fallenContacts), by the same rules and refusal
// codes as the database. Synthetic only («חלל/ה לדוגמה 1»…, placeholder words).
import type { Engine } from "./engine";
import type { Fallen, FallenContacts, FallenFields, MemorialPort } from "./memorial";

export interface DemoMemorialStore {
  /** Any edition's engine: the fallen are one list across the years. */
  engine(editionId: number): Engine;
  readonly engines: Map<number, Engine>;
  notify(): void;
}

export class DemoMemorial implements MemorialPort {
  constructor(private readonly s: DemoMemorialStore) {}

  /** The newest edition's engine (its actor's role decides, as the database's RLS would for that member). */
  private e(): Engine {
    return this.s.engine(Math.max(...this.s.engines.keys()));
  }

  async fallen(): Promise<Fallen[]> {
    return this.e().fallenList();
  }

  async saveFallen(id: number | null, f: FallenFields): Promise<number> {
    const out = this.e().saveFallen(id, f);
    this.s.notify();
    return out;
  }

  async deleteFallen(id: number): Promise<void> {
    this.e().deleteFallen(id);
    this.s.notify();
  }

  async contacts(fallenId: number): Promise<FallenContacts | null> {
    return this.e().fallenContactsOf(fallenId);
  }

  async setContacts(fallenId: number, c: FallenContacts): Promise<void> {
    this.e().setFallenContacts(fallenId, c);
    this.s.notify();
  }
}
