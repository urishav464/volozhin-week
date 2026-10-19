// Every refusal the database can give, in Hebrew. The SQL raises
// `raise exception using message = '<code>'` (or a named constraint fires);
// the port maps it here. A raw Postgres error must never reach a trainee —
// src/errors.test.ts checks every code the schema raises has an entry below.
export const ERRORS: Record<string, string> = {
  // identity
  not_member: "אין לך הרשאה למחזור הזה. כדאי לפנות למדריך/ה.",
  forbidden: "הפעולה הזו שמורה למדריך/ה.",
  // speakers and approaches
  approach_owned: "המרצה כבר בטיפול של חבר/ת צוות אחר/ת. אפשר להציע לו/לה את המשבצת.",
  not_vetted: "המרצה עוד לא אושר/ה ע״י המדריך/ה — אפשר לסמן כמועמד/ת בלבד.",
  speaker_retired: "המרצה מסומן/ת כלא פעיל/ה.",
  gender_unknown: "חסר מגדר למרצה — צריך להשלים בפרופיל לפני סגירה.",
  // the grid
  room_taken: "החדר כבר תפוס בשעה הזו. אפשר לבחור חדר אחר או לפצל למקבילים.",
  speaker_busy: "המרצה כבר משובץ/ת בשעה הזו.",
  cell_closed: "יש כאן שיעור סגור — צריך לפתוח אותו מחדש קודם.",
  merge_blocked: "אי אפשר לאחד: יש שיעור סגור במשבצת הבאה.",
  bad_shape: "החלוקה לא תקינה — כל חלק צריך להיות לפחות רבע שעה, והחלקים צריכים למלא את המשבצת.",
  outside_grid: "השעה הזו מחוץ לשורות של הרשת.",
  approved_locked: "תשלום או הסעה כבר אושרו — רק המדריך/ה יכול/ה לפתוח מחדש.",
  // concurrency
  stale: "מישהו אחר עדכן את זה הרגע. הנתונים נטענו מחדש — אפשר לנסות שוב.",
  archived: "המחזור בארכיון — אפשר רק לצפות.",
  // settings (הגדרות)
  name_required: "צריך למלא שם.",
  label_required: "צריך לתת למחזור שם, למשל תשפ״ז.",
  bad_email: "כתובת המייל לא תקינה. צריך כתובת Google מלאה, עם @ ונקודה אחריה.",
  bad_value: "אחד הערכים לא תקין.",
  not_sunday: "השבוע נפתח ביום ראשון — צריך לבחור תאריך של יום ראשון.",
  bad_time: "שעת הפתיחה צריכה להיות בין 06:30 ל-23:55.",
  member_exists: "הכתובת כבר ברשימה.",
  member_has_history: "כבר יש פעולות במערכת בשם הזה, ולכן אי אפשר למחוק. אפשר להשבית במקום: הכניסה נחסמת וההיסטוריה נשמרת.",
  self_lockout: "אי אפשר להוריד את ההרשאה של עצמך או למחוק אותה.",
  edition_exists: "כבר יש מחזור בשם הזה.",
  roster_exists: "השם כבר ברשימת החניכים.",
  room_exists: "כבר יש חדר בשם הזה.",
  room_default: "זה חדר ברירת המחדל. קודם בוחרים חדר אחר כברירת מחדל, ואז מוחקים.",
  room_in_use: "יש שיעורים בחדר הזה, ולכן אי אפשר למחוק אותו. אפשר לשנות לו שם.",
  category_exists: "כבר יש קטגוריה בשם הזה.",
  category_in_use: "יש שיעורים בקטגוריה הזו, ולכן אי אפשר למחוק אותה. אפשר להשבית אותה במקום.",
  duplicate: "זה כבר קיים ברשימה.",
  in_use: "זה בשימוש במקום אחר, ולכן אי אפשר למחוק.",
};

export function errorMessage(code: string | null | undefined): string {
  return (code && ERRORS[code]) || "הפעולה לא הצליחה. אם זה חוזר, כדאי לספר למדריך/ה.";
}
