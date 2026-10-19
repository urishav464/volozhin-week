// The tables whose changes reach other open browsers. supabase/schema.sql adds
// exactly these to the supabase_realtime publication, and
// tests/sql/schema.test.ts holds the two lists equal. Never a table with
// personal data (speaker_contacts, members, activity, editions, roster): Realtime
// sends a DELETE's primary key to every signed-in subscriber, RLS or not.
export const REALTIME_TABLES = ["lessons", "lesson_speakers", "pitches", "approaches", "speakers"] as const;
