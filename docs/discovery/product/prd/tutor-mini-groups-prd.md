# Tutor Mini-Groups PRD (MVP-first, no-regression)

Last updated: 2026-02-23  
Status: Proposed (MVP-first)

Architectural guardrails:

- `docs/engineering/architecture/modules.json`
- `docs/engineering/architecture/high-risk-zones.md`

## Implementation strategy chosen for MVP

Для MVP выбран безопасный путь без изменения edge contracts и публичных API: "мини-группа" моделируется как набор обычных `tutor_lessons` (по одному на ученика), а в расписании показывается как одна агрегированная групповая плашка. Это сохраняет текущую платежную и backend-логику (персональные оплаты, существующие callbacks, существующие homework endpoints) и минимизирует риск регрессий.

## 1) Problem / JTBD

### Что хотят репетиторы мини-групп (JTBD)

1. Видеть в расписании одну плашку занятия группы вместо 2-6 отдельных карточек.
2. Назначать ДЗ группе одним действием, без ручного повторения на каждого ученика.
3. Вести оплату отдельно по каждому ученику в рамках группового занятия.

### Почему текущий UX неудобен

1. Одно групповое занятие визуально раздроблено на несколько карточек "по ученику".
2. Batch-операции по урокам группы (перенос/отмена/завершение) требуют повторения действий.
3. Контекст группы (название, состав, статус по участникам) не является единицей интерфейса.

### Сценарии "быстрого" репетитора

1. "Лиза + Соня ЕГЭ база, среда 18:00": создать/перенести/закрыть как одно действие.
2. "Группа 11 класс ЕГЭ 2": быстро открыть состав, увидеть частичные статусы, добить хвосты.
3. "ДЗ на группу после урока": выбрать группу и отправить одним действием, при необходимости включить A/B/C.

## 2) Product Goals / Non-goals

### Goals MVP

1. Быстрый time-to-market с минимальными изменениями архитектуры.
2. Нулевая деградация текущих single-student сценариев.
3. Сохранение стабильности платежного и homework backend контрактов.
4. WOW UX на уровне интерфейса расписания и оркестрации действий, без рискованной backend-перестройки.

### Non-goals MVP

1. First-class schema для групп (`tutor_groups`, `group_sessions`) в БД.
2. Изменение Telegram/payment callback contracts.
3. Изменение edge API (`homework-api`, payment/telegram functions).
4. Миграции или breaking changes в текущей модели уроков/оплат.

## 3) Scope: MVP vs WOW

| Scope | Что входит | Что не входит |
|---|---|---|
| MVP | UI aggregation групповой плашки в расписании; batch-create обычных уроков для мини-группы; group actions батчем; групповое ДЗ через `student_ids[]`; MVP A/B/C как UI orchestration | Новый backend контракт групп; schema migrations; изменение telegram/payment callbacks |
| WOW phase | First-class группы/сессии в data model; backend orchestration для group reminders/payments/homework variants | Ломка обратной совместимости |
| Отложено | Автоматические smart-рекомендации составов/вариантов; cross-group analytics; group chat contracts | Любые high-risk изменения без owner sign-off |

Фиксация решения:

1. MVP использует `UI aggregation + batch обычных уроков`.
2. WOW может вводить first-class `tutor_groups` и group sessions отдельной волной.

## 4) As-is / Constraints from audit

### Краткое summary текущей архитектуры

1. Расписание и уроки: `tutor_lessons` содержит один `tutor_student_id` и один `student_id`; UI работает с одной карточкой на один урок.
2. ДЗ: уже есть массовое назначение через `POST /assignments/:id/assign` с `student_ids[]`.
3. Оплаты: `tutor_payments` связаны с `tutor_student_id`, при завершении урока используется `complete_lesson_and_create_payment(_lesson_id, ...)`.
4. Telegram payment callbacks и напоминания работают от одного `lesson_id`.

### Почему MVP без изменения edge contracts

1. Текущий backend уже покрывает ключевые потребности (массовое ДЗ, per-student оплаты).
2. Изменение edge contracts затрагивает high-risk зоны и повышает вероятность регрессий.
3. UI-first агрегация решает основную UX-боль без слома инфраструктуры.

### Технические ограничения/риски

1. "Один урок = один ученик" зашито в схему, RPC, callbacks, payments.
2. Group marker в `notes` уязвим к ручному редактированию.
3. Batch-операции без транзакции могут давать partial success и требуют корректного UX отчета.
4. Нагрузка weekly view может вырасти из-за клиентской агрегации.

### High-risk модули для этой фичи (из `modules.json`)

1. `tutor-domain` - расписание, создание уроков, batch-операции, UI кабинета репетитора.
2. `domain-data-layer` - вызовы существующих RPC/REST контрактов без изменений API.
3. `frontend-shell-routing` - затрагивается только при добавлении новых entry points (в MVP не требуется).
4. `supabase-edge-business-apis` и `supabase-edge-telegram-runtime` - в MVP intentionally untouched, но high-risk в WOW-фазе.

## 5) UX/UI Spec (MVP-first)

Подробные пошаговые user flows и state-машины: `docs/product/tutor-mini-groups-user-flows.md`

## A. Экран "Расписание репетитора"

### Цель

Показывать групповое занятие как одну плашку при сохранении текущих одиночных карточек.

### Ключевые состояния

1. `single`: урок без group marker, рендер как сейчас.
2. `group-aggregated`: 2+ уроков с одним marker и одним timeslot, рендер одной плашкой.
3. `group-partial-status`: внутри группы смешанные статусы (booked/completed/cancelled).
4. `group-action-pending`: выполняется батч-операция.
5. `group-action-partial-failed`: часть участников обновилась, часть нет.

### Happy path

1. Пользователь видит "Группа 11 класс ЕГЭ 2 · 3 ученика" как одну плашку.
2. Открывает drawer/modal группы.
3. Выполняет быстрое действие (перенос/отмена/завершение).
4. Видит summary успеха по участникам.

### Edge/Error states

1. Только 1 урок в marker-группе: fallback в single-card.
2. Неконсистентный marker: плашка с warning-бейджем "Проверить группу".
3. Partial failure: детальный список `успешно/ошибка` по ученикам + "retry failed".

### Performance/UX notes

1. Агрегация должна работать в `useMemo` на уже загруженном `lessons`.
2. Никаких дополнительных сетевых запросов на рендер weekly grid.
3. Для 100+ lesson rows не допускать заметной деградации scroll/drag.

## B. Экран "Создание/редактирование занятия"

### Цель

Добавить mini-group flow без ломки существующего single-student flow.

### Ключевые состояния

1. `single-create` (как сейчас).
2. `group-create` (режим мультивыбора учеников).
3. `group-create-partial-failed`.

### Happy path (group create)

1. В Add Lesson пользователь включает "Мини-группа".
2. Выбирает 2+ учеников, дату/время/длительность/тип/предмет.
3. Указывает `group name` (или оставляет auto-name fallback).
4. Система создает N обычных уроков батчем и связывает marker.

### Naming

1. Пользовательское имя группы: основной label.
2. Fallback auto-name: `"Лиза + Соня"` или `"Лиза + 2"` при 3+ участниках.

### Совместимость с single flow

1. Режим по умолчанию остается single.
2. Все текущие поля и поведение single урока не меняются.

## C. Экран "ДЗ"

### Цель

Назначать ДЗ группе одним действием, переиспользуя текущие endpoints.

### Ключевые состояния

1. `same-for-all`: один assignment + текущий `student_ids[]`.
2. `a-b-c-beta`: UI создает 2-3 assignments и распределяет учеников.
3. `assign-partial-failed`: детальный отчет по вариантам/ученикам.

### Happy path

1. Выбор группы.
2. Выбор режима:
   - "Одинаковое всем"
   - "A/B/C (beta)"
3. Подтверждение.
4. Показ summary: сколько назначено, сколько уведомлено, где ошибка.

### MVP A/B/C orchestration (без edge changes)

1. UI создает variant assignments через текущий `POST /assignments`.
2. UI распределяет учеников детерминированно по вариантам.
3. UI вызывает текущий `/assign` и `/notify` по каждому варианту.
4. В PRD пометка: beta/experimental до накопления telemetry.

### Что beta/experimental

1. A/B/C распределение.
2. Авто-генерация вариаций контента (в MVP не backend-driven).

## D. Экран "Оплаты"

### Цель

Сохранить текущую per-student оплату внутри группового занятия.

### Ключевые состояния

1. Group-level summary в drawer: список участников и их payment status.
2. Individual controls на участника: `pending/paid/overdue`.
3. Group complete action: массовое завершение с индивидуальным результатом.

### Что не меняем в MVP

1. Не меняем `complete_lesson_and_create_payment` контракт.
2. Не меняем callback format `payment:*:lesson_id`.
3. Не меняем логику хранения `tutor_payments` (привязка к `tutor_student_id` + `lesson_id`).

## 6) MVP Data/Orchestration Design (no migrations)

### MVP модель

1. Group = набор обычных `tutor_lessons`.
2. Связь уроков группы задается служебным marker в `notes`.

### Формат marker (MVP)

Первая строка `notes`:

```text
[MG:v1|gid=<uuid>|name=<group_name>]
```

Далее пустая строка и пользовательские заметки:

```text
[MG:v1|gid=5d8f6c44-2c6a-4f2c-9f5b-2e42a6af3d8b|name=Группа 11 класс ЕГЭ 2]

<user_notes_free_text>
```

### Совместимость с user notes

1. User notes сохраняются после служебного заголовка, без потери контента.
2. Если служебная строка удалена вручную, урок просто перестает агрегироваться как group (graceful fallback).
3. Редактирование заметок в single-режиме не блокируется.

### Алгоритмы (псевдологика)

#### Read-only grouping в расписании

1. Берем weekly `lessons`.
2. Для каждого урока пытаемся распарсить marker из первой строки `notes`.
3. Если marker есть, ключ агрегации: `(gid, start_at, duration_min)`.
4. Если в ключе >=2 уроков: рендерим одну group-card.
5. Если 1 урок: рендерим обычную single-card.

#### Batch-create мини-группы

1. Пользователь выбирает 2+ учеников.
2. Генерируется `gid` и marker.
3. Для каждого ученика создается обычный урок с одинаковым timeslot + marker в `notes`.
4. Используется `allSettled` + лимит параллелизма.
5. Если успехов <2: попытка compensating cleanup, затем явная ошибка.

#### Group actions батчем

1. Находим lessons-участники по ключу группы.
2. Применяем действие на каждый урок:
   - перенос: `updateLesson`
   - отмена: `cancelLesson`
   - завершение: `completeLessonAndCreatePayment`
3. Формируем итог: `success_count`, `failed_count`, список ошибок.

#### Partial failure handling

1. Не откатываем удачные операции по умолчанию.
2. Показываем подробный отчет по участникам.
3. Даем action `Retry failed`.

### Риски marker-подхода и mitigation

| Риск | Последствие | Mitigation до WOW |
|---|---|---|
| Ручное повреждение marker | Потеря агрегации | Graceful fallback + warning badge |
| Частичный batch fail | Неконсистентная группа | Partial-result UX + retry failed |
| Сложность парсинга notes | Хрупкий parsing | Строгий префикс первой строки + v1 формат |
| Рост client processing | Лаги weekly view | memoization + без лишних запросов |

## 7) Edge Cases

1. Ученик состоит в нескольких группах: допускается, ключ сессии = `(gid, time)`.
2. На занятии не весь состав: доступно частичное завершение по участникам.
3. Одному ученику нужна корректировка ДЗ: разрешен индивидуальный override assignment поверх группового.
4. Разная стоимость/схема оплаты: расчет и статус по каждому ученику отдельно.
5. Пропуск без оплаты/со списанием: индивидуальный статус участника в рамках group session.
6. Перенос группы: batch move; при partial fail — отдельный retry.
7. Архивирование/распад группы: удаление marker у будущих уроков или прекращение batch-связки.
8. Переименование группы: обновление `name` в marker для выбранных будущих уроков без потери истории.
9. Конфликт marker/ручного редактирования notes: fallback to single + warning.

## 8) Acceptance Criteria (MVP)

| ID | Критерий | Как проверить |
|---|---|---|
| AC-1 | 2+ урока с одинаковым group marker и timeslot отображаются одной плашкой | UI schedule manual test |
| AC-2 | Single-student flow не меняется | Regression test create/edit single lesson |
| AC-3 | Group batch actions применяются ко всем участникам и показывают partial result | Simulated partial error in update/complete |
| AC-4 | Per-student payment flow сохраняется | Проверка создания/обновления `tutor_payments` по участникам |
| AC-5 | Group homework назначается через существующий endpoint `student_ids[]` | API/network trace |
| AC-6 | A/B/C orchestration детерминированна | Повторный запуск с теми же входами дает то же распределение |
| AC-7 | Weekly-view performance не деградирует заметно при 100+ lesson rows | Compare render/interaction before vs after |

## 9) PR Plan (маленькими PR)

### Sequence и зависимости

1. PR-M1 -> PR-M2 -> PR-M3 -> PR-M4 -> PR-M5
2. PR-W1 -> PR-W2 -> PR-W3 -> PR-W4 (только после стабилизации MVP и telemetry)

| PR | Scope | Modules | risk_level | validation_commands | Что нельзя менять |
|---|---|---|---|---|---|
| PR-M1 | Read-only group aggregation UI в расписании | `tutor-domain` | high | `npm run build`, `npm run smoke-check`, `npm run typecheck` | Не менять `supabase/functions/**`, `supabase/migrations/**`, guard логику |
| PR-M2 | Group create UX (мультивыбор + batch-create обычных уроков) | `tutor-domain`, `domain-data-layer` | high | `npm run build`, `npm run smoke-check`, `npm run typecheck`, `npm run test` | Без изменений public contracts |
| PR-M3 | Group actions: move/cancel/complete батчем + partial-result UX | `tutor-domain`, `domain-data-layer` | high | `npm run build`, `npm run smoke-check`, `npm run typecheck`, `npm run test` | Не менять payment callbacks и RPC контракт |
| PR-M4 | Group homework + A/B/C UI orchestration (beta) через текущие endpoints | `tutor-domain`, `domain-data-layer` | high | `npm run build`, `npm run smoke-check`, `npm run typecheck`, `npm run test` | Не менять `homework-api` contract |
| PR-M5 | Perf hardening + UX polishing + docs updates | `tutor-domain`, `documentation-and-agent-policy` | medium | `npm run build`, `npm run smoke-check`, `npm run typecheck` | Не делать массовый рефактор |
| PR-W1 | First-class schema groups/members/sessions (additive) | `database-migrations`, `domain-data-layer` | high | `npm run build`, `npm run typecheck` | Не ломать backward compatibility |
| PR-W2 | Data-layer + schedule migration path на first-class groups | `tutor-domain`, `domain-data-layer` | high | `npm run build`, `npm run smoke-check`, `npm run typecheck`, `npm run test` | Без удаления MVP fallback |
| PR-W3 | Backend homework variants distribution | `supabase-edge-business-apis`, `tutor-domain`, `domain-data-layer` | high | `npm run build`, `npm run smoke-check`, `npm run typecheck` | Без breaking изменений в существующих endpoints |
| PR-W4 | Group-aware reminders/payments + Telegram evolution | `supabase-edge-telegram-runtime`, `supabase-edge-business-apis`, `tutor-domain` | high | `npm run build`, `npm run smoke-check`, `npm run typecheck` | Не менять callback contracts без owner sign-off |

## 10) Metrics / Success signals

### Product metrics

1. Доля уроков, созданных в group mode.
2. Median time to create group session (от открытия диалога до успеха).
3. Доля group actions, завершенных за одно действие (без ручного дожима).

### UX metrics

1. Среднее число кликов для "создать группу" vs baseline.
2. Частота использования group-card vs single-cards для групповых занятий.
3. A/B/C adoption и completion rate.

### Early-warning регрессии

1. Ошибки batch actions в расписании (move/cancel/complete fail rate).
2. Latency UI-операций в weekly view (рендер/drag/drop).
3. Ошибки payment completion и notify flows после включения group UX.

### Qualitative feedback plan

1. 5-10 активных репетиторов мини-групп, 2 недели бета-наблюдения.
2. Шаблон интервью: понятность group card, скорость операций, доверие к partial result UX.

## 11) Decision Log / Assumptions

1. MVP оставляет модель "1 lesson = 1 student" без изменений.
2. Группа в MVP существует на уровне UI + orchestration, а не как first-class schema.
3. Для связывания в MVP используется marker в `notes` (v1 формат).
4. Для ДЗ переиспользуются существующие endpoints (`/assign`, `/notify`).
5. A/B/C в MVP реализуется как deterministic UI orchestration (round-robin по стабильной сортировке student_id).
6. Без изменений edge contracts и Telegram/payment callback formats в MVP.

### Требует owner sign-off в WOW

1. Введение first-class групповой схемы.
2. Любые изменения edge API и callback contracts.
3. Переход на backend-managed orchestration для reminders/payments/variants.

### Сигнал для перехода MVP -> first-class groups

1. Стабильность MVP (низкий fail rate batch actions) минимум 2 релиза.
2. Подтвержденный спрос на group lifecycle beyond marker (архив/история/advanced analytics).
3. Накопленные боли marker-подхода (support incidents/операционные ошибки) выше согласованного порога.

## 12) Out of Scope / Future Work

1. First-class `tutor_groups` / `group_sessions` schema.
2. Telegram group callbacks.
3. Backend orchestration для group reminders/payments.
4. Автоматическая генерация вариаций A/B/C на backend.
5. Кросс-групповые аналитики и advanced automation.
