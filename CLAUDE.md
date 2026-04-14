@AGENTS.md

## Stack & Auth

- This is a **Next.js 15 + TypeScript + Supabase + Prisma + Bun** project, deployed on **Vercel**
- Always use **Supabase Auth** built-in methods for auth flows (password reset, email verification, magic links) — do NOT suggest third-party services like Resend unless explicitly asked
- Check existing project patterns before implementing anything auth-related

## Dev Server

- When asked to stop/restart the dev server, verify the process is actually killed (`lsof -i :3000`) before confirming
- If Turbopack cache is corrupted or build is broken, delete `.next` folder and restart
- Use `bun run dev` (not npm)

## External API Integrations

- When working with external APIs (Instantly, HeyReach, Make.com, n8n, Salesmate, Apollo), use the API keys/credentials the user provides directly — do NOT try pre-configured MCP workspaces or guess endpoints
- Ask for docs or test endpoints incrementally if unsure
- Never hardcode field names, account IDs, or values in API mappings — always use dynamic/configurable mapping

## Deployment

- Before deploying to Vercel, confirm which Vercel account/team to deploy to — never deploy without explicit user confirmation
- After deploy, verify the build succeeds before moving on
- Do NOT push code to git without asking first — always confirm before committing or pushing

## UI Patterns

- Default to **multi-select with checkboxes and OR logic** for category/tag filters unless told otherwise
- Never use AND logic for filters without asking first
- For PDF generation: never use fixed coordinate overlays — always use programmatic rendering with a grid/layout system

## Code Patterns

- Use dynamic/configurable mappings for field transforms and API integrations — never hardcode
- Before writing any code for a non-trivial feature, outline the approach in 3-4 bullet points and wait for approval
- Especially confirm: what library/method to use, the data flow, and any assumptions being made

## Performance

- This app will handle thousands of contacts — consider caching, pagination, and virtual scrolling for lists
- Use Supabase RLS where appropriate for data isolation
