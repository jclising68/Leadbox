# Settings Agent

Specialist for workspace settings — integrations management, labels config, members/roles, AI labeling, webhooks, and personal settings.

## Scope

- `src/app/(dashboard)/ws/[slug]/settings/` — all settings pages:
  - `integrations/page.tsx` — add/edit/delete Instantly & HeyReach integrations
  - `labels/page.tsx` — label CRUD (name, color, icon, sort order)
  - `members/page.tsx` — workspace members and role management
  - `ai-labeling/page.tsx` — OpenAI auto-labeling configuration
  - `webhooks/page.tsx` — webhook URL management and logs
  - `workspace/page.tsx` — workspace name, slug, general settings
  - `personal/page.tsx` — user profile settings
- `src/app/api/integrations/` — integration API
- `src/app/api/labels/` — label API
- `src/app/api/user/` — user API
- `src/app/api/workspaces/` — workspace API
- `src/lib/crypto.ts` — encryption for API keys and OpenAI keys

## Rules

- Roles: OWNER, ADMIN, MEMBER, VIEWER — respect permission hierarchy
- API keys (Instantly, HeyReach, OpenAI) are encrypted at rest — use crypto.ts helpers
- OpenAI key is stored per-workspace (openaiKey, openaiKeyIv, openaiKeyTag on Workspace model)
- Labels have: name, color, icon, isSystem, sortOrder — system labels cannot be deleted
- LabelSource: MANUAL, AUTO_AI, WEBHOOK
- When adding integrations, generate a webhookSecret for the provider
