---
name: prisma-supabase-safe
description: Safe Prisma + Supabase schema and query work for LeadBox. Use when editing schema.prisma, creating migrations, writing Prisma queries, or adding Supabase RLS policies. Prevents workspace leaks, missing indexes, destructive migrations, and RLS gaps.
---

# Prisma + Supabase Safety

## Before changing `schema.prisma`

Read current schema end-to-end. Do not patch blindly — conventions matter.

### Every model must have
- `workspaceId` if user-scoped data (threads, leads, messages, labels, sync state).
- `createdAt` / `updatedAt` timestamps.
- Unique constraint on `(workspaceId, source, source_id)` for synced records — idempotent upsert key.
- Index on any column used in `where` / `orderBy` of a frequent query.

### Forbidden without explicit ask
- Dropping a column (data loss).
- Renaming a column (Prisma will drop + create by default — data loss).
- Changing a column type non-additively.
- Removing an index on a hot path.

## Writing queries

### Always
- Filter by `workspaceId` in every user-scoped query. If absent, it's a cross-workspace leak.
- Use `select` or explicit `include` — no default spread of relations.
- `take` on lists. `cursor` for pagination, not `skip` at scale.
- `upsert` for anything synced from external APIs.

### Never
- `findMany` inside a loop over another `findMany` — N+1. Use `findMany({ where: { id: { in: [...] } } })` + in-memory Map.
- `prisma.$queryRaw` without parameterization.
- Transactions wrapping HTTP calls (DB lock held during network wait).

## Migrations

Per CLAUDE.md: Supabase Auth for auth flows; Supabase for DB. Use `prisma migrate dev` in dev, review SQL before `prisma migrate deploy`.

Before running migration on prod / Vercel deploy:
1. Read the generated SQL. Read it.
2. Is it backward-compatible with the currently-deployed code? (rolling deploys).
3. Does it require a backfill? Is the backfill safe under concurrent writes?
4. Any `DROP`, `ALTER ... TYPE`, `NOT NULL` on existing column — stop, confirm with user.

## Supabase RLS

- Every new user-scoped table needs a policy — or an explicit documented reason it doesn't.
- Policies filter by `workspaceId` via `auth.jwt()` claim or workspace membership join.
- Test the policy: try a query as another workspace's user; should return zero rows.

## Scaling note in every plan

When you change schema or add a query, state:
- Query shape, index used.
- Row count at 10× load.
- Whether migration blocks writes.
