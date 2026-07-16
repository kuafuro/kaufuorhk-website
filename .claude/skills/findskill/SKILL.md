---
name: findskill
description: >-
  Find, discover, and install Claude Code / AI-agent skills from public skill
  directories. Use when the user wants to search for a skill ("is there a skill
  for X?"), discover skills for a task, or install a new skill into this project.
  Triggers on: "find a skill", "search skills", "install a skill", "揾 skill",
  "有冇 skill", "discover skills".
---

# findskill — discover & install AI-agent skills

This skill helps you search public skill directories and install a chosen skill
into `.claude/skills/` so it's available in future Claude Code sessions.

There are two directories you can use. Prefer **`skills` (skills.sh)** because it
is open, needs no API key, and can both search AND install. Use **`findskills`
(findskills.org)** as a fallback for its larger catalog when the first finds
nothing.

## 1. Search for a skill

Primary — the open `skills` CLI (no API key needed):

```bash
npx --yes skills find "<query>"           # e.g. "pdf generation", "playwright"
npx --yes skills find "<query>" --owner <github-owner>   # narrow to one owner
```

Broader catalog — the `findskills` CLI (93,000+ skills, needs a free API key):

```bash
npx --yes findskills "<query>"            # e.g. "web scraping", "database"
```

If `findskills` returns `API error: 403`, an API key is required. Tell the user
they can get a free key at https://findskills.org and configure it with:

```bash
npx --yes findskills auth <key>
npx --yes findskills auth --status
```

Present the matches to the user (name, owner/repo, one-line description) and ask
which one to install if it isn't obvious.

## 2. Inspect before installing

List the skills inside a repo without installing, so the user knows what they'd get:

```bash
npx --yes skills add <owner>/<repo> --list
```

## 3. Install the chosen skill

Install into THIS project (writes into `.claude/skills/`) — this is the default:

```bash
npx --yes skills add <owner>/<repo> --agent claude-code -y
```

Useful variants:

```bash
# install every skill in the repo, all agents, no prompts
npx --yes skills add <owner>/<repo> --all

# install globally (user-level, all your projects) instead of this project
npx --yes skills add <owner>/<repo> --agent claude-code -g -y

# copy files instead of symlinking (better for committing into the repo)
npx --yes skills add <owner>/<repo> --agent claude-code --copy -y
```

If the goal is a one-off use without installing, generate a prompt instead:

```bash
npx --yes skills use <owner>/<repo>@<skill-name>
```

## 4. Confirm and report

After installing, list what's now present and tell the user how to use it:

```bash
npx --yes skills list
```

Skills are picked up automatically on the next session start. The user invokes an
installed skill by typing `/<skill-name>`, or Claude applies it automatically
when the task matches the skill's `description`.

## Notes

- To commit the installed skill into the repo, prefer `--copy` so real files
  (not symlinks) land under `.claude/skills/`.
- Create a brand-new local skill instead of installing one with
  `npx --yes skills init <name>` (scaffolds `<name>/SKILL.md`).
- Directories referenced: https://skills.sh and https://findskills.org
