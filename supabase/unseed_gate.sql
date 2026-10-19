-- Removes the decision gate's practice week (seed_gate.sql): the «הדגמה»
-- edition with everything in it, and every synthetic speaker. Safe to run
-- twice. Touches nothing that is not synthetic.
begin;
delete from public.editions where label = 'הדגמה' and kind = 'demo';
delete from public.speakers s
 where s.source = 'synthetic'
   and not exists (select 1 from public.lesson_speakers x where x.speaker_id = s.id);
commit;
