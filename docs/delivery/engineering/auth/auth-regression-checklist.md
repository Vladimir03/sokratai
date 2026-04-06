# Auth Regression Checklist

## Core Scenarios
- [ ] New tutor via email: `/register-tutor` -> `/tutor/dashboard`
- [ ] Existing student email on tutor registration is blocked with clear error
- [ ] Tutor email login from `/tutor/login` lands in `/tutor/dashboard`
- [ ] Non-tutor email login on `/tutor/login` signs out and shows `not_tutor_account`
- [ ] Tutor Telegram login uses token with `intended_role=tutor`
- [ ] Tutor Telegram login never redirects to `/chat`
- [ ] Student Telegram login from `/login` still works and lands in `/chat`

## Routing Separation
- [ ] All "Я репетитор" links point to `/tutor/login`
- [ ] Footer tutor actions point to `/tutor/login`
- [ ] Student login page does not route tutors through student-only entrypoint

## Backend Guardrails
- [ ] `assign-tutor-role` blocks `upgrade_existing` with deterministic status/error
- [ ] `assign-tutor-role` still allows new tutor registrations

## Cross-Browser Manual Smoke
- [ ] Safari macOS
- [ ] Safari iOS
- [ ] Chrome Android

## Release Gates
- [ ] `bun run build`
- [ ] `bun run smoke-test`
