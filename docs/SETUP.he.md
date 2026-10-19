# הקמה: מסלול לחיצות (כ-45 דקות, פעם אחת)

המסמך הזה מיועד למי שמנהל את המערכת (המדריך/ה). אין צורך להתקין שום דבר על המחשב: כל ההקמה נעשית בלוחות הבקרה של GitHub, Supabase, Google ו-Cloudflare.

השמות של הכפתורים בלוחות הבקרה משתנים מדי פעם. אם משהו לא תואם למה שכתוב כאן, אפשר לצלם את המסך ולשלוח ל-Claude.

> **שלושה דברים שאסור להעתיק לשום מקום**, לא ל-GitHub, לא ל-Cloudflare ולא לצ'אט:
> - את ה-**Secret key** של Supabase (מתחיל ב-`sb_secret_`);
> - את **סיסמת מסד הנתונים**;
> - את ה-**Client secret** של Google, מלבד המקום היחיד שבו הוא נדרש (שלב 3).
>
> המפתח שכן מעתיקים הוא ה-**Publishable key** (מתחיל ב-`sb_publishable_`). הוא נועד להיות גלוי, והאבטחה נשענת על ההרשאות שבמסד הנתונים.

---

## 1. GitHub

1. פותחים ריפו **פרטי** בשם `volozhin-week`, עם README.
2. נותנים ל-Claude גישה אליו, דרך [claude.ai/connect-github](https://claude.ai/connect-github). אם האפליקציה מוגבלת לריפו מסוימים, מוסיפים את `volozhin-week`.

## 2. Supabase: פרויקט חדש

1. נכנסים ל-[supabase.com/dashboard](https://supabase.com/dashboard), ולוחצים **New project**.
2. ממלאים:
   - **Name:** `volozhin-week`
   - **Database password:** לוחצים Generate ושומרים במנהל סיסמאות. לא נצטרך אותה בהמשך.
   - **Region:** `Central EU (Frankfurt)`, הקרוב ביותר לישראל.
   - **Plan:** Free.
   - **Security:**
     - **Enable Data API:** מסומן. דרכו האתר מדבר עם מסד הנתונים.
     - **Automatically expose new tables:** **מורידים את הסימון.** ההרשאות נקבעות ב-`schema.sql` אחת-אחת, ולא אוטומטית. הסכמה נבדקת בשני המצבים, אז גם סימון לא ישבור, אבל בלי סימון בטוח יותר.
     - **Enable automatic RLS:** משאירים בלי סימון. `schema.sql` מפעיל RLS על כל טבלה בעצמו, ובדיקה מוודאת את זה.
   - **Postgres Type** (תחת Advanced): `Postgres`, ברירת המחדל. לא OrioleDB.
3. מחכים שהפרויקט יעלה, בערך 2 דקות.
4. מעתיקים לצד שני ערכים. הם נמצאים ב-**Project Settings → API Keys** ובכפתור **Connect** שבראש הפרויקט:
   - **Project URL**, בצורה `https://xxxx.supabase.co`;
   - **Publishable key**, בצורה `sb_publishable_…`.
5. מריצים את הסכמה:
   1. **SQL Editor → New query.**
   2. ב-GitHub פותחים את הקובץ `supabase/schema.sql` **בענף `Volozin`**. עד שה-PR הראשון ימוזג, ב-`main` יש רק README. אפשר לבחור את הענף בבורר הענפים שמעל רשימת הקבצים, או להיכנס ישר לכתובת: `https://github.com/urishav464/volozhin-week/blob/Volozin/supabase/schema.sql`. לוחצים **Raw** ומעתיקים את **כל** הטקסט.
   3. מדביקים ולוחצים **Run**. התוצאה הצפויה: `Success. No rows returned`.
   4. לוחצים **Run** פעם נוספת. ההרצה חוזרת על עצמה בלי נזק, וגם הפעם צריך להתקבל Success.
6. מוסיפים את עצמכם כמדריך/ה. בשאילתה חדשה כותבים, במקום ההערה, את כתובת ה-Gmail שאיתה תיכנסו:
   ```sql
   select app.add_admin('כתובת-ה-Gmail-שלך');
   ```
   - **מומלץ אדמין נוסף** (למשל איש צוות שנה ב'), עם אותה פקודה וכתובת אחרת.
   - הכתובות נשמרות רק במסד הנתונים, לא ב-GitHub.

7. **אופציונלי, לשער ההחלטה:** מריצים גם את `supabase/seed_gate.sql`, באותה דרך של `schema.sql` (Raw, העתקה, Run). זה יוצר מחזור «הדגמה» עם 60 מרצים סינתטיים, ומאפשר לנסות את הרשת על השרת האמיתי.
   - אחרי השער מריצים את `supabase/unseed_gate.sql`, והכול נמחק.
   - שני הקבצים לא נוגעים בשום דבר אמיתי.

## 3. Google: לקוח OAuth חדש (רק לוולוז'ין)

**פרויקט ומסך הסכמה**
1. נכנסים ל-[console.cloud.google.com](https://console.cloud.google.com). בבורר הפרויקטים לוחצים **New project**, נותנים את השם `volozhin-week`, לוחצים Create ובוחרים בפרויקט.
2. **APIs & Services → OAuth consent screen**, שנקרא לפעמים Google Auth Platform. לוחצים **Get started**:
   - **App name:** שבוע וולוז'ין
   - **User support email:** הכתובת שלך
   - **Audience:** External
   - **Contact email:** הכתובת שלך
   - לוחצים Create.
3. **Audience → Publish app**, כך שהסטטוס הוא **In production**. בלי זה רק "משתמשי בדיקה" יוכלו להיכנס. אנחנו מבקשים רק שם וכתובת, ולכן לא נדרש אימות של Google.

**לקוח OAuth**

4. **Clients → Create client**, ובוחרים **Web application** (שם: `volozhin-week web`).
   - **Authorized JavaScript origins:** את הכתובת של האתר מקבלים רק בשלב 4. אפשר לחזור לכאן אחר כך ולהוסיף `https://volozhin-week.pages.dev`.
   - **Authorized redirect URIs:** את הכתובת המדויקת מעתיקים מ-Supabase. היא מופיעה ב-**Authentication → Sign In / Providers → Google**, תחת "Callback URL", בצורה `https://xxxx.supabase.co/auth/v1/callback`.
5. לוחצים Create ומעתיקים את **Client ID** ואת **Client secret**.

**חיבור ל-Supabase**

6. ב-Supabase, ב-**Authentication → Sign In / Providers**:
   - **Google:** Enable, מדביקים Client ID ו-Client secret, ושומרים.
   - **Email:** מכבים. הכניסה היא רק דרך Google.
   - **Anonymous sign-ins:** משאירים כבוי.

## 4. Cloudflare Pages: האתר

**יצירת הפרויקט**
1. נכנסים ל-[dash.cloudflare.com](https://dash.cloudflare.com). עוברים ל-**Workers & Pages → Create**, ובוחרים בלשונית **Pages**: **Import an existing Git repository**.
   - אם מוצעים רק Workers, מחפשים את הקישור "Looking to deploy Pages?".
2. **Connect GitHub.** מאשרים גישה **רק** לריפו `volozhin-week`, בוחרים אותו, ולוחצים Begin setup.
3. הגדרות:
   - **Project name:** `volozhin-week`. זה יהיה גם שם הכתובת, `volozhin-week.pages.dev`.
   - **Production branch:** `main`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`

**משתני סביבה**

4. **באשף היצירה לא מוסיפים משתני סביבה.** באשף אין בחירה בין Production ל-Preview, ומשתנה שמוגדר בו עלול לחול גם על התצוגות המקדימות.
   - גרסת Node נקבעת מהקובץ `.node-version` שבריפו.
   - את שני משתני ה-Supabase מוסיפים בצעד 6 שבהמשך.

**פריסה ראשונה**

5. לוחצים **Save and Deploy**. כל עוד לא מוזג ה-PR הראשון ל-`main`, ייתכן שהבנייה הראשונה של `main` תיכשל. זה תקין.
6. **אחרי הפריסה הראשונה** נכנסים ל-**Settings → Variables and Secrets**, בוחרים **Production**, ומוסיפים:
   - `VITE_SUPABASE_URL` = ה-Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = ה-Publishable key

   בודקים שברשימה של **Preview** לא מופיע אף אחד מהשניים, ואז מריצים שוב את הפריסה (Retry deployment).
   - **בלי המשתנים**, תצוגות מקדימות של ענפים רצות **במצב הדגמה**, עם נתונים לדוגמה בלבד, ולכן בטוח לשתף קישור של תצוגה מקדימה.

## 5. Supabase: כתובות חזרה

1. ב-**Authentication → URL Configuration**:
   - **Site URL:** `https://volozhin-week.pages.dev`
   - **Redirect URLs:** מוסיפים `https://volozhin-week.pages.dev/**`
2. חוזרים ללקוח של Google משלב 3, ומוודאים ש-`https://volozhin-week.pages.dev` מופיע ב-Authorized JavaScript origins.

## 6. GitHub: שמירה על הפרויקט ער

בתוכנית החינמית, Supabase משהה פרויקט אחרי 7 ימים בלי פעילות. פעולה יומית אוטומטית מונעת את זה.

1. בריפו נכנסים ל-**Settings → Secrets and variables → Actions → New repository secret**, ומוסיפים:
   - `SUPABASE_URL` = ה-Project URL
   - `SUPABASE_PUBLISHABLE_KEY` = ה-Publishable key
2. הפעולה היומית רצה רק אחרי שה-PR הראשון ממוזג ל-`main`: GitHub מריץ תזמונים רק מהענף הראשי. אחרי המיזוג בודקים אותה:
   1. בלשונית **Actions** בוחרים **keep-alive** ולוחצים **Run workflow**.
   2. מוודאים שהריצה מסתיימת בירוק ומדפיסה `"ok"`.
   - **אם היא אדומה,** כנראה ששני הסודות חסרים, או שנשמרו בלשונית **Variables** במקום **Secrets**. GitHub ישלח גם מייל על הכישלון.

## 7. בדיקה

1. אחרי שה-PR הראשון מוזג ל-`main`, פותחים את `https://volozhin-week.pages.dev`, לוחצים **כניסה עם Google** ונכנסים עם הכתובת שהוספתם בשלב 2. צריך להופיע "שלום".
2. מנסים מחשבון Google אחר, שלא ברשימה. צריך להופיע «הכתובת עדיין לא ברשימת הצוות».
3. ב-Supabase פותחים **Advisors → Security Advisor**. לא אמורות להופיע שגיאות.

---

**אחרי כל עדכון של `supabase/schema.sql`**, ‏Claude יכתוב זאת במפורש. אז מריצים שוב את כל הקובץ ב-SQL Editor, כמו בשלב 2.5. אם האתר מציג «מסד הנתונים לא מעודכן», זה הצעד שחסר.
