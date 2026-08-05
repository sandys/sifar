---
name: syncing-docs-before-commit
description: >-
  Keep this repo's agent docs in lockstep with the code: .agents/REPO_GUIDE.md
  (served as AGENTS.md and CLAUDE.md) plus the skills tree. Use immediately
  before every git commit, and right after any substantial change - added,
  renamed, or removed commands/scripts, dependency or build/CI config changes,
  new or moved top-level directories, schema or API changes. Also use when the
  user says "sync the docs", "update the docs before committing", or "make the
  guide match the code", and whenever a commit is blocked by the
  agents-doc-sync pre-commit hook. Diff-aware and fast: fixes only what the
  current change invalidated. For deeper end-of-session harvesting, use
  capturing-session-knowledge instead.
---

# Syncing docs before commit

The guide and skills must describe the repo *as of this commit* - the next
agent trusts them blindly. This skill is the fast, diff-scoped sync; it is not
a full retro.

## Step 1 - Read the change

```bash
git diff --cached --name-status --stat   # staged changes (the pre-commit case)
git diff --name-status                   # nothing staged yet? review the working tree
```

In CI, diff the pushed range instead: `git diff --name-status "$BASE...HEAD"`.

## Step 2 - Find what the change invalidates

- Grep every changed path, command, script name, and directory through
  `.agents/REPO_GUIDE.md` and `.agents/skills/*/SKILL.md`.
- Interrogate each hit: is this sentence still true after the diff? Do the
  Commands still exist under the same names? Did an Architecture bullet's
  directory or entry point move? Did the change fix a documented gotcha?

## Step 3 - Update

- Rewrite stale lines in place; delete statements the diff made false. A wrong
  doc is worse than a missing one.
- New durable fact (command, dependency, env var, port, directory) -> the
  matching REPO_GUIDE.md section.
- New or changed multi-step procedure -> create or update a skill, following
  the routing rules and template in capturing-session-knowledge.
- State present truth only - no changelog prose ("2026-07: refactored X");
  git history is the changelog.
- Respect the guide's ~150-line cap: prune when you add.

## Step 4 - Check and stage

```bash
git add .agents/
bash .agents/hooks/pre-commit   # previews the commit: skill lint + staleness check
```

Staging `.agents/` updates into the human's pending commit is expected here;
still never run `git commit` or `git push` yourself unless asked.

## Failure modes

- Hook blocked but the change truly affects no docs: say so and let the human
  use `AGENTS_SKIP_DOC_SYNC=1`. Never make cosmetic doc edits just to pass.
- Nothing stale found after a real search: report "docs already accurate" and
  which greps you ran. Do not invent updates.
- Do not paste the diff into the docs; record the durable consequence of the
  change, not the change itself.

## Done when

- No sentence in REPO_GUIDE.md or any skill contradicts the staged diff.
- `bash .agents/hooks/pre-commit` exits clean.
