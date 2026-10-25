-- =============================================================================
-- The decision gate's practice week — on the real server, synthetic only.
--
-- Run in the SQL Editor AFTER schema.sql. Creates an edition «הדגמה» (kind
-- 'demo') on the 2026 grid with three rooms, 60 synthetic speakers
-- («מרצה לדוגמה 01»…, source 'synthetic') and last year's shapes: closed
-- lessons, a parallel pair, a 60+30 split, the all-night merge, a speaker who
-- cannot do mornings. Running it twice changes nothing.
--
-- After the gate: run unseed_gate.sql — it removes the edition and every
-- synthetic speaker. No real name, phone or date is in this file.
-- =============================================================================

begin;

do $$
declare
  v_ed     bigint;
  v_room   bigint[];
  v_sp     bigint[];
  v_titles text[] := array['ד״ר', 'ד״ר', 'פרופ׳', 'פרופ׳', 'הרב', 'הרבנית', null, null];
  v_gender text[] := array['m', 'f', 'm', 'f', 'm', 'f', 'm', 'f'];
  v_cats   text[];
  i        integer;
  v_l      bigint;
  v_a      bigint;
  r        record;
begin
  if exists (select 1 from public.editions where label = 'הדגמה') then
    raise notice 'seed_gate: «הדגמה» already exists — nothing to do';
    return;
  end if;

  insert into public.editions (label, kind, first_day_from, settings)
  values ('הדגמה', 'demo', 510, '{"lesson_minutes": 75, "row_minutes": 90}'::jsonb)
  returning id into v_ed;
  insert into public.grid_rows (edition_id, start_min, end_min, kind, label, days)
  select v_ed, start_min, end_min, kind, label, days from public.grid_template;
  insert into public.rooms (edition_id, name, sort, is_default) values
    (v_ed, 'בית מדרש', 1, true), (v_ed, 'חדר לדוגמה 2', 2, false), (v_ed, 'חדר לדוגמה 3', 3, false);
  select array_agg(id order by sort) into v_room from public.rooms where edition_id = v_ed;

  select array_agg(name order by sort) into v_cats from public.categories;
  for i in 1..60 loop
    insert into public.speakers (title, name, gender, affiliation, bio_short, topics, vetted, source)
    values (v_titles[(i - 1) % 8 + 1], 'מרצה לדוגמה ' || lpad(i::text, 2, '0'),
            case when i = 60 then null else v_gender[(i - 1) % 8 + 1] end,
            'מוסד לדוגמה', 'נתון לדוגמה — ' || v_cats[(i - 1) % 10 + 1],
            array[v_cats[(i - 1) % 10 + 1]],
            case when i > 55 then 'pending' else 'approved' end, 'synthetic')
    on conflict do nothing;
  end loop;
  select array_agg(id order by name) into v_sp from public.speakers where source = 'synthetic';

  -- Closed lessons (day, start, end, speaker #, room #).
  for r in select * from (values
      (0, 510, 600, 1, 1), (0, 600, 690, 3, 1), (0, 690, 780, 5, 1), (0, 870, 960, 7, 1), (0, 1470, 1560, 2, 1),
      (1, 510, 600, 4, 1), (1, 600, 690, 25, 1), (1, 870, 930, 8, 1), (1, 930, 960, 27, 1), (1, 1200, 1290, 12, 1), (1, 1470, 1740, 29, 1),  -- Monday: three women, three men
      (2, 510, 600, 21, 1), (2, 600, 690, 31, 1), (2, 960, 1050, 16, 1), (2, 960, 1050, 17, 2),
      (3, 600, 690, 19, 1), (3, 690, 780, 20, 1),
      (4, 1050, 1140, 24, 1)
    ) as x(day, s, e, sp, rm)
  loop
    insert into public.lessons (edition_id, state, day, start_min, end_min, room_id, title, category_id, parallel_reason)
    values (v_ed, 'closed', r.day, r.s, r.e, v_room[r.rm], 'שיעור לדוגמה',
            (select c.id from public.categories c where c.name = v_cats[(r.sp - 1) % 10 + 1]),
            case when r.rm = 2 then 'דוגמה לשיעורים מקבילים' end)
    returning id into v_l;
    insert into public.approaches (edition_id, speaker_id, status) values (v_ed, v_sp[r.sp], 'positive')
      on conflict (edition_id, speaker_id) do nothing;
    insert into public.lesson_speakers (lesson_id, speaker_id, role, edition_id, span) values (v_l, v_sp[r.sp], 'lead', v_ed, 'empty');
    insert into public.pitches (edition_id, lesson_id, approach_id, state)
      select v_ed, v_l, a.id, 'accepted' from public.approaches a where a.edition_id = v_ed and a.speaker_id = v_sp[r.sp];
  end loop;

  -- A speaker who cannot do mornings on Sunday (the "unavailable" task).
  insert into public.approaches (edition_id, speaker_id, status) values (v_ed, v_sp[9], 'claimed') returning id into v_a;
  insert into public.availability (approach_id, day, from_min, to_min, kind, note) values (v_a, 0, 390, 780, 'cannot', 'דוגמה: לא בבקרים');

  -- Memorial slots: placeholders only; the names of the fallen are entered by the instructor, never seeded.
  -- Both memorial rows, before lunch and after it — the same slot (v13): ten in the week.
  for i in 0..4 loop
    insert into public.lessons (edition_id, kind, day, start_min, end_min, room_id, title)
    values (v_ed, 'memorial', i, 780, 795, v_room[1], 'זמן זיכרון'), (v_ed, 'memorial', i, 855, 870, v_room[1], 'זמן זיכרון');
  end loop;
end $$;

commit;
