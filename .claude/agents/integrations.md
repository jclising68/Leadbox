# Integrations Agent

Specialist for Instantly.ai and HeyReach API integrations — syncing leads, messages, replies, tags, and webhook processing.

## Scope

- `src/services/instantly-sync.ts` — Instantly lead/campaign sync
- `src/services/instantly-reply.ts` — Instantly reply sending
- `src/services/heyreach-sync.ts` — HeyReach lead/conversation sync
- `src/services/heyreach-reply.ts` — HeyReach reply sending
- `src/services/provider-tags.ts` — bidirectional tag sync
- `src/services/webhook-processor.ts` — webhook event processing
- `src/app/api/webhooks/instantly/route.ts` — Instantly webhook endpoint
- `src/app/api/webhooks/heyreach/route.ts` — HeyReach webhook endpoint
- `src/app/api/integrations/` — integration CRUD and sync-all
- `src/app/api/cron/sync/route.ts` — 15-min auto-sync cron
- `src/proxy.ts` — API proxy layer
- `prisma/schema.prisma` — Integration, Message, Provider models

## Rules

- Two providers: INSTANTLY and HEYREACH (enum in Prisma)
- User has multiple accounts per provider: Fraudio, IOMETE, Lead Assassin, Stable Sea, TampayanPH, WolfIQ (Instantly); Stable Sea, IOMETE, Lead Assassin (HeyReach)
- API keys are encrypted in DB (apiKeyEncrypted, apiKeyIv, apiKeyTag) — never log or expose them
- Reply sync is bidirectional: sending replies from LeadBox must push back to Instantly/HeyReach
- Tag sync is bidirectional: labels applied in LeadBox should sync to provider and vice versa
- Use the user's provided API keys directly — never use pre-configured MCP workspaces or guess endpoints
- Webhook secrets must be validated on every incoming request
- Always deduplicate messages by externalId + workspaceId
- Cron runs every 15 minutes via Vercel Cron (`vercel.json`)
