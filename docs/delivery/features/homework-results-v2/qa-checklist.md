# QA Checklist — Homework Results v2 (AC-11)

Цель: ручной QA-прогон по Validation/Risks из `spec.md` и кросс-браузерным правилам (`.claude/rules/80-cross-browser.md`).

## Chrome Desktop

- [ ] `CH-01` Heatmap `26 × 10` (задачи × ученики) корректно рендерится, цвета/ячейки читаемы, layout не ломается.
Прошёл/issue link: `___`

- [ ] `CH-02` Для heatmap работает горизонтальный скролл при переполнении.
Прошёл/issue link: `___`

- [ ] `CH-03` Drill-down по ученику открывается по клику, одновременно раскрыт только один ученик.
Прошёл/issue link: `___`

- [ ] `CH-04` Клик по мини-карточке задачи меняет `selectedTaskId`; `GuidedThreadViewer` ремаунтится и сбрасывает внутренний scroll/filter state.
Прошёл/issue link: `___`

- [ ] `CH-05` `EditScoreDialog`: открыть, ввести валидный score `0..max` (шаг `0.5`), сохранить, увидеть обновление клетки в heatmap.
Прошёл/issue link: `___`

- [ ] `CH-06` `RemindStudentDialog` (Telegram): открывается с preset, текст редактируемый, отправка проходит.
Прошёл/issue link: `___`

- [ ] `CH-07` `RemindStudentDialog` email-fallback: при отсутствии Telegram доступен email-канал; при отсутствии обоих каналов действие disabled с корректным сообщением.
Прошёл/issue link: `___`

## Safari macOS 15+

- [ ] `SF-01` Формы в Results v2 (input/textarea/select) имеют `font-size >= 16px`.
Прошёл/issue link: `___`

- [ ] `SF-02` Heatmap корректно скроллится по горизонтали; sticky-элементы не теряют позиционирование.
Прошёл/issue link: `___`

## iOS Safari (iPhone SE, 375px)

- [ ] `IOS-01` На ширине `375px` heatmap доступен через горизонтальный скролл, контент не обрезается.
Прошёл/issue link: `___`

- [ ] `IOS-02` При фокусе на поля формы нет auto-zoom (ввод остаётся стабильным).
Прошёл/issue link: `___`

- [ ] `IOS-03` В интерактивных областях применён `touch-action: manipulation`; тапы срабатывают без задержки.
Прошёл/issue link: `___`

## Cross-Tab Consistency

- [ ] `XT-01` Сценарий `Detail -> Results -> Detail`: данные в обоих экранах консистентны, React Query cache keys не stale.
Прошёл/issue link: `___`

## Telemetry Sanity

- [ ] `TM-01` В `window.dataLayer` появляется `results_v2_opened` без PII.
Прошёл/issue link: `___`

- [ ] `TM-02` В `window.dataLayer` появляется `drill_down_expanded` без PII.
Прошёл/issue link: `___`

- [ ] `TM-03` В `window.dataLayer` появляется `manual_score_override_saved` без PII.
Прошёл/issue link: `___`

- [ ] `TM-04` В `window.dataLayer` появляется `telegram_reminder_sent_from_results` без PII.
Прошёл/issue link: `___`

- [ ] `TM-05` Payload telemetry не содержит `task_text`, `ai_feedback`, email, ФИО или другие персональные данные.
Прошёл/issue link: `___`

## Backfill Smoke (Phase 1)

- [ ] `BF-01` Количество строк в `homework_tutor_task_states` до/после backfill совпадает.
Прошёл/issue link: `___`

- [ ] `BF-02` Для всех `completed` записей `ai_score IS NOT NULL`.
Прошёл/issue link: `___`

## AC-11 Final Gate

- [ ] `AC11-01` Quality gate пройден: `npm run lint && npm run build && npm run smoke-check` (Windows + Chrome) и Safari/iOS smoke без layout breaks.
Прошёл/issue link: `___`
