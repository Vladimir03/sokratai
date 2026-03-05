# AGENTS.md

Repository guidance for AI coding agents (Codex, Claude Code, Cursor).

## Purpose

This repository is designed for AI-assisted development.

Agents are responsible for:
- implementing tasks
- debugging
- running validation

Humans are responsible for:
- architecture
- feature design
- reviewing output

---

# Development Model

This project follows **Spec-Driven Development**.

Workflow:

Problem
→ requirements.md
→ design.md
→ tasks.md
→ implementation

Agents must implement **tasks.md only**.

---

# Agent Workflow

Before writing code:

1. Read `AGENTS.md`
2. Read `CLAUDE.md`
3. Read architecture docs
4. Read feature spec (if exists)

Then:

1. Propose implementation plan
2. Implement minimal solution
3. Run validation commands

---

# Project Overview

SokratAI is an AI-powered education platform for:

1️⃣ Students  
2️⃣ Tutors

Domains are strictly isolated.

Student:

`src/pages/chat`
`src/pages/practice`
`src/pages/diagnostic`

Tutor:

`src/pages/tutor/*`
`src/components/tutor/*`

Shared:

`src/components/ui`
`src/types`

## Project Map

Frontend app:
`src/`

Routes and app composition:
`src/App.tsx`

React entrypoint:
`src/main.tsx`

Supabase edge functions:
`supabase/functions/`

Database migrations:
`supabase/migrations/`

Engineering docs:
`docs/engineering/`

Architecture map (human):
`docs/engineering/architecture/README.md`

Architecture map (machine):
`docs/engineering/architecture/modules.json`

High-risk zones:
`docs/engineering/architecture/high-risk-zones.md`

---

## Working Commands

Run commands sequentially on Windows (avoid concurrent writes to `dist/`):

```sh
npm run dev
npm run lint
npm run build
npm run test
npm run smoke-test
npm run smoke-check
```

Notes:
- `test` runs `smoke-check`
- `smoke-test` is legacy bash smoke test
- `smoke-check` runs Node smoke tests (`scripts/smoke-check.mjs`)
- CI uses `smoke-check` as the main quality gate
- `lint` is currently informational in CI
- if lint fails still run `build` and `smoke-check`
- `package.json` + CI workflows are source of truth for commands

---

# Development Rules

Agents must:

- make minimal changes
- avoid refactoring unrelated files
- preserve public APIs
- follow architecture constraints

For DB-backed features:

1 apply Supabase migration  
2 deploy backend  
3 deploy frontend

---

## Supabase Drift Guardrails

- Before changing `verify_jwt` in `supabase/config.toml` or using `--no-verify-jwt` in workflow deploy commands, run a drift-check between config and workflow and request explicit owner decision for policy changes.
- Before changing `supabase/config.toml`, verify bidirectional consistency: every `[functions.*]` entry should map to `supabase/functions/*`, and every `supabase/functions/*` directory should have an explicit policy decision in config.

---

## Critical Boundaries

- Keep **Student** and **Tutor** modules isolated.
- Keep `src/components/ui/*` lightweight (no heavy runtime dependencies).
- Treat these files as high-risk and change only when required:
  - `src/components/AuthGuard.tsx`
  - `src/components/TutorGuard.tsx`
  - `src/pages/Chat.tsx`
  - `src/pages/tutor/TutorSchedule.tsx`
  - `supabase/functions/telegram-bot/index.ts`

---

# Database Rules

Allowed:

- new tables
- additive migrations
- new indexes

Forbidden:

- modifying existing migrations
- dropping columns
- renaming columns

---

# Tutor Payments Rules

Mini-group payments use participant-level idempotency: (lesson_id, tutor_student_id)

Never assume one payment row per lesson.

Status presentation must remain:
- pending
- paid

Do NOT reintroduce `overdue` without product decision.

Lesson date source: tutor_lessons.start_at

fallback: tutor_payments.due_date

---

## Output Expectations

When completing a task include:
1️⃣ summary of changed files
2️⃣ commands used for validation
3️⃣ list of files intentionally NOT modified

