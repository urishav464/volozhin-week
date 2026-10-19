import type { Me } from "../data/types";
import { Card } from "./Shell";

// Phase 0 placeholder. Phase 1 replaces this with the week's grid.
export function Home({ me }: { me: Me }) {
  return (
    <div className="space-y-4">
      <h2 className="font-display font-semibold text-2xl">שלום{me.display_name ? `, ${me.display_name}` : ""}</h2>
      <Card>
        <p className="font-semibold mb-1">המערכת בהקמה</p>
        <p className="text-ink-soft">
          הכניסה עובדת. השלב הבא הוא רשת השבוע: שיבוץ מרצים בגרירה, פיצול ואיחוד משבצות, ואיזון מגדרי ונושאי לכל
          יום.
        </p>
      </Card>
    </div>
  );
}
