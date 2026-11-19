// The demo runs on src/data/engine.ts; production runs on supabase/schema.sql.
// Both claim to implement docs/CONTRACT.md. This holds them to it: every
// scenario, every step — the same result code and the same state; and where a
// step pins its answer (`is`, the v18 scenarios), that answer on both.
import { describe, expect, it } from "vitest";
import { engineDriver } from "./engineDriver";
import { SCENARIOS } from "./scenarios";
import { sqlDriver } from "./sqlDriver";

describe("engine ≡ SQL", () => {
  for (const [name, steps] of Object.entries(SCENARIOS)) {
    it(name, async () => {
      const engine = engineDriver();
      const sql = await sqlDriver(`vw_parity_${process.pid}_${Object.keys(SCENARIOS).indexOf(name)}`);
      try {
        for (const [i, step] of steps.entries()) {
          const label = `step ${i + 1}: ${JSON.stringify(step)}`;
          const [a, b] = [await engine.run(step), await sql.run(step)];
          expect(b, `${label} — SQL vs engine result`).toBe(a);
          // a step that says what the contract answers (`is`): the two agreeing is not enough
          if (step.is !== undefined) expect(a, `${label} — the answer the scenario pins`).toBe(step.is);
          expect(await sql.state(), `${label} — state`).toEqual(await engine.state());
        }
      } finally {
        await sql.close();
      }
    });
  }
});
