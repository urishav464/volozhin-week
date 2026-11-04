import seal from "../assets/brand/ein-prat-blue.png";
import { Card } from "./Shell";

export function SignIn({ onSignIn, busy, error }: { onSignIn: () => void; busy: boolean; error?: string | null }) {
  return (
    <div className="mx-auto mt-6 max-w-md sm:mt-10">
      {/* the seal on the parchment, above the card: the page's one mark (the name is in the header) */}
      <img src={seal} alt="עין פרת" width={96} height={96} className="mx-auto mb-5 size-24" />
      <Card className="sm:p-7">
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-ink">
            <p className="font-bold text-bad">הכניסה לא הושלמה</p>
            <p>אפשר לנסות שוב. אם זה חוזר, כדאי לשלוח למדריך/ה את ההודעה הזו:</p>
            <p className="mt-1 text-xs" dir="ltr">
              {error}
            </p>
          </div>
        )}
        <h2 className="mb-2 font-display text-2xl font-extrabold text-navy">כניסה לצוות</h2>
        <p className="mb-6 leading-relaxed text-ink-soft">
          המערכת פתוחה לצוות התוכן, לצוות הלוגיסטי ולמדריך/ה. הכניסה עם חשבון Google שנמסר למדריך/ה.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="min-h-12 w-full rounded-full bg-navy py-3 font-bold text-white transition-colors duration-150 hover:bg-navy-800 disabled:opacity-60"
        >
          כניסה עם Google
        </button>
      </Card>
      {/* a plain link, so the host serves the static page rather than the app */}
      <p className="mt-2 text-center text-sm">
        <a href="/privacy.html" className="inline-flex min-h-11 items-center text-ink-soft underline underline-offset-4 hover:text-navy">
          מדיניות פרטיות
        </a>
      </p>
    </div>
  );
}
