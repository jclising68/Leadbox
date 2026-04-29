---
name: nextjs-verify
description: Prevent Next.js 15 hallucinations in LeadBox. Use BEFORE writing any Next.js code — route handlers, server actions, middleware, fetch caching, cookies/headers/params APIs, Image, Link, Metadata, revalidation, streaming. Grounds answers in node_modules/next/dist/docs/ and the actual installed version, not training data.
---

# Next.js 15 Verification

Per AGENTS.md: "This is NOT the Next.js you know." Training-data Next.js examples are usually wrong for this version. Verify before writing.

## Step 1 — Confirm installed version

```bash
cat package.json | grep '"next"'
ls node_modules/next/dist/docs/ 2>/dev/null | head -20
```

State the exact version before writing any code.

## Step 2 — Read the actual doc for the feature

Before using any of these, `Read` the matching file under `node_modules/next/dist/docs/`:

| Feature | Likely doc path |
|---|---|
| Route handlers (`route.ts`) | `app-router/building-your-application/routing/route-handlers.mdx` |
| Server actions | `app-router/.../server-actions-and-mutations.mdx` |
| `cookies()`, `headers()`, `draftMode()` | `functions/cookies.mdx` etc. |
| Dynamic `params`, `searchParams` | `file-conventions/page.mdx` |
| `fetch` caching | `app-router/.../caching.mdx` |
| `revalidatePath` / `revalidateTag` | `functions/revalidatePath.mdx` |
| Middleware | `routing/middleware.mdx` |
| Metadata | `functions/generate-metadata.mdx` |

Heed deprecation notices in the doc.

## Step 3 — Common Next.js 15 gotchas to check

- `cookies()`, `headers()`, `params`, `searchParams` are **async** — must be `await`ed.
- `fetch` no longer caches by default — opt in with `cache: 'force-cache'` or `next: { revalidate }`.
- Route handlers: no `req.json()` assumption — check the doc for the current request API.
- `after()` is available for post-response work.
- Dynamic segments shape changed — don't assume `{ params: { id } }`; it may be `Promise<{ id }>`.

## Step 4 — If doc is not found locally

State that, then use WebFetch against `https://nextjs.org/docs/...` for the installed version. Never guess.

## Output rule

When you write Next.js code, cite the doc you verified against:
> Verified against `node_modules/next/dist/docs/<path>` for Next <version>.

If you skipped verification, say so and flag the code as unverified.
