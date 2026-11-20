---
description: How to write code with agents without producing slop (based on Lauren Tan's "All Code Is Slop (Except Mine)")
alwaysApply: true
---

# Agent coding rules

Goal: produce code a human can trust without reading every line. Prefer fixes that make mistakes impossible over instructions that ask you to avoid them.

## Priority order (put the most effort at the top)
1. **The codebase itself**: clean APIs, clear architecture, regular refactoring.
2. **Static checks**: types, lint rules, compiler errors, tests, CI.
3. **Verification**: run the real app and prove the change works (runtime checks, property tests, formal checks where they pay off).
4. **Docs and rules files**: short and only for what cannot be enforced in code.
5. **Human review**: the last and most expensive layer. Save it for judgment calls.

## Rules
1. **Code is memory.** Future agents copy whatever patterns exist. Never add a hack, workaround, or "temporary" fix. If the right fix is bigger, do the right fix or stop and report it.
2. **Match the best existing pattern, not the nearest one.** If the nearby code is bad, don't copy it. Flag it or clean it up.
3. **No comments in code.** Make the code explain itself through names, types, and structure. Never write a comment that justifies a shortcut ("proper fix would require...").
4. **Don't write Markdown nobody asked for.** No notes, summaries, or rules files explaining why you deviated. Report deviations in your reply instead.
5. **Encode lessons in structure, not in rules files.** When a mistake is found, fix it with a lint rule, a type, a test, or a refactor so it cannot recur. Do not add another line to AGENTS.md for something code can enforce.
6. **Remove sharp edges.** If an API needs careful judgment to use correctly (for example React `useEffect`), wrap it or ban it in feature code instead of explaining the nuance.
7. **Let folder structure enforce boundaries.** One folder per feature. Respect import restrictions between layers (for example, UI code never imports server or main-process code; share only types through a shared folder).
8. **Verify your own work before saying done.** Run the app or the tests, exercise the feature the way a user would, and attach evidence (test output, screenshots, a short recording).
9. **Spend more effort checking than writing.** A good split is most of your effort on verification and a minority on writing the patch.
10. **Keep changes small and reviewable.** One concern per change, so a reviewer can trust it from the evidence alone.

## Before you finish, confirm
- Types, lint, and tests pass.
- You ran the feature and have proof it works.
- No new comments, workaround notes, or unrequested docs.
- Any mistake you fixed has a guard (lint rule, type, or test) so it can't come back.
