---
name: sync-triage
description: Debug Instantly or HeyReach sync issues in LeadBox — missing tags, missing replies, backfill stalls, duplicate threads, cursor not advancing, webhook drift. Use when the user reports sync bugs, stuck syncs, or wrong data after a sync run. Grounds diagnosis in DB cursor state and actual API response shape before proposing any fix.
---

# Sync Triage — Instantly & HeyReach

Find root cause before patching. Bandaids on sync = production pain.

## Step 1 — Reproduce the symptom precisely

Ask (or check) these before reading code:
- Which workspace? Which campaign/list ID?
- When did it last work? What changed (code, API key, endpoint)?
- Is it "missing data" or "stuck forever" or "duplicates"?

## Step 2 — Inspect state, not code

Always check in this order:

1. **Cursor state in DB** — `SyncCursor` / `sync_cursor` / per-workspace cursor rows. Is `next_starting_after` / `last_synced_at` / `offset` plausible? Is it frozen?
2. **Recent sync logs** — errors, rate-limit hits, page counts per run.
3. **Raw API response** — hit the endpoint with the workspace's actual key. Compare shape to what the code expects. Do NOT trust memory of API shape; tags/replies endpoints have changed.
4. **DB row counts** — `SELECT count(*) ... GROUP BY source` by day to find the gap.

## Step 3 — Known root-cause patterns in this repo

Check these before inventing a new theory:

- **Tags missing on HeyReach leads** → tags aren't on `/lead/GetLead`; must reverse-lookup via `/lead/GetTags` per tag and map back. (fix: c165102)
- **Backfill ends prematurely on short pages** → page size < limit is NOT end-of-data for HeyReach; trust an explicit end marker or empty page. (fix: c165102, 685e0af)
- **Instantly backfill never ends** → trust `next_starting_after`; when absent, backfill is done. Do not loop on empty arrays. (fix: fa55438)
- **Enrichment cursor resets on redeploy** → cursor must persist in DB, not in-memory. (fix: 685e0af)
- **Duplicate threads** → idempotency key mismatch; upsert by `(workspace_id, source, source_thread_id)` not by our internal id.

## Step 4 — Propose fix with root cause stated

Invoke `leadbox-align` format. Required fields:
- **Root cause:** <one sentence, factual>
- **Evidence:** <what in state/API proved it>
- **Fix scope:** <files + why this fixes the cause, not the symptom>
- **Scaling:** API calls per sync run after fix, at 10× contacts.

## Anti-patterns — do NOT do these

- Adding a `try/catch` that swallows the error.
- Clearing the cursor to "start fresh" without understanding why it froze.
- Hardcoding a workspace ID or account ID in a fix.
- Adding a second sync path that runs alongside the broken one.
