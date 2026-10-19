# הקמה: מסלול לחיצות (כ-45 דקות, פעם אחת)

המסמך הזה מיועד למי שמנהל/ת את המערכת (המדריך/ה). אין צורך להתקין שום דבר על המחשב: כל ההקמה נעשית בלוחות הבקרה של GitHub, Supabase, Google ו-Cloudflare.

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
6. מוסיפים את עצמכם כמדריך/ה. גם זה ב-**SQL Editor**:
   1. פותחים לשונית שאילתה חדשה: **New query**, או הכפתור **+** ליד הלשונית הקיימת. אפשר גם למחוק את הטקסט מהלשונית שבה הורצה הסכמה ולהשתמש בה.
   2. מדביקים את השורה הזו:
      ```sql
      select app.add_admin('כתובת-ה-Gmail-שלך');
      ```
   3. מחליפים את `כתובת-ה-Gmail-שלך` בכתובת ה-Gmail שאיתה תיכנסו לאתר. הגרשיים הבודדים `' '` נשארים משני צדי הכתובת. בלעדיהם מופיעה השגיאה `column "…" does not exist`. את הגרש מקלידים במקלדת **אנגלית**: גרש עברי (׳) או גרש מעוגל (’) לא יעבדו.
   4. לוחצים **Run**. התוצאה הצפויה: טבלה עם שורה אחת, עמודה בשם `add_admin`, ותא ריק. זה תקין.
   5. כדי לוודא, מריצים: `select email, role from public.members;`. הכתובת צריכה להופיע עם `admin`.
   - **מומלץ אדמין נוסף** (למשל איש/אשת צוות של שנה ב'), עם אותה פקודה וכתובת אחרת. אדמין רואה את כתובות המייל של הצוות ואת פרטי הקשר של המרצים, כמו שכתוב בדף מדיניות הפרטיות.
   - הכתובות נשמרות רק במסד הנתונים, לא ב-GitHub.

7. **אופציונלי, לשער ההחלטה:** מריצים גם את `supabase/seed_gate.sql`, באותה דרך של `schema.sql` (Raw, העתקה, Run). זה יוצר מחזור «הדגמה» עם 60 מרצים סינתטיים, ומאפשר לנסות את הרשת על השרת האמיתי.
   - אחרי השער מריצים את `supabase/unseed_gate.sql`, והכול נמחק.
   - שני הקבצים לא נוגעים בשום דבר אמיתי.

## 3. Google: לקוח OAuth חדש (רק לוולוז'ין)

**פרויקט ומסך הסכמה**
1. נכנסים ל-[console.cloud.google.com](https://console.cloud.google.com). בבורר הפרויקטים לוחצים **New project**, נותנים את השם `volozhin-week`, לוחצים Create ובוחרים בפרויקט.
2. **APIs & Services → OAuth consent screen**, שנקרא לפעמים Google Auth Platform. לוחצים **Get started**. נפתח אשף בן ארבעה חלקים, ובסוף כל חלק לוחצים **Next**:
   1. **App Information:** ב-**App name** כותבים שבוע וולוז'ין, וב-**User support email** בוחרים מהרשימה את הכתובת שלך.
   2. **Audience:** בוחרים **External**. בחשבון Gmail רגיל האפשרות Internal אפורה, עם ההודעה «Because you're not a Google Workspace user…». זה תקין.
   3. **Contact Information:** מקלידים את הכתובת שלך ולוחצים Enter.
   4. **Finish:** מסמנים את תיבת ההסכמה ל-**Google API Services: User Data Policy** ולוחצים **Continue**. אם מופיע גם **Create**, לוחצים עליו.
3. **עמוד Audience (בתפריט שבצד).** בסוף האשף נפתח עמוד סקירה, ובתפריט שבצד יש עמוד בשם **Audience**. הוא לא החלק Audience שבאשף. **בעמוד הזה לא משנים כלום.** אפשר גם לא להיכנס אליו, ולהמשיך ישר ל«לקוח OAuth».
   - **Publishing status** נשאר **Testing**. אין כאן מה לבחור.
   - הכפתור **Publish app** עשוי להיות אפור. במעבר עכבר הוא עשוי להציג הודעה שדורשת כתובת של דף בית ושל מדיניות פרטיות. זה צפוי, כי עוד אין לנו אתר. לא לוחצים עליו עכשיו (ראו שלב 5.3).
   - **User type** נשאר **External**. אין צורך לשנות אותו.
   - **לא צריך להוסיף Test users.** האתר מבקש מ-Google רק שם, כתובת מייל ותמונת פרופיל. לאפליקציה כזו Google מאפשר לכל חשבון Google להיכנס גם במצב Testing: בלי רשימת משתמשי בדיקה, בלי מגבלת 100 ובלי תפוגה אחרי 7 ימים. מי רואה מה באתר נקבע רק לפי רשימת הצוות שבמסד הנתונים (שלב 2.6).

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
   - **Project name:** `volozhin-week`. זה יהיה גם שם הכתובת, `volozhin-week.pages.dev`. אם השם תפוס, Cloudflare מוסיף לו סיומת (למשל `volozhin-week-abc.pages.dev`). במקרה כזה משתמשים בכתובת שקיבלתם בכל מקום במסמך שכתוב `volozhin-week.pages.dev`: בשלב 3.4, בשלב 5 ובשלב 7.
   - **Production branch:** `main`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`

**משתני סביבה**

4. **באשף היצירה לא מוסיפים משתני סביבה.** באשף אין בחירה בין Production ל-Preview, ומשתנה שמוגדר בו עלול לחול גם על התצוגות המקדימות.
   - גרסת Node נקבעת מהקובץ `.node-version` שבריפו.
   - את שני משתני ה-Supabase מוסיפים בשלב 4.6 שבהמשך.

**פריסה ראשונה**

5. לוחצים **Save and Deploy**. כל עוד ה-PR הראשון לא מוזג ל-`main`, הבנייה הראשונה **תיכשל**, עם השגיאה `Could not read package.json`. זה תקין: ב-`main` יש עדיין רק README.
6. **אחרי הפריסה הראשונה** נכנסים ל-**Settings → Variables and Secrets**, בוחרים **Production**, ומוסיפים:
   - `VITE_SUPABASE_URL` = ה-Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = ה-Publishable key

   בודקים שברשימה של **Preview** לא מופיע אף אחד מהשניים.
   - **אין צורך ב-Retry deployment לפני המיזוג.** הוא ייכשל שוב מאותה סיבה. מיזוג ה-PR ל-`main` מריץ בנייה חדשה מעצמו, והיא כבר תכלול את המשתנים.
   - **בלי המשתנים**, תצוגות מקדימות של ענפים רצות **במצב הדגמה**, עם נתונים לדוגמה בלבד, ולכן בטוח לשתף קישור של תצוגה מקדימה.

## 5. Supabase: כתובות חזרה

אם Cloudflare נתן לפרויקט כתובת עם סיומת (ראו שלב 4.3), כותבים אותה בכל השלב הזה ובשלב 7 במקום `volozhin-week.pages.dev`. את הכתובת רואים בעמוד הפרויקט ב-Cloudflare.

1. ב-**Authentication → URL Configuration**:
   - **Site URL:** `https://volozhin-week.pages.dev`
   - **Redirect URLs:** מוסיפים `https://volozhin-week.pages.dev/**`
2. חוזרים ללקוח של Google משלב 3.4 (**Clients** → `volozhin-week web`). אם `https://volozhin-week.pages.dev` עוד לא מופיע ב-**Authorized JavaScript origins**, מוסיפים אותו ולוחצים Save.
3. **פרסום האפליקציה ב-Google: רשות, אפשר לדלג.** גם במצב Testing הכניסה עובדת לכל חבר/ת צוות (ראו שלב 3.3). אם רוצים לפרסם בכל זאת, עושים זאת רק **אחרי שה-PR הראשון מוזג ל-`main`** (ראו תחילת שלב 7) ו-Cloudflare סיים לפרוס אותו. רק אז האתר ודף מדיניות הפרטיות קיימים. לפני שממשיכים, פותחים בדפדפן את `https://volozhin-week.pages.dev/privacy.html` ומוודאים שמופיע «מדיניות פרטיות».
   1. ב-Google Cloud, **Branding**:
      - **Application home page:** `https://volozhin-week.pages.dev`
      - **Application privacy policy link:** `https://volozhin-week.pages.dev/privacy.html`. הדף הזה הוא חלק מהאתר.
      - **Authorized domains:** לוחצים **Add domain** ומוסיפים שני דומיינים: `volozhin-week.pages.dev`, ואת הדומיין של Supabase מה-Callback URL (שלב 3.4), בצורה `xxxx.supabase.co`, בלי `https://` ובלי הנתיב. `pages.dev` או `supabase.co` לבד יידחו. כדי להוסיף אותם אין צורך לאמת בעלות ב-Search Console.
      - **לא מעלים לוגו.** לוגו ושם האפליקציה מוצגים במסך הכניסה רק אחרי «אימות מותג» של Google, שדורש להוכיח בעלות על כל הדומיינים, כולל זה של Supabase. בלי דומיין מותאם ב-Supabase (תוסף בתשלום) אי אפשר להוכיח אותה, ולכן Google יציג במסך הכניסה את `xxxx.supabase.co`. זה תקין.
      - לוחצים Save.
   2. **Audience → Publish app → Confirm.** הסטטוס הופך ל-**In production**. מי רואה מה באתר עדיין נקבע רק לפי רשימת הצוות שבמסד הנתונים. האתר מבקש מ-Google רק שם, כתובת מייל ותמונת פרופיל, ולכן לא נדרש אימות.
   - **אם Google לא מקבל את הדומיין, או שהכפתור נשאר אפור,** נשארים ב-Testing. בדרך כלל זה מספיק (ראו שלב 3.3). רק אם חבר/ת צוות נעצר/ה אצל Google עם «Access blocked», מוסיפים את הכתובת ב-**Audience → Test users** (עד 100 כתובות).

## 6. GitHub: שמירה על הפרויקט ער

בתוכנית החינמית, Supabase משהה פרויקט אחרי 7 ימים בלי פעילות. פעולה יומית אוטומטית מונעת את זה.

1. בריפו נכנסים ל-**Settings → Secrets and variables → Actions → New repository secret**, ומוסיפים:
   - `SUPABASE_URL` = ה-Project URL
   - `SUPABASE_PUBLISHABLE_KEY` = ה-Publishable key
2. הפעולה היומית רצה רק אחרי שה-PR הראשון ממוזג ל-`main` (ראו תחילת שלב 7): GitHub מריץ תזמונים רק מהענף הראשי. אחרי המיזוג בודקים אותה:
   1. בלשונית **Actions** בוחרים **keep-alive** ולוחצים **Run workflow**.
   2. מוודאים שהריצה מסתיימת בירוק ומדפיסה `"ok"`.
   - **אם היא אדומה,** כנראה ששני הסודות חסרים, או שנשמרו בלשונית **Variables** במקום **Secrets**. GitHub ישלח גם מייל על הכישלון.

## 7. בדיקה

**קודם: מיזוג ה-PR הראשון.** כש-Claude כותב שה-PR מוכן, נכנסים לריפו ב-GitHub, ללשונית **Pull requests**, פותחים את ה-PR מהענף `Volozin` אל `main`, לוחצים **Merge pull request** ואז **Confirm merge**. Cloudflare בונה את האתר מעצמו. אחרי כמה דקות, בעמוד הפרויקט ב-Cloudflare, בלשונית **Deployments**, הבנייה החדשה מסומנת בירוק. מעכשיו אפשר לבדוק גם את שלב 6.2, ואם רוצים, לפרסם את האפליקציה (שלב 5.3).

1. אחרי שה-PR הראשון מוזג ל-`main`, פותחים את `https://volozhin-week.pages.dev`, לוחצים **כניסה עם Google** ונכנסים עם הכתובת שהוספתם בשלב 2.6. בראש המסך צריכה להופיע כתובת ה-Gmail שלכם, ולידה «מדריך/ה». מתחת צריך להופיע «עוד לא נפתח מחזור», או מחזור «הדגמה» אם הרצתם את `seed_gate.sql` בשלב 2.7.
   - במסך של Google תופיע הכתובת `xxxx.supabase.co`, ולא השם «שבוע וולוז'ין». זה תקין: זו הכתובת של Supabase, שדרכה נעשית הכניסה.
   - אם במקום «עוד לא נפתח מחזור» מופיע «מסד הנתונים לא מעודכן», מריצים שוב את כל `supabase/schema.sql` ב-SQL Editor, כמו בשלב 2.5, ומרעננים את הדף. זה צפוי אם הסכמה הורצה לפני העדכון האחרון שלה (ראו גם סוף המסמך).
   - אם Google מציג בדרך הודעה שהאפליקציה בבדיקה, או «Google hasn't verified this app», לוחצים Continue. זה תקין.
2. מנסים מחשבון Google אחר, שלא ברשימת הצוות. צריך להופיע «הכתובת עדיין לא ברשימת הצוות». אם במקום זה Google עצמו עוצר עם «Access blocked» או «Error 403: access_denied», מוסיפים את החשבון ב-**Audience → Test users**, או מפרסמים את האפליקציה (שלב 5.3).
3. ב-Supabase פותחים **Advisors → Security Advisor**. לא אמורות להופיע שגיאות.

---

**אחרי כל עדכון של `supabase/schema.sql`**, ‏Claude יכתוב זאת במפורש. מריצים שוב את כל הקובץ ב-SQL Editor, כמו בשלב 2.5, אבל **מהענף `main`, אחרי שה-PR שכולל את העדכון מוזג ו-Cloudflare סיים לפרוס אותו** (בלשונית **Deployments** הבנייה מסומנת בירוק). עד המיזוג הראשון עוד אין אתר חי, ומריצים מהענף `Volozin`, כמו בשלב 2.5.
- האתר דורש שגרסת מסד הנתונים תהיה בדיוק הגרסה שהוא מכיר. לכן מהפריסה ועד ההרצה האתר מציג «מסד הנתונים לא מעודכן», וההרצה מתקנת את זה. אם האתר מציג את ההודעה הזו אחרי מיזוג, זה הצעד שחסר.
- אם מריצים לפני המיזוג, האתר החי מציג את אותה הודעה, והפעם הרצה נוספת לא עוזרת: ממזגים את ה-PR ומחכים שהפריסה תסתיים.
