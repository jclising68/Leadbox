---
name: scaling-audit
description: Audit LeadBox code for scaling problems before commit or merge. Use when writing or reviewing sync jobs, enrichment loops, list/thread queries, cron handlers, or any path that touches many contacts/threads/workspaces. Catches N+1 queries, unbounded loops, per-row API calls, missing pagination, non-idempotent writes before they hit production.
---

# Scaling Audit — LeadBox hot paths

The app handles thousands of contacts across many workspaces. "Works on my laptop with 10 rows" is not a pass.

## Red flags — treat any hit as a blocker

### Queries
- [ ] `findMany` without `take` / `skip` — unbounded.
- [ ] Loop that calls `findUnique` / `findFirst` per item — N+1. Replace with `findMany({ where: { id: { in: [...] } } })` + in-memory map.
- [ ] `include` / `select` pulling relations you don't use.
- [ ] No index on the column used in `where` / `orderBy` for a hot query — check `schema.prisma`.
- [ ] Missing `workspaceId` filter on a user-scoped query — both a scaling AND a security bug.

### External APIs
- [ ] One API call per contact/lead in a loop — batch, or at least throttle + log.
- [ ] No pagination cursor persisted to DB — restart will re-fetch or skip.
- [ ] Backfill without resume — one failure = restart from zero.
- [ ] Tag/reply lookups not cached within a single sync run.
- [ ] Rate limit not respected (no backoff / retry-after handling).

### Writes
- [ ] `create` where an `upsert` is needed — duplicates on retry.
- [ ] Upsert key doesn't include `workspaceId + source + source_id` for synced data.
- [ ] Transaction wrapping a network call — holds DB lock while waiting on HTTP.

### Frontend lists
- [ ] Rendering full list without virtual scrolling (>200 items expected).
- [ ] No server-side pagination on thread/lead lists.
- [ ] Filter/search runs on client over full dataset.

## Required output

For each finding:
- **File:line** — <issue>
- **Blast radius at 10× load:** <calls, ms, rows>
- **Fix:** <concrete change, not a principle>

If no findings, say so plainly. Do not invent problems to look thorough.
