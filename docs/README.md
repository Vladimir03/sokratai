# Документация SokratAI

## Структура

```
docs/
├── discovery/           — ЧТО и ПОЧЕМУ строим
│   ├── methodology/     — Методология AJTBD (Замесин), AURA, сегментации
│   ├── research/        — Исследования Сократа (артефакты 01–10, job-graphs, конкуренты)
│   ├── product/         — PRD, tutor-ai-agents (10–20), KB дизайн
│   └── prototypes/      — HTML-прототипы
│
├── delivery/            — КАК строим
│   ├── features/        — Спеки по фичам (spec + tasks + prompts)
│   └── engineering/     — Архитектура, auth, БД, Telegram, codebase overview
│
└── misc/                — Разное (rag-bot-setup)
```

## Discovery — ключевые документы

- **Методология AJTBD**: `discovery/methodology/01-ajtbd-core-concepts-zamesin.md`
- **Исследование рынка (01–10)**: `discovery/research/`
- **Wedge Decision**: `discovery/research/08-wedge-decision-memo-sokrat.md`
- **PRD продукта**: `discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
- **UX-принципы**: `discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
- **UI-паттерны**: `discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`

## Delivery — по фичам

- **Guided Chat**: `delivery/features/guided-chat/`
- **Homework Builder**: `delivery/features/homework-builder/`
- **Knowledge Base**: `delivery/features/kb/`
- **Notifications**: `delivery/features/homework-notifications/`
- **Phase 0 Onboarding**: `delivery/features/phase0-onboarding/`
- **Student Hints**: `delivery/features/student-hints/`

## Engineering

- **Codebase overview**: `delivery/engineering/overview/codebase.md`
- **Architecture**: `delivery/engineering/architecture/README.md`
- **Database**: `delivery/engineering/database/`
- **Telegram**: `delivery/engineering/telegram/`
