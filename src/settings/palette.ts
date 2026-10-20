// The colours a category can take. The first ten are the ones the schema seeds
// (supabase/schema.sql) — they stay. Each is dark enough to read as a stripe on
// white and on paper (≥ 3:1, checked in palette.test.ts), and none is the pale
// blue or pink the grid keeps for its gender lens.
export const PALETTE: readonly { color: string; name: string }[] = [
  { color: "#8a5a2b", name: "חום" },
  { color: "#5b4a8b", name: "סגול" },
  { color: "#2f6f73", name: "ירוק-כחול" },
  { color: "#7a3e6d", name: "שזיף" },
  { color: "#3d5a99", name: "כחול" },
  { color: "#a0522d", name: "חלודה" },
  { color: "#5e7a2e", name: "זית" },
  { color: "#9a6b00", name: "חרדל" },
  { color: "#2e7d5b", name: "ירוק" },
  { color: "#6b6b2e", name: "חאקי" },
  { color: "#a23b3b", name: "אדום" },
  { color: "#1f6f8b", name: "כחול ים" },
];

export function colorName(color: string): string {
  return PALETTE.find((p) => p.color === color.toLowerCase())?.name ?? "צבע אחר";
}

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
