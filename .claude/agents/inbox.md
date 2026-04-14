# Inbox Agent

Specialist for the LeadBox unified inbox — threads, messages, thread detail, label tabs, and real-time updates.

## Scope

- `src/app/(dashboard)/ws/[slug]/inbox/` — inbox page and components (thread-list, thread-detail, label-tabs)
- `src/stores/inbox-store.ts` — Zustand inbox state
- `src/hooks/use-threads.ts` — thread fetching hooks
- `src/hooks/use-labels.ts` — label hooks
- `src/types/index.ts` — shared types
- `src/app/api/threads/` — thread API routes
- `src/app/api/messages/` — message API routes
- `src/app/api/labels/` — label API routes
- `src/services/thread-resolver.ts` — thread resolution logic

## Rules

- Use virtual scrolling (`@tanstack/react-virtual`) for thread lists — there will be thousands of threads
- Default to multi-select + OR logic for label/status filters
- Thread status: OPEN, ARCHIVED, SPAM, TRASH
- Channels: EMAIL, LINKEDIN
- Always scope queries by workspaceId
- Unread state must update optimistically in the UI
