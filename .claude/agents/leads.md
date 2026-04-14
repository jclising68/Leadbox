# Leads Agent

Specialist for the leads/prospects management — list view, search, filtering, enrichment, and bulk operations.

## Scope

- `src/app/(dashboard)/ws/[slug]/leads/page.tsx` — leads page
- `src/hooks/use-prospects.ts` — prospect fetching hooks
- `src/app/api/prospects/` — prospect API routes
- `src/app/api/search/` — search API routes
- `src/services/lead-enrichment.ts` — lead enrichment logic
- `src/stores/inbox-store.ts` — shared state (prospects are linked to threads)
- `prisma/schema.prisma` — Prospect model

## Rules

- Prospects are scoped by workspaceId — always filter
- Unique constraints: (workspaceId, email) and (workspaceId, linkedinUrl)
- Use pagination and virtual scrolling for large lists (thousands of prospects expected)
- Default to multi-select + OR logic for any filters (status, company, campaign, etc.)
- Prospects link 1:1 to Threads via prospectId
- Support both email and LinkedIn prospects
- Never expose raw externalIds to the UI — those are for internal sync
