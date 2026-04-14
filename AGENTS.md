<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Dedicated Agents

The following agents are available in `.claude/agents/` for focused work:

- **inbox** — Threads, messages, thread detail, label tabs, real-time inbox updates
- **integrations** — Instantly & HeyReach API sync, webhooks, reply/tag bidirectional sync, cron jobs
- **leads** — Prospects list, search, filtering, enrichment, bulk operations
- **settings** — Workspace settings, integrations config, labels, members/roles, AI labeling, webhooks
- **auth** — Login, register, forgot/reset password, NextAuth + Supabase Auth flows
- **database** — Prisma schema, migrations, queries, Supabase config, seed data
- **ui** — Shared components, layouts, theming, shadcn/ui v4, Tailwind v4, virtual scrolling
