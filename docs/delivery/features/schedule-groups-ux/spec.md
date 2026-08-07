# Расписание для групповиков: цвета, тема/бейджи, серии, money-RPC (Волны 1–2)

**Статус:** реализовано 2026-08-06/07, в main (`8d0e848` → `20260806140300`). Дискавери-план: `~/.claude/plans/1-valiant-papert.md`.
**Ревью:** Codex gpt-5.6-sol; Волна 1 — 1 раунд (4×P1), Волна 2 (money) — 4 раунда до нуля P0 (7×P0 + 7×P1 суммарно найдено/закрыто) + follow-up cancel-гонки.

## Section 0: Job Context

- **Core Job:** R4 «сохранять контроль и не утопать в рутине при масштабировании» (admin-ветка, doc 14 §5/§9); бэклог P2.3 «мини-группы» (doc 15, expansion).
- **Wedge alignment: НЕ wedge** — retention/anti-churn для пилотных репетиторов-групповиков (память: 3 тяжёлых групповика из ~5–6 активных пользователей расписания; группы = 26% занятий).
- **Триггер:** репетитор с 4 мини-группами вёл расписание в Excel («4 группы — 4 цвета: глянул и понял, кто сегодня») + 7 скриншотов пожеланий.

## Волна 1 — UX/перф (без денег)

| Что | Где |
|---|---|
| Цвет группы/ученика = фон ячейки; тип занятия = полоска слева | `schedule/scheduleColors.ts` (8 пресетов, контраст ≥4.5:1 с белым), `schedule/LessonBlocks.tsx`; пикер `tutor/ColorSwatchPicker.tsx` в Create/RenameGroupModal + профиле ученика (`tutor_students.color`, миграция `20260806130000`) |
| Тема урока (`tutor_lessons.topic`) на ячейке; видна ученику | edge `student-lessons-api` whitelist (ЯВНОЕ решение владельца); у ученика — LessonFeedItem + LessonDetail |
| Бейджи «МЗ»/«ДЗ» на ячейке | `hooks/useLessonMaterialFlags.ts` — ОДИН батч по `tutor_lesson_materials` (колонки явно — column-grant) |
| Форма занятия извлечена из монолита (lazy) | `schedule/AddLessonDialog.tsx`; `StudentCombobox` (поиск, «Без ученика», «+ Новый ученик» = плейсхолдер имя+ОБЯЗАТЕЛЬНЫЙ предмет) |
| Периоды серий: день/неделя/2 недели/месяц | `lib/recurrenceDates.ts`; дефолт «до 30 июня» ОТ ДАТЫ ЗАНЯТИЯ + пресеты; daily у мини-групп отключён (per-occurrence цикл); CHECK-миграция на оба recurrence_rule |
| Занятие без учеников; QuickAddMenu по клику (и в выходной); кнопки в шапке; занятия вне рабочих часов видны | `schedule/QuickAddMenu.tsx`; динамический `visibleRange` в TutorSchedule.tsx |
| Перф | memo-блоки + DragPreviewLayer через ref; keepPreviousData + `isPlaceholderData`-гейт (чужая неделя НЕ рендерится) + префетч соседних недель (`weekRangeISO` — ключи байт-в-байт); дедуп group-memberships; батч `getLastLessonPricesForStudents`; series-count через useQuery. Чанк 125→105 КБ |

## Волна 2 — money-RPC (rule 60 §13–17)

- **Цена на серию:** `tutor_set_lesson_cost_series` / `tutor_set_participant_cost_series` (`20260806140000`) — scope `this_and_following`/`all` литеральный (`all` пересчитывает прошедшие, UI предупреждает); cancelled и occurrence с другим учеником не тронуты; статус перепроверяется АТОМАРНО под per-lesson локом (у участника — через `SELECT ... FOR UPDATE` строки занятия). «Только это» — одиночные setters (переизданы: advisory-lock ДО row-UPDATE).
- **Перенос:** `tutor_move_lesson` (`20260806140100`) — единственный путь смены `start_at` И money-полей (длительность/ученик; `student_id` выводит СЕРВЕР). past→future реверсит debit ЯВНО (`_apply` будущее НЕ реверсит), past→past reverse+apply при смене `occurred_on`; состав перечитывается ПОД локами → `LEDGER_CONFLICT` при конкурентной мутации. Триггер `trg_tutor_lessons_guard_start_move`: прямой UPDATE прошедшего-с-debit ИЛИ в-прошлое → `MOVE_VIA_RPC` (GUC `app.lesson_move`).
- **Порядок локов ВЕЗДЕ: advisory (lesson, student ASC) → row** (`20260806140200`: cron + completion переизданы; completion итерирует ЗАЛОЧЕННЫЙ снапшот состава).
- **Cancel-гонка закрыта** (`20260806140300`): `tutor_cancel_lesson_with_charge` re-read ученика под локом → `LEDGER_CONFLICT`.
- Фронт: 3-way диалоги цены; drag прошедших booked через RPC + `invalidateBalanceCaches`; прошедший серийный якорь → только «Только это»; series-shift в прошлое запрещён на всех поверхностях + `all` клампится к now; «Внести оплату» → существующий TopupDialog. Маппер ошибок — `lib/lessonMoneyErrors.ts` (без зависимостей).

## Отложено (решения владельца / бэклог)

Абонемент со счётчиком (PRD Phase 3 — по явному запросу пилотов; кнопка ведёт на topup) · телеметрия расписания (событий 0 — мелкий PR) · мобильный день-вид и touch-drag · вид «месяц» · resize за край · lazy-извлечение LessonDetails/GroupDetails.

## Деплой

Порядок: применить миграции `20260806130000` + `2026080614*` через Lovable → задеплоить edge `student-lessons-api` (он SELECT'ит `topic`; edge раньше миграции = 500 у ученика) → probe `curl -X OPTIONS` → regen types.ts → `deploy-sokratai`.
