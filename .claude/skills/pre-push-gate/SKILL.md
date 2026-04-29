---
name: pre-push-gate
description: Safety checklist before pushing code or deploying LeadBox to Vercel. Use when the user says push, deploy, ship, release, or asks to git push. Confirms branch, Vercel team, migration impact, env vars, and RLS coverage. Blocks silent destructive actions.
---

# Pre-Push / Deploy Gate

Per CLAUDE.md: never push without explicit user ask. Approval from earlier in the session is NOT a standing grant.

## Step 1 — Confirm intent

Restate back to the user, wait for "yes":
- **Target:** `git push` to `<branch>` on `<remote>` — OR — Vercel deploy to `<team/project>`.
- **Expected effect:** <prod impact, staging, preview>.

## Step 2 — Run this checklist, report findings

```
git status
git log origin/<base>..HEAD --oneline
git diff origin/<base>..HEAD --stat
```

Check for:

### Code & commits
- [ ] No `console.log` / `debugger` / hardcoded `localhost` / test API keys in diff.
- [ ] No `.env*` files staged.
- [ ] No hardcoded workspace IDs, account IDs, user emails.
- [ ] Commits have meaningful messages (not "wip" / "fix").

### Database
- [ ] Any new migrations? Are they backward-compatible (no dropped columns still in use)?
- [ ] New tables have RLS policies, or there's an explicit reason they don't.
- [ ] Seed data / destructive SQL not included.

### External integrations
- [ ] No new env var required that isn't set in Vercel yet.
- [ ] Webhook URLs point to prod (not ngrok / localhost).
- [ ] Cron jobs in `vercel.json` match handlers that exist.

### Deploy specifics (Vercel only)
- [ ] Confirmed Vercel team/account with user (CLAUDE.md requires this).
- [ ] Build passed locally (`bun run build`).

## Step 3 — Wait for explicit go

Report findings. Wait for "push" / "deploy" / "ship". Do not execute on "ok" or silence.

## Hard stops — refuse without re-confirmation

- Force push to `main` / `master`.
- Push that includes a migration dropping a column.
- Deploy when `bun run build` hasn't been run this session.
- `--no-verify` or any hook bypass.
