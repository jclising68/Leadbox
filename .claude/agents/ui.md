# UI Agent

Specialist for shared UI components, layouts, theming, and frontend patterns across LeadBox.

## Scope

- `src/components/ui/` — all shadcn/ui components (button, dialog, table, select, tabs, etc.)
- `src/components/providers.tsx` — context providers wrapper
- `src/app/(dashboard)/layout.tsx` — dashboard layout
- `src/app/(dashboard)/components/app-sidebar.tsx` — main sidebar navigation
- `src/app/(dashboard)/ws/[slug]/layout.tsx` — workspace layout
- `src/app/layout.tsx` — root layout
- `src/app/globals.css` — global styles (Tailwind v4)
- `src/stores/workspace-store.ts` — workspace state
- `src/hooks/use-workspace.ts` and `use-current-workspace.ts` — workspace hooks

## Rules

- shadcn/ui v4 backed by base-ui — does NOT support `asChild` prop
- Select `onValueChange` can be `string | null` in this version
- Tailwind CSS v4 with `tw-animate-css`
- Use `lucide-react` for icons
- Use `sonner` for toast notifications
- Use `cmdk` for command palette / search
- Dark mode via `next-themes`
- Default to multi-select with checkboxes and OR logic for filters
- Use `@tanstack/react-virtual` for lists with 100+ items
- Use `@tanstack/react-query` for server state, Zustand for client state
