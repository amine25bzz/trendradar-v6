# TrendRadar — ترند يوتيوب

لوحة تفاعلية لمتابعة أكثر مقاطع يوتيوب رواجاً (Trending) في عدة دول، مقسمة إلى: عادي، Shorts، كيدز، مع بحث مباشر في الفيديوهات والقنوات.

## 🚀 النشر على Vercel

1. ارفع المشروع إلى GitHub.
2. في [Vercel](https://vercel.com): **Add New → Project** ثم استورد المستودع.
3. **Framework Preset:** اتركه `Other`، ولا تغيّر Build Command ولا Output Directory.
4. في **Environment Variables** أضف:
   - `YOUTUBE_API_KEY` = مفتاح YouTube Data API v3
5. اضغط **Deploy**، ثم افتح الرابط `https://اسم-المشروع.vercel.app`.

> إذا أضفت المفتاح بعد النشر، اعمل **Redeploy** حتى يُقرأ.

اختبار سريع بعد النشر: افتح `/api/trends` — يجب أن ترى JSON.

## 🔌 واجهة الـ API

| المسار | المعاملات |
|---|---|
| `/api/trends` | `country=XX` (اختياري، أو `ALL`) · `refresh=1` |
| `/api/search` | `q` (إلزامي) · `target=video\|channel` · `country=XX` · `hours=N` |

> ⚠️ المفتاح يُقرأ من `YOUTUBE_API_KEY` فقط. لا تكتبه داخل الكود ولا ترفعه إلى GitHub.

## 💻 التشغيل المحلي

```bash
cp .env.example .env     # ثم ضع مفتاحك داخل .env
npm install
npm start
```
ثم افتح `http://localhost:3000`.

## 🖥️ تطبيق سطح المكتب (Electron)

```bash
npm install
npm run app      # تشغيل
npm run dist     # بناء نسخة Windows محمولة
```
ضع المفتاح في `key.txt` بجانب ملف exe.

## 📂 بنية المشروع

- `public/index.html` — الواجهة v6 بثلاث لغات (EN/AR/FR) وطريقتي بحث (تُخدم كملف ثابت على Vercel).
- `api/trends.js`, `api/search.js` — دوال Vercel Serverless.
- `lib/youtube.js` — الجلب من YouTube Data API.
- `lib/handlers.js` — منطق الـ API المشترك + التخزين المؤقت.
- `lib/safe.js` — يُظهر أي عطل في الدوال كرسالة JSON واضحة.
- `api/health.js` — فحص سريع: افتح `/api/health` بعد النشر.
- `server.js` — خادم محلي (و Electron يستخدمه).
- `main.cjs` — نافذة Electron.
- `vercel.json` — إعدادات Vercel.
