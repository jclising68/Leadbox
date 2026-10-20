# Leadsbox — Setup Guide

Stack: Next.js 16 + TypeScript + Supabase (Postgres + Auth) + Prisma + Bun, deployed on Vercel.
Follow the steps in order. Never commit real keys — `.env*` is git-ignored (except `.env.example`).

## 0. Accounts you need
- GitHub (access to this repo)
- Supabase (free tier is fine to start)
- Vercel
- Optional: Resend (emails), OpenAI / Anthropic (AI features), Instantly and/or HeyReach accounts (the data sources)

## 1. Install and run locally
```bash
git clone https://github.com/jclising68/Leadbox.git
cd Leadbox
bun install            # also runs `prisma generate`
cp .env.example .env   # then fill it in (step 3)
```
Requires [Bun](https://bun.sh). Use `bun`, not npm.

## 2. Create your Supabase project
1. New project at supabase.com. Save the database password.
2. Project Settings → Database → Connection string:
   - `DATABASE_URL` = the **pooled** (port 6543, `?pgbouncer=true`) URL — used by the app.
   - `DIRECT_URL` = the **direct** (port 5432) URL — used by Prisma for schema changes.
3. Project Settings → API: copy the Project URL, `anon` key, and `service_role` key.
4. Authentication → URL Configuration: set Site URL to your app URL, and add `<your-app-url>/reset-password` to Redirect URLs (needed for password reset emails).

## 3. Fill in `.env` (and the same values in Vercel)
| Variable | Required | Where it comes from |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | yes | Supabase (step 2) |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `AUTH_URL` | yes | `http://localhost:3000` locally, your Vercel URL in production |
| `ENCRYPTION_KEY` | yes | `openssl rand -hex 32` (64 hex chars). **Never change it after saving API keys in the app — stored keys become unreadable.** |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase → Settings → API |
| `NEXT_PUBLIC_APP_URL` | yes | Same as `AUTH_URL` |
| `CRON_SECRET` | yes | Any random string (`openssl rand -hex 24`). **Must be identical in Vercel and in the GitHub secret (step 6).** |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | resend.com. Without it emails are only logged. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | optional | Can instead be set per workspace inside the app |

## 4. Create the database tables
There are no migration files; the schema is applied directly:
```bash
bun run db:push
bun run db:seed     # optional: demo user + workspace
```
The seed creates `admin@leadbox.io` / `leadbox123`. **Change that password immediately or skip seeding in production.** You can also just use /register.

## 5. Run it
```bash
bun run dev         # http://localhost:3000
```
Before handing off, check: `bunx tsc --noEmit`, `bun run lint`, `bun run build`.

## 6. Deploy to Vercel
1. Vercel → Add New Project → import the GitHub repo. Framework: Next.js (auto).
2. Add every env var from step 3 (Production + Preview).
3. `vercel.json` pins functions to region `sin1` (Singapore). Change it to the region closest to your Supabase database.
4. Deploy and confirm the build passes.

## 7. Fix the cron job (scheduled sync) — required edits
Syncing runs from GitHub Actions (`.github/workflows/cron.yml`), not Vercel Cron.
1. **Edit `cron.yml`**: it hardcodes `https://leadbox-phi.vercel.app`. Replace it with your own Vercel domain in both `curl` lines (`/api/cron/sync` and `/api/cron/follow-up-notify`).
2. GitHub repo → Settings → Secrets and variables → Actions → New secret: `CRON_SECRET` = the same value as in Vercel.
3. Actions tab → Cron → Run workflow to test. It must go green. (A failing run with curl exit code 22 means the secret doesn't match or the URL is wrong.)

## 8. Connect the data sources (inside the app)
1. Register / log in, create a workspace.
2. Settings → Integrations: paste your **own** Instantly and/or HeyReach API keys (stored encrypted with `ENCRYPTION_KEY`).
3. Webhooks: the app shows a webhook URL + secret per workspace. Add it in Instantly / HeyReach. Endpoints are `/api/webhooks/instantly`, `/api/webhooks/heyreach`, `/api/webhooks/lemlist`, called with `?workspace_id=…&secret=…`.
4. Optional: AI labeling, AI reply, enrichment keys under Settings.

## Troubleshooting
- **Build or dev server weird:** delete `.next` and restart (`bun run dev`).
- **Can't log in after changing env:** check `AUTH_SECRET` / `AUTH_URL` match the environment.
- **Password-reset email missing:** check Supabase redirect URLs (step 2) and Auth email settings.
- **Cron red in GitHub:** step 7.
