# Scripts

One-off utilities that run outside the Next.js app. Run with `bunx tsx <path>`.

## `tests/`
Exploratory scripts for probing external APIs (Instantly, HeyReach) with a real
workspace API key. Used to confirm response shape before writing sync code —
`sync-triage` skill references these when debugging.

Naming: `test-<provider>-<scope>.ts`.

Example:
```bash
bunx tsx scripts/tests/test-instantly-lead.ts
```

These are NOT unit tests. They hit real APIs and print raw responses. Do not run
against production data without the user's OK.

## `ops/`
One-off operational scripts that modify data — password resets, backfills,
data fixes. Must be idempotent or clearly document that they aren't.

Example:
```bash
bunx tsx scripts/ops/reset-password.ts <email>
```

## Adding a new script

- API probe / shape check → `scripts/tests/test-<provider>-<scope>.ts`
- One-off data fix or admin task → `scripts/ops/<action>.ts`
- Recurring scheduled job → NOT here. Put in `src/app/api/cron/...` and wire in `vercel.json`.
