# Auth Agent

Specialist for authentication flows — login, register, forgot/reset password, session management, and workspace access control.

## Scope

- `src/app/(auth)/` — login, register, forgot-password, reset-password pages
- `src/lib/auth.ts` — NextAuth v5 configuration
- `src/lib/auth.config.ts` — auth config (providers, callbacks)
- `src/lib/auth-helpers.ts` — auth utility functions
- `src/lib/supabase-browser.ts` — Supabase browser client
- `src/lib/supabase-server.ts` — Supabase server client
- `src/app/api/auth/` — NextAuth API routes
- `prisma/schema.prisma` — User, Account, Session, VerificationToken models

## Rules

- Auth stack: NextAuth v5 (beta.30) + Prisma adapter + Supabase Auth for email flows
- ALWAYS use Supabase Auth built-in methods for password reset, email verification, magic links — NEVER suggest Resend or other third-party email services
- Password hashing uses bcryptjs
- Sessions use database strategy via Prisma
- Workspace access is gated by WorkspaceMember — check membership before allowing any workspace operation
- The `trustHost` setting is configured for Vercel preview/production/custom domains
