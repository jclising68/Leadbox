---
name: integration-scaffold
description: Scaffold a new external API integration in LeadBox (Instantly, HeyReach, Apollo, Salesmate, Make, n8n, or new providers). Use when adding a new provider, new endpoint, new webhook, or new sync job. Enforces user-provided credentials, dynamic field mapping, cursor persistence, idempotent upserts, and webhook idempotency.
---

# Integration Scaffold

Per CLAUDE.md: never guess endpoints, never use pre-configured MCP workspaces, never hardcode field names.

## Before any code

Ask the user for:
1. **API key / auth** — which workspace, which account. Confirm env var name.
2. **Docs link or sample response** — paste the actual response shape. Do not work from memory.
3. **Test endpoint to hit first** — usually `/me`, `/account`, or similar read-only.

Hit that endpoint with their key, print the raw response, confirm the shape matches docs.

## Required components for every new integration

### 1. Client module
- `src/lib/<provider>/client.ts` — fetch wrapper with: auth header injection, rate-limit handling (respect `Retry-After`), retry with exponential backoff on 5xx, timeout.
- No workspace/account ID hardcoded. Pass via function args.

### 2. Field mapping (dynamic)
- `src/lib/<provider>/mapping.ts` — table-driven `{ provider_field: our_field }` map.
- Never inline `obj.first_name || obj.firstName || obj.FirstName` — put it in the map.
- Mapping is exported and testable.

### 3. Sync job
- Cursor persisted to DB (table: `SyncCursor` or similar) keyed by `(workspaceId, provider, resource)`.
- Page size from config, not hardcoded.
- End-of-history detection: explicit marker from API, NOT "page < limit."
- Idempotent upsert on `(workspaceId, provider, source_id)`.

### 4. Webhook handler (if applicable)
- Verify signature if provider supports it.
- Dedupe by event ID for at least 24h (store in DB or Redis).
- Return 200 fast; enqueue heavy work.

### 5. Settings UI surface
- Credentials entered in Settings, stored per-workspace (encrypted if secret).
- Toggle: enable/disable sync per workspace.
- Visible: last sync time, last error, rows synced.

## Before shipping

- [ ] Ran against real account, not just mocked.
- [ ] Logged one full sync cycle end-to-end.
- [ ] `scaling-audit` passed.
- [ ] `pre-push-gate` checklist done.

## Anti-patterns

- Copy-pasting existing provider code without reading its API response shape.
- Adding a second sync path "for safety" while the main one exists.
- Storing credentials in env vars when they should be per-workspace.
