-- Removes the decision gate's practice week (seed_gate.sql): the «הדגמה»
-- edition with everything in it, and every synthetic speaker — the seeded ones
-- and those the team added from a demo edition (create_speaker marks them).
-- A synthetic speaker some other edition still uses (a lesson, a handler, or
-- a slot of availability — v14) stays. Safe to run twice. Touches nothing that is not synthetic.
-- Files someone uploaded in the practice week (v10) lose their rows with the
-- edition; their bytes stay in Storage — SQL may not delete them (only the
-- Storage API can) — so the run says where they are, to delete in the dashboard.
begin;
do $$
declare v_ed bigint; v_n integer;
begin
  select id into v_ed from public.editions where label = 'הדגמה' and kind = 'demo';
  if v_ed is not null and to_regclass('public.source_files') is not null then
    execute 'select count(*) from public.source_files where edition_id = $1' into v_n using v_ed;
    if v_n > 0 then
      raise notice '% uploaded file(s) of the practice week stay in Storage: Storage → Files → sources → folder % (right-click → Delete)', v_n, v_ed;
    end if;
  end if;
end $$;
delete from public.editions where label = 'הדגמה' and kind = 'demo';
delete from public.speakers s
 where s.source = 'synthetic'
   and not exists (select 1 from public.lesson_speakers x where x.speaker_id = s.id)
   and not exists (select 1 from public.approaches a where a.speaker_id = s.id)
   and not exists (select 1 from public.slot_availability v where v.speaker_id = s.id);
commit;
