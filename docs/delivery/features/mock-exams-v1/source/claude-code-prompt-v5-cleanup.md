# Промпт для Claude Code — доработки после выкатки Тренировочного варианта 5

Скопируй блок ниже в Claude Code и пусти. Я (Cowork-Claude) сделал основную работу за 30 минут: собрал V5 (mix V4+V2+V1 + скриншот Егора), вставил полное решение задачи 25 (D = 40 см), убрал кнопку «По критериям ФИПИ», обновил миграцию. Это — то, что я не смог завершить из песочницы.

---

## Промпт

```
Ты работаешь в репозитории C:\Users\kamch\sokratai. Прочти сначала AGENTS.md, CLAUDE.md и .claude/rules/45-mock-exams.md — там контекст про пробники.

Контекст: Cowork-Claude собрал Тренировочный вариант 5 (variant_id = 03660fb4-5247-5376-a0e9-2eb5faae844e), миграция supabase/migrations/20260606120000_seed_mock_exams_variant_5.sql уже создана и должна примениться при push. Часть 1 авто-проверяется по ФИПИ 2026 partial credit (кнопка ручного пересчёта удалена из src/pages/tutor/mock-exams/TutorMockExamReview.tsx). Vladimir уже залил картинки в Storage и сделал deploy-sokratai.

Сделай 4 задачи:

──────────────────────────────────────────────────────────
ЗАДАЧА 1 — Удалить мёртвый код после удаления кнопки «По критериям ФИПИ»
──────────────────────────────────────────────────────────

В src/pages/tutor/mock-exams/TutorMockExamReview.tsx я заменил две кнопки на комментарии (грепни «2026-06-06: кнопка „По критериям ФИПИ" убрана»), но связанный state и handlers остались как мёртвый код. Почисти:

(a) Найди компонент Part1BlankReviewPanel (≈стр.300+) и компонент Part1SummaryCard (≈стр.1212):
   • убери useState confirmRecheckOpen + setConfirmRecheckOpen
   • убери useState isRechecking + setIsRechecking
   • убери handleRecheckPart1 useCallback / function
   • убери импорт recheckMockExamPart1 (если больше не используется)
   • убери AlertDialog с заголовком «Пересчитать Часть 1 по критериям ФИПИ?» (он триггерился через confirmRecheckOpen)

(b) Грепни imports: RotateCcw — если его использовали ТОЛЬКО для кнопок «По критериям ФИПИ», убери и его. Если ещё где-то используется (OCR retry button) — оставь.

(c) recheckMockExamPart1 в src/lib/mockExamApi.ts — оставь экспорт (может пригодиться через SQL / dev tools), но добавь JSDoc-комментарий «UI больше не дёргает — auto на сабмите, 2026-06-06».

После — npm run lint, npm run build, npm run smoke-check (все должны быть зелёные). Если build падает на TypeScript-warning на unused — окончательно дочисти.

──────────────────────────────────────────────────────────
ЗАДАЧА 2 — (опционально) Добавить картинки решения Егора к задаче 25
──────────────────────────────────────────────────────────

Егор прислал в чат Cowork 2 скриншота с разбором задачи 25 (рассеивающая линза + диафрагма). Они НЕ сохранились в репо — они инлайн в чате. Vladimir должен сохранить их вручную и положить в:
   docs/delivery/features/mock-exams-v1/source/variant5/task25_solution_1.png
   docs/delivery/features/mock-exams-v1/source/variant5/task25_solution_2.png

ЕСЛИ эти два файла появились в репо:

(a) Спроси Vladimir, нужно ли заливать их в Storage (bucket mock-exam-variant-tasks, папка variant5/, имена task25_solution_1.png / task25_solution_2.png).

(b) После заливки — обнови docs/delivery/features/mock-exams-v1/source/variant5-tasks.json: к задаче "25" добавь поле:
   "solution_image_urls": ["storage://mock-exam-variant-tasks/variant5/task25_solution_1.png", "storage://mock-exam-variant-tasks/variant5/task25_solution_2.png"]

(c) build-mock-exam-seed.py сейчас НЕ сериализует solution_image_urls (только task_image_url для условия). Расширь скрипт: 
   • в build_sql() в INSERT-блоке Part 2 добавь колонку solution_image_urls после solution_text;
   • используй существующий serialize_task_image_url() (он dual-format совместим — single ref или JSON array);
   • убедись, что mock_exam_variant_tasks схема имеет колонку solution_image_urls TEXT NULL (она есть, проверено в .claude/rules/45-mock-exams.md).

(d) Перегенерируй seed и миграцию:
   python3 scripts/build-mock-exam-seed.py docs/delivery/features/mock-exams-v1/source/variant5-tasks.json supabase/seed/mock_exams_variant_5.sql 5
   
   Затем обнови миграцию supabase/migrations/20260606120000_seed_mock_exams_variant_5.sql (она = header + cat seed). Поскольку прошлая миграция уже применена с ON CONFLICT DO NOTHING, для добавления solution_image_urls создай НОВУЮ миграцию supabase/migrations/<YYYYMMDDHHMMSS>_update_variant5_task25_solution_images.sql с просто:
   
   UPDATE public.mock_exam_variant_tasks
   SET solution_image_urls = '["storage://mock-exam-variant-tasks/variant5/task25_solution_1.png","storage://mock-exam-variant-tasks/variant5/task25_solution_2.png"]'
   WHERE id = '788566ee-b291-5643-af38-b2e5dc857e5e';

──────────────────────────────────────────────────────────
ЗАДАЧА 3 — Проверить рендеринг картинок в Part 2 эталонах
──────────────────────────────────────────────────────────

Vladimir вчера дорабатывал баг с отображением solution_image_urls в эталонных решениях Части 2 — у V5 этого поля сейчас нет вообще (только solution_text с LaTeX). Сделай аудит:

(a) Грепни какой компонент рендерит solution_text/solution_image_urls в результате после approve:
    grep -rn "solution_image_urls\|solution_text" src/components/student/ src/pages/student/ src/pages/tutor/mock-exams/

(b) Найди компонент Part2SolutionReveal (или аналог) и убедись:
    • он использует parseAttachmentUrls() из @/lib/attachmentRefs (dual-format ref);
    • резолвит storage:// в signed URL через getMockExamSolutionImageUrl (или аналог);
    • рендерит MathText на solution_text и <img> на каждый разрешённый URL;
    • есть click-to-zoom на картинках.

(c) Если что-то из этого не работает — почини. Покажи Vladimir сводку.

──────────────────────────────────────────────────────────
ЗАДАЧА 4 — Обновить .claude/rules/45-mock-exams.md
──────────────────────────────────────────────────────────

Добавь в раздел «Mock Exams» в .claude/rules/45-mock-exams.md короткую заметку:

> **2026-06-06 — Тренировочный вариант 5 (физика ЕГЭ-2026).**
> variant_id = 03660fb4-5247-5376-a0e9-2eb5faae844e. Микс задач из вариантов 1, 2, 4 + №25 из присланного скриншота (рассеивающая линза, D=40 см). Без variant_pdf_url (form-режим только). Картинки в `storage://mock-exam-variant-tasks/variant5/`.
> 
> Ручная кнопка «По критериям ФИПИ» в `TutorMockExamReview.tsx` УБРАНА — Часть 1 авто-проверяется по ФИПИ 2026 partial credit на сабмите (mock-exam-student-api::handleSubmitAttempt). Не возрождать кнопку — это плохой UX.

──────────────────────────────────────────────────────────

После всего: 🚀 Deploy needed — напомни Vladimir сделать deploy-sokratai после push.
```

---

## Что Cowork-Claude уже сделал (для контекста)

- `variant5-tasks.json` — 26 задач с LaTeX-формулами и решениями.
- `supabase/seed/mock_exams_variant_5.sql` + `supabase/migrations/20260606120000_seed_mock_exams_variant_5.sql` — авто-применятся при push.
- 12 картинок задач в `docs/delivery/features/mock-exams-v1/source/variant5/`.
- Frontend: `VARIANT_LIBRARY` в `TutorMockExamCreate.tsx` теперь содержит V5 (бейдж «Новый»).
- Убрана кнопка «По критериям ФИПИ» (2 места) в `TutorMockExamReview.tsx` — state/handlers пока остались (мёртвый код для Claude Code очистить).
- `storage-upload-checklist-v5.md` — runbook для Vladimir.
- Решение задачи 25 с полным выводом D=40 см вшито в `solution_text`.
