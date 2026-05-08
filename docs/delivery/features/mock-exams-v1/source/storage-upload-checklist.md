# Storage upload checklist — Тренировочный вариант 1 (mock-exams-v1 TASK-2)

Этот файл — пошаговая инструкция для Vladimir по загрузке ассетов в Lovable Cloud Studio. Делается **один раз** перед merge seed.sql.

---

## 1. Bucket creation (one-time)

Buckets создаются автоматически миграцией `supabase/migrations/20260508120100_mock_exams_storage_buckets.sql` при первом push в main. После применения проверь в Lovable Cloud Studio → Storage:

- ✅ `mock-exam-variant-tasks` (private) — картинки задач варианта (TASK-2)
- ✅ `mock-exam-blanks` (private) — фото заполненного бланка от ученика (TASK-12)
- ✅ `mock-exam-part2-photos` (private) — фото решений Части 2 от ученика (TASK-12)
- ✅ `mock-exam-blank-templates` (public) — PDF templates бланка ФИПИ для скачивания

Если buckets отсутствуют после deploy миграции — Lovable Cloud Studio UI → Storage → Create bucket вручную с теми же id и `public` флагом.

---

## 2. Upload PDF бланка ЕГЭ (один файл)

**Source:** `C:\Users\kamch\Downloads\Telegram Desktop\Бланк_заполнения_ЕГЭ-2025__4j4x5.pdf`

**Target:** bucket `mock-exam-blank-templates`, path `ege-physics-2025.pdf`

Bucket public-read, поэтому ссылка вида `https://<project>.supabase.co/storage/v1/object/public/mock-exam-blank-templates/ege-physics-2025.pdf` будет работать без auth.

После загрузки сохрани этот URL — он понадобится в `StudentMockExam.tsx` (TASK-12) для кнопки «Скачать бланк».

---

## 3. Upload task images (13 файлов)

**Source:** `docs/delivery/features/mock-exams-v1/source/raw-images/` (извлечённые кандидаты; загружать только файлы из таблицы ниже)

**Target:** bucket `mock-exam-variant-tasks`, folder `variant1/`

### Конвертация WMF/EMF → PNG (КРИТИЧНО)

Браузеры **не рендерят** Windows Metafile форматы (`.wmf`, `.emf`). Перед загрузкой 11 из 13 файлов нужно конвертировать в PNG:

| Способ | Инструмент | Команда |
|---|---|---|
| Локально (рекомендую) | LibreOffice | `soffice --headless --convert-to png raw-images/*.wmf raw-images/*.emf` |
| Локально | ImageMagick | `magick mogrify -format png raw-images/*.wmf raw-images/*.emf` |
| Online | https://cloudconvert.com/wmf-to-png | drag-and-drop, скачать обратно |

Сохрани целевое имя `imageN.png` (без `.wmf`/`.emf` суффикса) — seed.sql ожидает именно такие имена.

**Качество:** при конвертации проверь что графики/диаграммы читаемы (text labels, axis values). При плохом качестве — увеличь DPI до 300 или сделай скриншот из Word и обрежь.

### Список всех 13 файлов

| # | KIM | Source filename | Upload as | Действие |
|---|---|---|---|---|
| 1 | 1 | `image6.emf` | `image6.png` | конвертировать |
| 2 | 5 | `image7.emf` | `image7.png` | конвертировать |
| 3 | 7 | `image8.png` | `image8.png` | как есть |
| 4 | 9 | `image9.emf` | `image9.png` | конвертировать |
| 5 | 11 | `image10.emf` | `image10.png` | конвертировать |
| 6 | 13 | `image11.emf` | `image11.png` | конвертировать |
| 7 | 19 | `image15.png` | `image15.png` | как есть |
| 8 | 20 | `image16.emf` | `image16.png` | конвертировать |
| 9 | 20 | `image17.emf` | `image17.png` | конвертировать |
| 10 | 20 | `image18.emf` | `image18.png` | конвертировать |
| 11 | 20 | `image19.emf` | `image19.png` | конвертировать |
| 12 | 20 | `image20.emf` | `image20.png` | конвертировать |
| 13 | 21 | `image22.emf` | `image22.png` | конвертировать |

### Верификация

После всех uploads — Lovable Studio → Storage → `mock-exam-variant-tasks` → folder `variant1/`. Должно быть **13 PNG-файлов** + 0 WMF/EMF.

```sql
-- В Lovable Studio SQL editor:
SELECT name FROM storage.objects WHERE bucket_id = 'mock-exam-variant-tasks' AND name LIKE 'variant1/%' ORDER BY name;
-- Expected: 13 rows
```

---

## 4. Поправить `created_by` в seed.sql

Перед коммитом seed.sql:

```sql
-- В seed/mock_exams_variant_1.sql строка ~50:
--   (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
-- Заменить на UUID Егора:
--   '<egor-auth-user-uuid>'::uuid
```

Найти UUID Егора:
```sql
SELECT id, email FROM auth.users WHERE email LIKE '%egor%' OR email = '<known-egor-email>';
```

Если у Егора ещё нет аккаунта в проде — оставить fallback `(SELECT id FROM auth.users ORDER BY created_at LIMIT 1)` и обновить через миграцию `mock_exam_variants_set_created_by_egor.sql` после регистрации.

---

## 5. Включить feature flag для Егора

После apply seed.sql, через Lovable Studio SQL editor:

```sql
UPDATE public.tutors SET feature_mock_exams_enabled = true
WHERE user_id = '<egor-auth-user-uuid>';
```

После 3-4 часов QA без багов — повторить для остальных 3 пилотных tutors (см. spec §3.5 «Per-tutor feature flag»).

---

## 6. Smoke validation (post-apply)

```sql
-- AC-3 acceptance: 26 tasks
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131';
-- Expected: 26

-- All Part 1 answers populated
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131'
  AND part = 1
  AND correct_answer IS NOT NULL;
-- Expected: 20

-- All Part 2 solutions populated
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131'
  AND part = 2
  AND solution_text IS NOT NULL;
-- Expected: 6

-- check_mode distribution
SELECT check_mode, COUNT(*)
FROM public.mock_exam_variant_tasks
WHERE variant_id = '36cebc45-e2e8-5603-a753-01c818bba131'
GROUP BY check_mode
ORDER BY check_mode;
-- Expected:
--   manual:       6  (KIM 21-26)
--   multi_choice: 4  (KIM 5, 9, 14, 18)
--   ordered:      4  (KIM 6, 10, 15, 17)
--   pair:         1  (KIM 19)
--   strict:       10 (KIM 1-4, 7-8, 11-13, 16)
--   task20:       1  (KIM 20)
```
