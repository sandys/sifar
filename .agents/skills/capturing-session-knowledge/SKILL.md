---
name: capturing-session-knowledge
description: >-
  Extract reusable knowledge from the current work session and persist it into this
  repo's shared agent docs under .agents/. Use when the user says "capture what you
  learned", "save this", "update the skills", "write this up", "retro", or "document
  this for next time" - and proactively offer it at the end of any session where you
  solved a non-obvious problem, discovered a repo-specific gotcha, worked out a
  multi-step procedure, or found that existing docs were wrong. Routes durable facts
  into .agents/REPO_GUIDE.md and reusable procedures into skills in .agents/skills/,
  then checks everything with the repo's agents-doc-sync hook.
---

# Capturing session knowledge

The goal: the next agent - Claude Code, Codex, or Gemini CLI, next week or next
quarter - should never rediscover what this session already learned.
`.agents/REPO_GUIDE.md` holds durable facts; skills in `.agents/skills/` hold
reusable procedures. Keep both lean: stale or bloated docs are worse than none.

## Step 1 - Harvest

Re-read the whole session and list every candidate learning under these headings:

- **Procedures**: multi-step workflows that worked (deploys, migrations, release
  steps, debugging recipes, data fixes).
- **Facts**: durable repo truths (commands, ports, env vars, service names, where
  things live, which branch to target).
- **Gotchas**: surprising failures and their fixes, and approaches that did NOT
  work and why - negative knowledge prevents repeated dead ends.
- **Decisions**: choices made and their reasoning, when future work depends on them.

## Step 2 - Filter

Keep a learning only if all of these hold:

1. Verified in this session - it actually happened, not speculation.
2. Likely to recur - a future agent or teammate will hit this again.
3. Not already documented - check REPO_GUIDE.md and existing skills first.
4. Contains no secrets: no tokens, keys, passwords, connection strings, or
   customer data. Everything under `.agents/` is committed and shared.

Drop one-off trivia and anything specific to this session's temporary state.

## Step 3 - Route

| Learning | Destination |
| --- | --- |
| Durable fact (fits in 1-2 lines) | `REPO_GUIDE.md`, matching section |
| Reusable multi-step procedure | a skill in `.agents/skills/` |
| Gotcha tied to one procedure | that skill's **Failure modes** section |
| Gotcha about the repo/env in general | `REPO_GUIDE.md` > Gotchas |

Rule of thumb: a fact belongs in the guide; anything that has grown into a
procedure belongs in a skill.

## Step 4 - Update REPO_GUIDE.md

Edit in place. Merge with what is there; never append a duplicate; rewrite a
section when that is clearer than patching it. Keep entries terse and timeless
(no "today we discovered..."). If the guide grows past ~150 lines, move detail
into a skill or delete stale content.

## Step 5 - Create or update skills

First inspect what exists: `head -n 10 .agents/skills/*/SKILL.md`. Prefer
updating an existing skill over creating a near-duplicate.

When creating a new skill at `.agents/skills/<name>/SKILL.md`:

- **name**: a gerund phrase (`releasing-hotfixes`, `debugging-webhook-retries`);
  1-64 chars; lowercase `a-z`, `0-9`, hyphens; no leading, trailing, or double
  hyphens; must exactly match the directory name.
- **description**: up to 1024 chars, third person. State what it does AND when to
  use it, front-loading the concrete phrases a teammate would actually type. Err
  on the side of pushy - agents under-trigger skills far more than they
  over-trigger.
- **Frontmatter**: `name` and `description` only (add `compatibility` only if the
  skill truly needs specific tooling). No tool-specific fields - the same file
  must work identically in Claude Code, Codex, and Gemini CLI.
- **Body**: under 500 lines, imperative mood, following this template:

```markdown
---
name: <name>
description: <what it does + when to use + trigger phrases>
---

# <Title>

## When to use
<Trigger conditions in one short paragraph, plus cases where NOT to use it.>

## Workflow
1. Run `<exact command>` from `<directory>`. Expect `<output>`.
2. Verify <check> before continuing.
<Exact commands and real file paths - vague steps are what this system exists to prevent.>

## Failure modes
- If step <N> fails with <symptom>, do <action>.
- <Approach X> looks plausible but does not work because <reason>.

## Done when
- <Objectively checkable completion criteria.>
```

- Long reference material goes in `references/<topic>.md`, linked from SKILL.md
  with a note on when to read it. Helper code you found yourself rewriting goes
  in `scripts/`, self-contained, with usage shown in SKILL.md. Keep references
  one level deep.

New skills are picked up by all three tools automatically: Codex and Gemini CLI
scan `.agents/skills/` natively, and Claude Code sees it through the
`.claude/skills` symlink. If a new skill does not appear, restart the CLI session.

## Step 6 - Check

Stage the doc changes, then run the repo's doc hook as a preview of the commit:

```bash
git add .agents/
bash "$(git rev-parse --show-toplevel)/.agents/hooks/pre-commit"
```

It lints every skill (frontmatter present, `name` matching its directory, a
`description` present) and scans staged `.agents/` changes for secrets. Fix
anything it reports. Confirm the layout is intact: `ls -la` at the repo root
must show `AGENTS.md` as a symlink to `.agents/REPO_GUIDE.md`, and
`.claude/skills -> ../.agents/skills`. `CLAUDE.md` is deliberately a real file
with its own Claude Code instructions that cross-reference the guide — do not
replace it with a symlink.

## Step 7 - Report

End with a short report: learnings captured (grouped by destination), learnings
deliberately dropped and why, files created or modified, and a suggested commit
message such as `docs(agents): capture session knowledge - <topic>`. Do not
commit or push unless the user asks or REPO_GUIDE.md says agents may.
