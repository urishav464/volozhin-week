import { Card } from "./Shell";

export function SignIn({ onSignIn, busy, error }: { onSignIn: () => void; busy: boolean; error?: string | null }) {
  return (
    <div className="mx-auto max-w-md mt-8">
      <Card>
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-semibold">הכניסה לא הושלמה</p>
            <p>אפשר לנסות שוב. אם זה חוזר, כדאי לשלוח למדריך/ה את ההודעה הזו:</p>
            <p className="mt-1 text-xs" dir="ltr">
              {error}
            </p>
          </div>
        )}
        <h2 className="font-display font-semibold text-lg mb-2">כניסה לצוות</h2>
        <p className="text-ink-soft mb-5">
          המערכת פתוחה לצוות התוכן, לצוות הלוגיסטי ולמדריך/ה. הכניסה עם חשבון Google שנמסר למדריך/ה.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="w-full rounded-lg bg-ink text-paper font-semibold py-3 hover:bg-ink/90 disabled:opacity-60"
        >
          כניסה עם Google
        </button>
      </Card>
    </div>
  );
}
