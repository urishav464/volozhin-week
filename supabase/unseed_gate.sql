-- Removes the decision gate's practice week (seed_gate.sql): the «הדגמה»
-- edition with everything in it, and every synthetic speaker — the seeded ones
-- and those the team added from a demo edition (create_speaker marks them).
-- A synthetic speaker some other edition still uses (a lesson, or a handler)
-- stays. Safe to run twice. Touches nothing that is not synthetic.
begin;
delete from public.editions where label = 'הדגמה' and kind = 'demo';
delete from public.speakers s
 where s.source = 'synthetic'
   and not exists (select 1 from public.lesson_speakers x where x.speaker_id = s.id)
   and not exists (select 1 from public.approaches a where a.speaker_id = s.id);
commit;
