# Manual Deploy to Vercel

This guide explains how to deploy this Next.js project manually to Vercel.

## 1) Local sanity check

1. Create a `.env.local` in project root with your Supabase keys:

```
SUPABASE_URL=https://<your>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
# Optional for server-side only code (never exposed to browser):
# SUPABASE_SERVICE_ROLE=<service-role-key>
```

2. Run locally:

```
npm install
npm run build
npm start
```

3. Test endpoints:
- Export Excel: http://localhost:3000/api/schedule/export/2026/1?ts=123
- Health: http://localhost:3000/api/health

## 2) Push to GitHub

```
git init
git add .
git commit -m "deploy"
git branch -M main
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```

## 3) Import into Vercel

- Go to https://vercel.com → Import Project → choose your repo.
- Defaults are auto-detected for Next.js: build `next build` and output `.next`.

## 4) Add environment variables (Production)

In Vercel Project → Settings → Environment Variables, add:
- SUPABASE_URL
- SUPABASE_ANON_KEY
- (Optional) SUPABASE_SERVICE_ROLE (server only)

Redeploy after saving.

## 5) Test after deploy

- Health: https://<your-app>.vercel.app/api/health
- Export: https://<your-app>.vercel.app/api/schedule/export/2026/1?ts=123
- Debug JSON: add `?debug=1` to see a JSON payload instead of file.

## Notes

- `vercel.json` pins the Node runtime for the export route.
- Response headers disable caching, but you can always add `?ts=<random>` to bust browser cache.
- Ensure Supabase RLS policies allow required reads/writes for server endpoints.
