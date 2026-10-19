import { Card } from "./Shell";

export function SignIn({ onSignIn, busy }: { onSignIn: () => void; busy: boolean }) {
  return (
    <div className="mx-auto max-w-md mt-8">
      <Card>
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
