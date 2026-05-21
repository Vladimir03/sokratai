# Выкатка Тренировочного варианта 2 (физика ЕГЭ-2026) — runbook

`variant_id` = **`b3d8a2f2-c831-5b85-976f-fe50ba64d393`** (uuid5, детерминирован).

Решено выкатывать **без ревью** Егора. Seed оформлен как **миграция**
(`supabase/migrations/20260521120000_seed_mock_exams_variant_2.sql`), поэтому
вставка варианта + 26 задач + `variant_pdf_url` применятся **автоматически**
при push в main (Lovable Cloud сам применяет migrations/). Ручного SQL не нужно.

Тебе остаётся 3 ручных действия: **push**, **залить файлы в Storage**, **deploy-sokratai**.

---

## Шаг 1 — Закоммитить и запушить в main

Изменённые/новые файлы:
- `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx` — Вариант 2 в каталоге + выбор варианта
- `supabase/migrations/20260521120000_seed_mock_exams_variant_2.sql` — авто-применяемый seed
- `supabase/seed/mock_exams_variant_2.sql` — исходный seed (артефакт)
- `scripts/build-mock-exam-seed.py` — параметризован по варианту
- `docs/delivery/features/mock-exams-v1/source/variant2-*.{json,md}` + `variant2/variant2-tasks.pdf`

```bash
cd C:\Users\kamch\sokratai
git add -A
git commit -m "feat(mock-exams): add Тренировочный вариант 2 (физика ЕГЭ-2026)"
git push origin main
```

После push: Lovable Cloud применит миграцию (вставит вариант + 26 задач, пропишет `variant_pdf_url`). Lovable preview (`sokratai.lovable.app`) обновит фронт автоматически.

## Шаг 2 — Залить картинки задач в Storage

Bucket **`mock-exam-variant-tasks`**, папка **`variant2/`** (создай папку). Файлы готовы в `outputs/variant2-figures/`:

`image6.png` (№1), `image8.png` (№5), `image9.png` (№9), `image10.png` (№10), `image11.jpeg` (№11), `image12.png` (№14), `image13.png` (№15), `image15.jpeg` (№19), `image17.png` (№21), `image18.png` (№22), `image20.png` (№24).

Имена должны совпадать точно — seed ссылается на `storage://mock-exam-variant-tasks/variant2/<имя>`.

## Шаг 3 — Залить PDF варианта в Storage

Bucket **`mock-exam-variant-pdfs`**, в **корень** (как `variant1-tasks.pdf`), имя файла **`variant2-tasks.pdf`**.
Файл готов: `outputs/variant2-tasks.pdf` (= `docs/.../source/variant2/variant2-tasks.pdf`).

⚠️ 14 страниц, только задачи + справочные данные. Ключ ответов и критерии вырезаны (leak-проверка пройдена). Имя/путь должны совпасть с тем, что прописала миграция: `mock-exam-variant-pdfs/variant2-tasks.pdf`.

## Шаг 4 — Деплой фронтенда на прод (КРИТИЧНО)

```
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```

Без этого Вариант 2 не появится у репетиторов на `sokratai.ru` (фронт-изменение).

## Шаг 5 — Проверка (Lovable Studio → SQL editor)

```sql
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
 WHERE variant_id = 'b3d8a2f2-c831-5b85-976f-fe50ba64d393';            -- = 26

SELECT variant_pdf_url FROM public.mock_exam_variants
 WHERE id = 'b3d8a2f2-c831-5b85-976f-fe50ba64d393';                    -- .../variant2-tasks.pdf
```

Затем зайди репетитором → «Назначить пробник» → Шаг 1 → выбери **Тренировочный 2** (бейдж «Новый») → «Посмотреть условия задач»: задачи и картинки должны грузиться, формулы рендериться. Назначь тестовому ученику, пройди Часть 1 — авточекер сверит ответы; сдай → AI делает черновик Части 2.

Доступность: вариант виден **всем** репетиторам с `tutors.feature_mock_exams_enabled = true` (отдельная активация не нужна — та же фича, что и Вариант 1).

---

### Если что-то не так
- Картинки не грузятся → проверь имена файлов в `mock-exam-variant-tasks/variant2/` (точное совпадение с таблицей Шага 2).
- PDF не открывается у ученика → проверь, что файл лежит в корне `mock-exam-variant-pdfs/` как `variant2-tasks.pdf`.
- Вариант не виден в UI → не сделан `deploy-sokratai` (Шаг 4).
- Превью пустое / «вариант не найден» → миграция не применилась; проверь Шаг 5 (COUNT = 26). Как fallback можно вручную выполнить `supabase/seed/mock_exams_variant_2.sql` в SQL editor.
