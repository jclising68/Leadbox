---
name: root-cause-first
description: Force root-cause analysis before proposing any bug fix in LeadBox. Use when the user reports a bug, error, regression, "it's broken", "not working", wrong data, or failing build. Blocks bandaid instincts — no try/catch swallowing, no env-var-as-cause guesses, no "added a null check" without explaining why null happened.
---

# Root Cause First

Per CLAUDE.md Engineering Discipline: "No bandaid fixes. Find the root cause."

## Rule

You cannot propose a fix until you state, in one sentence, the actual cause. If you don't know, say "hypothesis, not confirmed" and say what evidence would confirm it.

## Required output before any code change

```
Symptom:      <exact error / wrong behavior, copied verbatim>
Reproduction: <steps or inputs that trigger it>
Investigated: <files read, logs checked, DB queried, API hit>
Root cause:   <one sentence, factual> — OR — Hypothesis: <...>
Evidence:     <what proved the cause, or what would>
Why now:      <what changed recently — commit, config, data, API>
```

Then — and only then — propose the fix via `leadbox-align`.

## Don't-confuse-symptom-with-cause checklist

Before declaring root cause, ask:
- If I "fix" this, could the same issue appear with different symptoms elsewhere?
- Is this a downstream effect of bad input / stale cursor / race / missing index?
- Did the code ever work? If yes, what changed? Check `git log -- <file>`.

## Bandaid patterns to reject in yourself

- `try { ... } catch { return null }` to silence an error.
- `if (!x) return` to skip when `x` should have been set.
- Adding a retry to a call that shouldn't fail in the first place.
- Changing a query to `findFirst` from `findUnique` to "avoid" a duplicate error.
- Clearing a cursor / cache / DB row to reset state without knowing why it got bad.
- "It worked when I added this log" — race conditions don't get fixed by logging.

## The "don't over-engineer" counter-rule

Not every issue is code. Before deep-diving, rule out:
- Env var missing or wrong in this environment.
- Data issue — one bad row, one stale cursor, one deleted workspace.
- Timing — ran before a migration, ran before a cron finished.
- User error — wrong account, wrong workspace, expected behavior.

"Wait and see" or "fix the data, not the code" is a valid conclusion. State it plainly.
