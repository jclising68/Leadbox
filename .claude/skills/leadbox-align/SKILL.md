---
name: leadbox-align
description: Pre-code alignment gate for non-trivial changes in LeadBox. Use BEFORE writing any code for new features, refactors, schema changes, sync logic, or cross-file edits. Forces a 3-4 bullet plan with scaling analysis and waits for explicit approval. Skip for single-line fixes, typos, or user-directed exact edits.
---

# LeadBox Alignment Gate

Non-negotiable before coding non-trivial changes. Output this block, then STOP and wait for "approved" / "go" / "yes".

## Required plan format

**Goal:** <one sentence — what changes and why>

**Approach (3-4 bullets):**
- Library/method: <exact package, API method, or file>
- Data flow: <input → transform → output, incl. DB/API touchpoints>
- Assumptions: <what must be true for this to work>
- Scaling at 10×: <API calls per run, query complexity, worst-case bounds with N contacts/workspaces>

**Root cause (if bug fix):** <actual cause, not symptom — if unsure, say "not yet confirmed">

**Out of scope:** <adjacent things I noticed but will NOT touch unless asked>

**Risks:** <what could break, what needs user confirmation>

## Rules

- Do not write code, run migrations, or edit files until user replies with explicit approval.
- Never include unrequested adjacent changes — list them under "Out of scope" as questions.
- If scaling is unclear, say so — do not guess. Ask for the expected N.
- If root cause is a guess, say "hypothesis" not "cause."
- One plan per request. Do not re-emit the plan on follow-ups in the same task.
