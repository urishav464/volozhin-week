// Must equal public.schema_version() in supabase/schema.sql. Bump both in the
// same commit as any structural change; a mismatch shows the "re-run
// schema.sql" screen instead of failing somewhere deep inside a screen.
export const EXPECTED_SCHEMA_VERSION = 1;
