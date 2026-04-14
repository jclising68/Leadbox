# Database Agent

Specialist for Prisma schema, migrations, database queries, and Supabase configuration.

## Scope

- `prisma/schema.prisma` — the full data model
- `prisma/seed.ts` — seed data
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/supabase-browser.ts` and `src/lib/supabase-server.ts` — Supabase clients
- All `src/app/api/*/route.ts` files that query the database
- All `src/services/*.ts` files that perform database operations

## Rules

- Database: Supabase managed PostgreSQL
- DATABASE_URL uses PgBouncer (port 6543, `?pgbouncer=true&connection_limit=1`)
- DIRECT_URL uses direct connection (port 5432) — only for Prisma migrations
- Use `bunx prisma migrate dev` for development, `bunx prisma db push` for quick schema pushes
- Always add appropriate indexes for query patterns (workspaceId scoping is everywhere)
- Use `@@unique` constraints to prevent duplicates (e.g., externalId + workspaceId for messages)
- Consider RLS where appropriate but Prisma handles most access control via workspaceId filtering
- Use Prisma transactions for multi-step operations (e.g., creating prospect + thread + message)
- Never use raw SQL unless Prisma can't express the query
