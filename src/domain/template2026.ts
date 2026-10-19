// The 2026 poster's grid, row for row — the seed every new edition starts from.
// supabase/schema.sql seeds the same rows into grid_template (insert-if-empty);
// tests/sql checks the two agree. Labels are the poster's own words.
import type { GridRow } from "./types";
import { DAYS } from "./time";

const ALL = [...DAYS];
let id = 0;
const row = (start_min: number, end_min: number, kind: GridRow["kind"], label: string): GridRow => ({
  id: ++id,
  start_min,
  end_min,
  kind,
  label,
  days: ALL,
});

export const TEMPLATE_2026: GridRow[] = [
  row(390, 435, "lesson", "פתיחת יום"), // 06:30–07:15
  row(420, 480, "fixed", "ארוחת בוקר / חבורות"), // 07:00–08:00 (overlaps the opening on the poster itself)
  row(480, 510, "fixed", "דרך ארץ — חבורות לימוד בהובלת החניכים"), // 08:00–08:30
  row(510, 600, "lesson", ""), // 08:30–10:00
  row(600, 690, "lesson", ""), // 10:00–11:30
  row(690, 780, "lesson", ""), // 11:30–13:00
  row(780, 795, "memorial", "זמן זיכרון א"), // 13:00–13:15
  row(795, 855, "fixed", "ארוחת צהריים / חבורות"), // 13:15–14:15
  row(855, 870, "memorial", "זמן זיכרון ב"), // 14:15–14:30
  row(870, 960, "lesson", ""), // 14:30–16:00
  row(960, 1050, "lesson", ""), // 16:00–17:30
  row(1050, 1140, "lesson", ""), // 17:30–19:00
  row(1140, 1200, "fixed", "ארוחת ערב / חבורות"), // 19:00–20:00
  row(1200, 1290, "lesson", ""), // 20:00–21:30
  row(1290, 1350, "kk", "מכריכה לכריכה"), // 21:30–22:30
  row(1350, 1440, "lesson", ""), // 22:30–00:00
  row(1440, 1470, "fixed", "ארוחת חצות וניגונים / חבורות"), // 00:00–00:30
  row(1470, 1560, "lesson", ""), // 00:30–02:00
  row(1560, 1650, "lesson", ""), // 02:00–03:30
  row(1650, 1740, "lesson", ""), // 03:30–05:00
  row(1740, 1830, "kk", "מכריכה לכריכה"), // 05:00–06:30
];
