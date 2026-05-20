# Deployment Runbook

INTEGRITY runs across four hosted services. None of them require a credit
card for the demo path documented here.

| Layer | Host | Why |
| --- | --- | --- |
| Frontend (Next.js 15) | **Vercel** | Native Next.js support, global CDN, free HTTPS |
| Backend (Express + Socket.IO) | **Render** | Free tier supports websockets; persists Postgres connections |
| ML service (FastAPI + PyTorch) | **Hugging Face Spaces** | 16 GB RAM free, designed for ML workloads |
| Database | **Supabase Postgres** | Already set up — see [SUPABASE_MIGRATION.md](./SUPABASE_MIGRATION.md) |
| Cache / sessions | **Upstash Redis** | Already set up |
| File storage (logos) | **Supabase Storage** | Same project as the DB |

The code has already been adapted for these hosts:

- Backend `cors()` reads `CORS_ORIGIN` from env (defaults to `*`).
- Socket.IO uses the same `CORS_ORIGIN`.
- Institution logo uploads go to Supabase Storage instead of the local
  filesystem (which is ephemeral on Render).
- The frontend reads `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL`
  with sensible localhost fallbacks.
- The ML service ships pre-trained `.pt` checkpoints so HF Spaces cold
  starts don't have to retrain.

---

## 1. Prepare Supabase Storage (one-time)

1. Supabase Dashboard -> **Storage** -> **New bucket**.
2. Name: `institution-logos`. Mark it **Public**.
3. Supabase Dashboard -> Project Settings -> **API**. Copy:
   - `Project URL` -> goes into `SUPABASE_URL`
   - `service_role` secret key -> goes into `SUPABASE_SERVICE_KEY`
     (NOT the anon key — that one can't write to private storage)

## 2. Push to GitHub

```bash
cd Intergrity
git push origin main
```

All three hosting platforms below pull from this GitHub repo.

## 3. Frontend on Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. **Add New Project** -> import `sanibusiness1236-jpg/Intergrity`.
3. **Root Directory** -> `frontend`.
4. Framework Preset auto-detects Next.js.
5. **Environment Variables** (add these now; we'll fill them in
   after the backend deploys):

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://YOUR-BACKEND.onrender.com/api` |
| `NEXT_PUBLIC_SOCKET_URL` | `https://YOUR-BACKEND.onrender.com` |

6. Click **Deploy**. Note the assigned domain
   (e.g. `https://integrity.vercel.app`). You'll feed it back into
   the backend's `CORS_ORIGIN` shortly.

## 4. Backend on Render

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New** -> **Web Service** -> connect `sanibusiness1236-jpg/Intergrity`.
3. Settings:
   - **Name**: `integrity-backend`
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install && npx prisma generate && npx prisma migrate deploy`
   - **Start Command**: `node src/server.js`
   - **Instance Type**: **Free**
4. **Environment** -> add every variable from `backend/.env.example`
   with the real Supabase / Upstash / JWT / Vercel values:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Supabase pooler URI (port 6543) |
| `DATABASE_URL_DIRECT` | Supabase direct URI (port 5432) |
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SERVICE_KEY` | from step 1 |
| `SUPABASE_LOGO_BUCKET` | `institution-logos` |
| `REDIS_URL` | Upstash `rediss://` URI |
| `JWT_SECRET` | a fresh 64-char random string |
| `JWT_REFRESH_SECRET` | a different 64-char random string |
| `JWT_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | your Vercel URL from step 3 (no trailing slash) |
| `ML_SERVICE_URL` | filled in after step 5 |
| `NODE_ENV` | `production` |
| `PORT` | Render injects this automatically |

5. **Create Web Service**. First deploy will take a few minutes —
   it has to install Prisma, run migrations against Supabase, etc.

6. Copy the assigned URL (e.g. `https://integrity-backend.onrender.com`)
   and go back to Vercel's project settings, paste it into
   `NEXT_PUBLIC_API_URL` (append `/api`) and `NEXT_PUBLIC_SOCKET_URL`.
   Redeploy the frontend.

> Free-tier note: Render's free web service sleeps after 15 minutes of
> idle traffic. The first request after sleep takes ~30 s to wake. For
> a real launch upgrade to **Starter** ($7/mo) to keep it always on.

## 5. ML service on Hugging Face Spaces

1. Sign in at [huggingface.co](https://huggingface.co).
2. **New Space**:
   - **Name**: `integrity-ml`
   - **SDK**: **Docker**
   - **Visibility**: Public
   - **Hardware**: CPU basic (free)
3. HF Spaces are their own git repos. Push the contents of `ml-service/`
   (NOT the parent folder) into the Space repo:

```bash
# from anywhere outside the main repo
git clone https://huggingface.co/spaces/YOUR-HF-USERNAME/integrity-ml
cd integrity-ml

# Copy the ml-service folder contents in
cp -r ../Intergrity/ml-service/. .

git add .
git commit -m "Initial deployment"
git push
```

On Windows PowerShell, swap `cp -r` for:

```powershell
Copy-Item -Recurse -Force "..\Intergrity\ml-service\*" .
```

4. The Space will build (~10 min the first time for `pip install`).
   Watch the build logs from the Space page.

5. Once it's running, the URL is
   `https://YOUR-HF-USERNAME-integrity-ml.hf.space`.
   Add this to Render's `ML_SERVICE_URL` env var and trigger a redeploy
   of the backend.

## 6. Smoke test

| Endpoint | Expect |
| --- | --- |
| `https://YOUR-FRONTEND.vercel.app` | Renders the homepage |
| `https://YOUR-BACKEND.onrender.com/health` | `{"status":"healthy"}` |
| `https://YOUR-HF-USERNAME-integrity-ml.hf.space/health` | `{"status":"healthy"}` |
| Register a user from the live frontend | Succeeds, row appears in Supabase `users` table |
| Upload an institution logo | Succeeds, file lands in Supabase Storage `institution-logos` bucket |
| Open a websocket session | Connects without a CORS error |

## 7. Optional next steps

- **Rotate the Supabase database password.** The current one (`sarfoblay123`)
  is weak and personally identifiable. Supabase Dashboard -> Settings ->
  Database -> Reset password, then update both `DATABASE_URL` variables.
- **Custom domain.** Both Vercel and Render let you attach a domain
  with auto-issued HTTPS certs.
- **Keep Render awake.** Set up a cron-job.org ping to your
  `/health` endpoint every 10 minutes (only do this if you're OK
  burning free-tier hours).
- **Upgrade ML service hardware.** HF Spaces lets you bump to a
  T4 GPU if GNN inference becomes a bottleneck.
