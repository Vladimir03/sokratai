# Docs Structure

Project documentation follows a strict Discovery / Delivery split.

## Directory layout

```
docs/
├── discovery/           # WHAT and WHY we build
│   ├── methodology/     # Generic AJTBD framework (Zamesin)
│   ├── research/        # Sokrat AJTBD artifacts (01–10, job-graphs, prompts)
│   ├── product/         # PRDs, tutor-ai-agents (10–20), KB design
│   └── prototypes/      # HTML prototypes
│
├── delivery/            # HOW we build
│   ├── features/        # Per-feature folders (spec + tasks + prompts)
│   └── engineering/     # Architecture, auth, DB, telegram, overview
│
└── misc/                # Uncategorized (rag-bot-setup, etc.)
```

## Rules

### New documents

- Discovery artifacts (research, PRD, UX principles, prototypes) go in `docs/discovery/`.
- Delivery artifacts (tech specs, tasks, prompts, engineering docs) go in `docs/delivery/`.
- Each feature gets its own folder under `docs/delivery/features/{feature-name}/`.
- Do NOT create files in legacy paths: `docs/product/`, `docs/features/`, `docs/engineering/`, `docs/kb/`.

### Feature folder convention

Inside `docs/delivery/features/{feature}/`:

- `spec.md` or `{feature}-spec.md` — technical specification (use `FEATURE-SPEC-TEMPLATE.md` as base)
- `tasks.md` or `{feature}-tasks.md` — implementation tasks
- `prompts.md` or `{feature}-prompts.md` — AI prompts used in feature
- `prd.md` — feature-level PRD (lives in delivery, not discovery, because it is a technical breakdown)

**IMPORTANT:** Every new spec MUST include "Section 0: Job Context" — traceability to Core Jobs from the AJTBD Job Graph. Template: `docs/delivery/features/FEATURE-SPEC-TEMPLATE.md`

### Discovery vs Delivery boundary

- Discovery = defines WHAT to build and WHY (Jobs, segments, value props, UX principles, PRDs)
- Delivery = defines HOW to build it (specs, tasks, architecture, code patterns)
- Top-level PRDs (product vision, AJTBD-derived) → `docs/discovery/product/prd/`
- Feature-level PRDs (technical breakdown for implementation) → `docs/delivery/features/{feature}/`

### Canonical read order for tutor tasks

Agents working on tutor features must read discovery docs first:

1. `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
2. `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
3. `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md`
4. `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
5. `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
6. `docs/discovery/product/tutor-ai-agents/18-pilot-execution-playbook-sokrat.md`
7. Then the relevant feature folder in `docs/delivery/features/`

### Agent guardrails

- Do not reference or create files in old paths (`docs/product/specs/`, `docs/features/specs/`, etc.)
- When writing a new spec, always place it in the correct feature folder under `docs/delivery/features/`
- When writing a new PRD or research doc, place it in `docs/discovery/`
