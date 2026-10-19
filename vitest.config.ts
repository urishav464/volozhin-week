import { defineConfig } from "vitest/config";

// Two projects: `unit` is pure logic (fast, no services); `sql` runs
// supabase/schema.sql against a real PostgreSQL 16 (PG_ADMIN_URL) and proves
// the permission model as the roles a browser gets.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      {
        test: {
          name: "sql",
          include: ["tests/sql/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
