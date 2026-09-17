# Phase 00 — Ground Rules & Safety Net

**Status:** ✅ Complete 2026-09-15
**Depends on:** Nothing
**Estimated sessions:** 1 (short)
**Unblocks:** Everything. Do this first.

---

## Why this phase exists

Right now there is **no version control on an 18,800-line application**, and `data/backend.json` — which holds all 72 shared collections — exists in exactly one copy with no backup.

Every edit from here forward is a permanent overwrite with no diff, no history, and no undo. Phase 01 is about to rewrite how a dozen collections persist. Doing that without a safety net is the single riskiest thing on this roadmap.

This phase is small and boring and should take under an hour. Do not skip it.

---

## In scope

### 1. Version control

```bash
git init
```

- Add a `.gitignore` covering: `node_modules/`, `*.log`, `*.err.log`, `*.out.log`, `cloudflared-*.log`, and OS cruft.
- **Do track `data/backend.json`.** It is noisy, but it is currently the only copy of all shared data and history is worth more than a clean log right now. Revisit when Phase 14 moves data into Postgres.
- **Do track `data/uploads/`?** No — add to `.gitignore`. Binary attachments do not belong in git. They need the backup job in item 2 instead.
- First commit: the entire current working state, message `Initial commit — prototype state as of 2026-09-15`.

### 2. Backup for the JSON backend

`data/backend.json` and `data/uploads/` are the live dataset.

- A timestamped copy of `data/backend.json` written on a schedule (or at minimum, before any session that will mutate collections in bulk).
- Keep at least the last 10.
- Simplest viable version: a small script the server calls on startup, or a scheduled task. Do not over-engineer this — it gets replaced in Phase 14 by real database backups.

### 3. `CLAUDE.md` at the project root

✅ **Already done in the 2026-09-15 session.** Loaded automatically at the start of every Claude Code session — this is the mechanism for the stated goal, *"each session has context of what has been done and what we are planning to do."*

Contains:
- What this project is, in three sentences
- How to run it (`npm run start`, and the fallback Node path from `README.md`)
- **A pointer to `docs/roadmap/README.md` and `docs/roadmap/GLOSSARY.md` as required reading**
- The three-data-layer situation and which layer owns what
- The naming hazards (`jobs` means projects; `locations` means facilities)
- Testing: Playwright/Chromium **are** available in this environment despite not being on `PATH` — UI work must be click-tested, not just reasoned about
- The doc-sync rule: data-model changes update `docs/database-handoff-map.md` in the same session

### 4. Roadmap documents

✅ Already done in the 2026-09-15 session — this folder.

---

## Out of scope

- CI, linting, formatters, a test suite. The codebase has no test infrastructure and adding it is a separate decision, not a prerequisite.
- Branching strategy. Single `main` is fine for one developer plus AI sessions.
- Splitting `app.js`. Tempting, and it would genuinely help AI sessions, but it is a large refactor with real regression risk and no user-visible benefit. Revisit after the Pilot Milestone.

---

## Data model changes

None.

---

## Verification / done criteria

- [x] `git log` shows an initial commit — `e8ae1be`, 120 files, on `main`
- [x] `git status` is clean, and no `.log` files or `node_modules` are tracked
- [x] A backup copy of `data/backend.json` exists somewhere other than `data/` — `data/backups/`, rolling 10, via `npm run backup`
- [x] `CLAUDE.md` exists at the project root and points at the roadmap
- [x] Restoring `data/backend.json` from a backup has been tested **once**, not just assumed — md5 identical before/after, file parses, 34 dispatch jobs and 9 employees intact
- [x] First `git push` to `origin` — done 2026-09-15, force-pushed over the snapshot; local and remote both at `2b572e2`

## Implementation notes (2026-09-15)

- Remote added: `https://github.com/BradenGilbert/BioRemedy-Software.git`. Default branch renamed `master` → `main` to match GitHub.
- Commit identity is set **per-repo**, not globally: `CyberRuffus <BradenGilbert@users.noreply.github.com>`.
- **The push will hit an unrelated-histories error.** The GitHub repo already contains a one-time snapshot uploaded outside git, so it has its own root commit. Simplest fix is to force-push over it — that snapshot has no history worth preserving.
- Three things staging caught that would otherwise have gone public: `.claude/scheduled_tasks.lock` (PID + session ID), `.claude/settings.local.json`, and a stray byte-identical duplicate of `crm-schema/001_accounts.sql` sitting in `.claude/`. All now ignored via `.claude/*` + `!.claude/launch.json`. **The stray SQL duplicate is still on disk and is dead weight — consider deleting it.**
- `data/uploads/` is excluded. It holds three real documents uploaded through the job-request flow in July (two PDFs, one .docx). If the repo stays public, confirm none of them is a real customer document — they were public in the uploaded snapshot.

---

## Open decisions

- **Remote?** A private GitHub remote gives off-machine durability and makes `/code-review` and PR workflows available. Local-only git still solves the undo problem. Not a blocker either way — decide when convenient.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan. Do not leave corrections only in chat.)*
