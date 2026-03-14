
Цель: убрать расхождение UI между Claude Code dev и Lovable preview (включая KB) и зафиксировать правило, чтобы это не повторялось.

1) Что уже выяснено (root cause)
- В коде `TutorAssistant.tsx` уже стоит `animate={false}` и `md:grid-cols-3`, то есть текущий исходник выглядит корректно.
- В логах preview есть: `Service Worker: Registered successfully ...lovableproject.com`.
- Это ключевой сигнал: в preview регистрируется SW и может отдавать устаревшие ассеты/стили, поэтому вы видите «старый» UI (и проблема повторяется на разных страницах, включая KB).

2) Куда лучше внести правило
- Лучшее место: `CLAUDE.md` (раздел критических правил), потому что этот файл обязателен к чтению перед любыми изменениями (`00-read-first.md`).
- Дополнительно: короткий дубль в `.claude/rules/10-safe-change-policy.md` как чек перед правками UI (быстрый guardrail).

3) План исправления (код + процесс)
- `src/registerServiceWorker.ts`
  - Сделать строгий allowlist для SW (только реальный прод-домен), а preview/dev домены (`localhost`, `*.lovableproject.com`, `*.lovable.app`, `*preview*`) всегда считать non-prod.
  - В non-prod не просто “skip registration”, а принудительно выполнять unregister старых SW + очистку Cache Storage, чтобы убрать накопленный stale UI.
- Проверить/подправить «структурные» responsive-классы в tutor/KB:
  - Правило: для desktop-first layout использовать `md:*` для переключения колонок/рядов; `sm:*` — только для типографики/spacing.
  - Точечно аудитнуть `src/pages/tutor/knowledge/*` на `sm:grid-cols-*` / `sm:flex-row` и привести к `md:*` там, где это влияет на структуру.
- Для карточек в сетках:
  - Правило: если используется `ui/Card` внутри grid/list в tutor-экранах, по умолчанию `animate={false}` (входные анимации только осознанно и после проверки parity).

4) Как зафиксировать правило в документации
- В `CLAUDE.md` добавить новый блок “Preview parity (critical)”:
  - SW не должен работать в preview/dev.
  - Structural breakpoints для tutor/KB: `md+`.
  - `Card` в grid/list: `animate={false}` по умолчанию.
  - После UI-правок обязательная проверка в preview на desktop/mobile.
- В `.claude/rules/10-safe-change-policy.md` добавить короткий checklist-пункт:
  - “После правок layout: проверить parity dev vs preview, убедиться что SW не кэширует stale bundle.”

5) Проверка после внедрения
- Открыть `/tutor/assistant` и `/tutor/knowledge` в preview на desktop и mobile.
- В консоли убедиться, что SW в preview не регистрируется (или был удалён).
- Сделать hard refresh и подтвердить, что UI совпадает с dev.
- Прогнать `npm run build` + `npm run smoke-check`.

Технические детали (кратко)
- Текущая проблема — не только breakpoint/анимации, а прежде всего runtime-кэширование через Service Worker в preview-домене.
- Документ-источник правила: `CLAUDE.md` (максимальный охват для будущих правок), с дублированием короткого guard в `.claude/rules/10-safe-change-policy.md`.
