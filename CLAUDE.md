@AGENTS.md

## Engineering Discipline (STRICT — read first)

These are non-negotiable. The user has been burned by each of these; violating them costs real production time.

- **Never `git push` unless the user explicitly says push/deploy/ship.** Committing is not permission to push. Approval to push earlier in the session is not a standing grant — it's per-request.
- **No bandaid fixes. Find the root cause.** If a fix is patching a symptom, stop and dig until the actual cause is identified. State the root cause in every fix plan. If unsure it's root cause, say so before coding.
- **Align before coding.** For any non-trivial change, outline the approach in 3–4 bullets (library/method, data flow, assumptions, scaling behavior) and wait for explicit approval. Never make unrequested adjacent changes — surface them as questions instead.
- **Solutions must be efficient, scalable, and reliable.** This app handles thousands of contacts across many workspaces. State scaling behavior in every plan — API call volume, complexity, worst-case bounds at 10× load. Prefer persistent cursors, in-memory maps, idempotent upserts.

## Stack & Auth

- This is a **Next.js 15 + TypeScript + Supabase + Prisma + Bun** project, deployed on **Vercel**
- Always use **Supabase Auth** built-in methods for auth flows (password reset, email verification, magic links) — do NOT suggest third-party services like Resend unless explicitly asked
- Check existing project patterns before implementing anything auth-related

## Dev Server

- When asked to stop/restart the dev server, verify the process is actually killed (`lsof -i :3000`) before confirming
- If Turbopack cache is corrupted or build is broken, delete `.next` folder and restart
- Use `bun run dev` (not npm)

## External API Integrations

- When working with external APIs (Instantly, HeyReach, Make.com, n8n, Salesmate, Apollo), use the API keys/credentials the user provides directly — do NOT try pre-configured MCP workspaces or guess endpoints
- Ask for docs or test endpoints incrementally if unsure
- Never hardcode field names, account IDs, or values in API mappings — always use dynamic/configurable mapping

## Deployment

- Before deploying to Vercel, confirm which Vercel account/team to deploy to — never deploy without explicit user confirmation
- After deploy, verify the build succeeds before moving on
- Do NOT push code to git without asking first — always confirm before committing or pushing

## UI Patterns

- Default to **multi-select with checkboxes and OR logic** for category/tag filters unless told otherwise
- Never use AND logic for filters without asking first
- For PDF generation: never use fixed coordinate overlays — always use programmatic rendering with a grid/layout system

## Code Patterns

- Use dynamic/configurable mappings for field transforms and API integrations — never hardcode
- Before writing any code for a non-trivial feature, outline the approach in 3-4 bullet points and wait for approval
- Especially confirm: what library/method to use, the data flow, and any assumptions being made

## Performance

- This app will handle thousands of contacts — consider caching, pagination, and virtual scrolling for lists
- Use Supabase RLS where appropriate for data isolation

## File Organization

New files must go in the right folder. If none of these fit, ask — don't drop it at repo root.

| File type | Goes in |
|---|---|
| Next.js route / page / layout | `src/app/<route-group>/...` |
| API route handler | `src/app/api/<domain>/route.ts` |
| Cron handler | `src/app/api/cron/<job>/route.ts` (wire in `vercel.json`) |
| Shared UI component | `src/components/...` |
| Domain service (sync, enrichment, webhooks) | `src/services/<domain>.ts` |
| External API client / util / helper | `src/lib/...` |
| React hook | `src/hooks/...` |
| Zustand store / client state | `src/stores/...` |
| TypeScript type definitions | `src/types/...` |
| Prisma schema / seed | `prisma/` |
| DB migration | `prisma/migrations/` (generated, don't hand-edit) |
| API probe / response-shape test | `scripts/tests/test-<provider>-<scope>.ts` |
| One-off data fix / admin task | `scripts/ops/<action>.ts` |
| Static asset (served via `/`) | `public/<category>/` (e.g. `public/branding/`) |
| Favicon / PWA icon | `public/` root (browser convention requires it) |
| Raw brand source (PSD, AI, unprocessed JPG) | `design/brand-source/` (not served) |
| Agent definition | `.claude/agents/<name>.md` |
| Skill definition | `.claude/skills/<name>/SKILL.md` |
| Env file | Repo root only (`.env*`) |

Rules:
- **No loose files at repo root** unless tooling requires it there (configs, lockfiles, `.env*`, top-level `*.md` docs).
- **No new top-level folders** without stating why — reorganization churn is expensive.
- **No spaces in folder names.** Use kebab-case.
- **Asset paths:** always under `/` when referenced from Next.js (`<Image src="/branding/logo-icon.png" />`).
- **Scripts are not app code** — nothing in `src/` should import from `scripts/`.
- **`design/` is not served** — anything in `public/` ships to the browser; raw source files belong in `design/`.
