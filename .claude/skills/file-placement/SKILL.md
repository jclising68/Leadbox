---
name: file-placement
description: Decide where a new file goes in LeadBox before creating it. Use when creating any new file — component, service, script, asset, type, hook, route, skill, agent. Enforces the File Organization table in CLAUDE.md so the repo stays organized as it grows.
---

# File Placement

Before creating any new file, decide its home using the table below. If the file doesn't fit a category, ask — do not drop it at repo root.

## Placement table

| File type | Goes in | Naming |
|---|---|---|
| Next.js page/layout | `src/app/<route-group>/...` | `page.tsx`, `layout.tsx` |
| API route handler | `src/app/api/<domain>/route.ts` | Next.js convention |
| Cron handler | `src/app/api/cron/<job>/route.ts` | kebab-case job name; wire in `vercel.json` |
| UI component | `src/components/<category>/<name>.tsx` | kebab-case file, PascalCase export |
| Domain service | `src/services/<domain>.ts` | kebab-case, e.g. `instantly-sync.ts` |
| External API client / util | `src/lib/<name>.ts` | kebab-case |
| React hook | `src/hooks/use-<name>.ts` | `use-` prefix |
| Zustand store | `src/stores/<name>-store.ts` | `-store` suffix |
| Type definitions | `src/types/<domain>.ts` | kebab-case |
| Prisma schema / seed | `prisma/schema.prisma`, `prisma/seed.ts` | fixed names |
| API probe / shape test | `scripts/tests/test-<provider>-<scope>.ts` | `test-` prefix |
| One-off ops task | `scripts/ops/<action>.ts` | kebab-case verb |
| Served static asset | `public/<category>/<name>.<ext>` | kebab-case, lowercase |
| Favicon / PWA icon | `public/` root | convention names |
| Raw brand source | `design/brand-source/` | not served |
| Agent definition | `.claude/agents/<name>.md` | kebab-case |
| Skill definition | `.claude/skills/<name>/SKILL.md` | kebab-case folder |

## Decision procedure

When creating a new file:

1. **Match the type** against the table. If unsure, ask the user which bucket it fits.
2. **Check for an existing sibling** — if there's already a file doing something similar, put yours next to it. Don't invent a new folder for one file.
3. **Name it** using the convention in the table. Kebab-case, lowercase, no spaces, no dates in filenames.
4. **Never create a new top-level folder** without stating why and waiting for approval.
5. **Never drop files at repo root** unless it's tooling config (lockfile, `.config.*`, `.env*`, top-level docs).

## Hard rules

- **No spaces in folder or file names.** Use `brand-source` not `Brand Source`.
- **No duplicate homes.** If a file could go in two places, ask — don't pick both.
- **No `scripts/` imports from `src/`** — scripts are for out-of-band execution.
- **No raw design sources in `public/`** — `public/` ships to the browser. Put PSD/AI/raw JPG in `design/`.
- **No hand-edited migrations.** Use `bunx prisma migrate dev`.
- **No component code inside `src/app/`** past the route file — extract to `src/components/`.

## When the table doesn't fit

State:
- What the file is (code, asset, data, doc).
- Who reads it (app runtime, build tool, human, external system).
- When it runs (request, build, one-off, never).

Then ask the user where to put it. Never invent a new top-level folder as a default.
