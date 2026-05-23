# Runbook — добавление нового варианта пробника ЕГЭ

Канонический пошаговый процесс от **docx Егора** → задеплоенный вариант в Сократе. Тестировался на вариантах 1 (2026-05-08) и 2 (2026-05-21). Использовать для вариантов 3, 4, ... и последующих.

**Sequence:** docx → tasks.json → seed migration → render images → upload Storage → frontend catalog → deploy.

Не пропускать шаги — каждый шаг защищает от типичных bugs (visible learned from pilots Егора).

---

## Шаг 0 — Предусловия

- ✅ Docx от Егора лежит в `docs/delivery/features/mock-exams-v1/source/Тр_вариант N.docx` (или подобный путь).
- ✅ Python 3.10+ доступен (для парсинга docx через `python-docx`/`mammoth`/pypdf — см. scripts).
- ✅ PowerShell 5.1+ (Windows встроенный — для рендера EMF через .NET GDI+).
- ✅ Git push настроен, Lovable Cloud auto-deploy работает.
- ✅ SSH доступ на VPS Selectel (`root@185.161.65.182`) — для финального `deploy-sokratai`.

---

## Шаг 1 — Парсинг docx в `tasks.json`

```bash
# Сгенерирует raw parsed.json для последующей обработки
python scripts/parse-mock-exam-docx.py \
  "docs/delivery/features/mock-exams-v1/source/Тр_вариант N.docx" \
  > /tmp/variant-N-parsed.json

# Затем вручную / через cowork нужно переработать в финальный
# variant<N>-tasks.json (исходный pipeline).
```

Альтернативный путь — **Claude Cowork** (что использовалось для вариантов 1/2):
- Скормить docx + variant template → получить tasks.json.
- ВНИМАНИЕ: Cowork может неправильно экстрактить vector графики из EMF — финальный image set рендерь через **Шаг 4** (этот runbook), не через Cowork's output.

**Файл:** `docs/delivery/features/mock-exams-v1/source/variant<N>-tasks.json`.

**Validate JSON:** `cat variantN-tasks.json | python -m json.tool > /dev/null` (silent → OK).

Hard invariants для tasks.json (см. CLAUDE.md §11 + `variant1-tasks.json` как reference):
- 26 задач (KIM 1-20 Часть 1 + KIM 21-26 Часть 2)
- Маркеры опций (`1)`, `2)`, ...) формат `1) текст` (без `**1)`, без `<b>1)`)
- Markdown-таблицы — стандарт GFM с пайпами `| col | col |` + `|---|---|`
- LaTeX через `$ ... $` (inline) / `$$ ... $$` (block)
- `check_mode` per KIM (см. _CHECK_MODE_BY_KIM в `scripts/build-mock-exam-seed.py`)
- `correct_answer` для Часть 1 — строкой («225», «2,70,1»)
- `solution_text` для Часть 2 — multi-step разбор от Егора

---

## Шаг 2 — Регенерация seed.sql

```bash
python scripts/build-mock-exam-seed.py \
  "docs/delivery/features/mock-exams-v1/source/variantN-tasks.json" \
  "supabase/seed/mock_exams_variant_N.sql"
```

Скрипт генерирует:
- 1 INSERT в `mock_exam_variants` (вариант)
- 26 INSERTов в `mock_exam_variant_tasks` (задачи)
- UPDATE для `variant_pdf_url` в конце
- Все UUID детерминированы через uuid5 (повторный запуск = identical SQL)

**Hard invariants** (см. CLAUDE.md §11):
- `created_by` = Egor's UUID (`a7212758-8cdd-4d7c-8608-4fedcb34d74c`) — захардкожено в скрипте
- НЕ модифицировать seed.sql вручную — правь tasks.json и пересобирай
- `mock_exam_variant_tasks` НЕ имеет колонки `updated_at` — не добавлять её в INSERT

---

## Шаг 3 — Обернуть seed в migration (для auto-apply)

Skopируй seed как миграцию чтобы Lovable Cloud auto-applied:

```bash
cp supabase/seed/mock_exams_variant_N.sql \
   supabase/migrations/$(date +%Y%m%d%H%M%S)_seed_mock_exams_variant_N.sql
```

Префикс файла с актуальным timestamp (выше последнего в `supabase/migrations/`).

**Проверь** что миграция:
- ✅ Обёрнута в `BEGIN; ... COMMIT;`
- ✅ Все INSERT'ы используют `ON CONFLICT (id) DO NOTHING` (idempotent)
- ✅ В конце есть UPDATE для `variant_pdf_url`

Lovable Cloud применит автоматически при `git push main`. **Не нужен** manual SQL.

---

## Шаг 4 — Рендер картинок задач (КРИТИЧНО — Cowork делает это плохо)

Docx содержит математические рисунки как **EMF** (Enhanced Metafile) — это вектор от Microsoft. Браузеры их НЕ рендерят. Cowork ранее экстрактил EMF без vector strokes (только grid background), результат — пустые картинки.

**Canonical:** используй `scripts/render-variant-images.ps1`:

```powershell
pwsh scripts/render-variant-images.ps1 `
  -DocxPath "docs/delivery/features/mock-exams-v1/source/Тр_вариант N.docx" `
  -OutDir   "docs/delivery/features/mock-exams-v1/source/variantN"
```

Скрипт:
- Распакует docx (zip с XML + media)
- Найдёт все EMF/WMF в `word/media/`
- Отрендерит каждый через .NET GDI+ (native Windows EMF support)
- Применит 4x scale + HighQuality antialiasing
- Сохранит в `variantN/imageM.png` (basename из docx)

**Не требует** LibreOffice / ImageMagick / pdf2image. Только PowerShell + Windows GDI+.

**Опции:**
- `-OnlyNames "image6,image8,image10"` — выборочный рендер (например, для replace конкретных файлов после обнаружения багов)
- `-Scale 6` — увеличить разрешение (по умолчанию 4)

**После рендера обязательно visual review:**

```bash
# Открой каждый файл в просмотрщике, убедись что:
# - графики видны (НЕ только grid)
# - подписи осей / меток присутствуют
# - кривые / стрелки на месте
```

Если у конкретного PNG только grid (без линий) → исходный EMF битый в docx, нужно запросить у Егора заменить.

---

## Шаг 5 — Slice PDF варианта (anti-leak)

Оригинальный docx содержит на последних страницах «Систему оценивания» — answer table + критерии. Это **leak** для ученика. Slice до страниц только с задачами.

```bash
python scripts/slice-variant-pdf.py \
  "docs/delivery/features/mock-exams-v1/source/variantN/variantN-tasks.pdf"
```

По умолчанию режет до 13 страниц (для вариантов 1/2). Если структура docx другая — открой PDF и определи последнюю страницу БЕЗ ответов/критериев → передай через `-Pages N`.

**Visual review:** открой sliced PDF, найди последнюю страницу — должна быть Часть 2 KIM 26 (или справочные данные), НЕ «Правильные ответы» / «Система оценивания».

---

## Шаг 6 — Frontend каталог

Добавь новый вариант в hardcoded VARIANT_LIBRARY в `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx`:

```ts
const VARIANT_LIBRARY = [
  { id: '36cebc45-...', title: 'Тренировочный 1 (физика ЕГЭ-2026)', ... },
  { id: 'b3d8a2f2-...', title: 'Тренировочный 2 (физика ЕГЭ-2026)', ... },
  {
    // uuid5 namespace 00000000-0000-0000-0000-000000005ec0,
    // key "mock-exam-variant-N-egor-physics-2026"
    id: '<UUID-сгенерированный-build-mock-exam-seed.py>',
    title: 'Тренировочный N (физика ЕГЭ-2026)',
    attribution: 'Источник: репетитор Егор Блинов',
    meta: '26 заданий · макс. 45 баллов · 3 ч 55 мин',
    isAvailable: true,
    badge: 'Новый',  // или null
  },
] as const;

// Дефолтный title пробника:
const VARIANT_DEFAULT_TITLES: Record<string, string> = {
  '36cebc45-...': 'Пробник Тренировочный 1',
  'b3d8a2f2-...': 'Пробник Тренировочный 2',
  '<UUID-3>': 'Пробник Тренировочный N',
};
```

**Где найти UUID** — в `mock_exams_variant_N.sql` строка `INSERT INTO public.mock_exam_variants (id, ...)`. Например:

```sql
'b3d8a2f2-c831-5b85-976f-fe50ba64d393'::uuid,
```

Скопируй без `::uuid`.

---

## Шаг 7 — Push в main

```bash
cd C:\Users\kamch\sokratai
git add -A
git commit -m "feat(mock-exams): add Тренировочный вариант N (физика ЕГЭ-2026)"
git push origin main
```

Запушится:
- Frontend catalog update (`TutorMockExamCreate.tsx`)
- Migration (`supabase/migrations/<timestamp>_seed_mock_exams_variant_N.sql`)
- Seed (`supabase/seed/mock_exams_variant_N.sql`) — артефакт
- 11+ image files в `docs/.../variant<N>/imageM.png`
- PDF в `docs/.../variant<N>/variant<N>-tasks.pdf`

**Lovable Cloud** автоматически:
- Применит миграцию (вставит вариант + 26 задач + variant_pdf_url) — ~1-2 минуты
- Обновит preview frontend (`sokratai.lovable.app`) — ~3-5 минут

**Verify migration applied:**

```sql
-- Lovable Studio → Database → SQL editor
SELECT id, title FROM mock_exam_variants WHERE id = '<UUID>';
-- expected: 1 row

SELECT COUNT(*) FROM mock_exam_variant_tasks WHERE variant_id = '<UUID>';
-- expected: 26
```

Если 0 rows — миграция не применилась. Apply вручную: Lovable Studio → Database → Migrations → Apply pending.

---

## Шаг 8 — Storage upload (КРИТИЧНО — manual step)

**Картинки задач:**
- Lovable Studio → Storage → bucket `mock-exam-variant-tasks` → создай папку `variantN/`
- Загрузи все PNG из `docs/.../variantN/imageM.png` (имена должны совпадать с seed refs `storage://mock-exam-variant-tasks/variantN/<name>`)

**PDF варианта:**
- Bucket `mock-exam-variant-pdfs` (public)
- Файл `variantN-tasks.pdf` в корне (как `variant1-tasks.pdf` и `variant2-tasks.pdf`)

**Не загрузил картинки → ученики видят broken images.** Не загрузил PDF → кнопка «Скачать задачи» вернёт 404.

---

## Шаг 9 — Frontend deploy на прод

```bash
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```

~3-5 минут. После deploy `sokratai.ru` обновлён.

---

## Шаг 10 — Smoke verify

Залогинься tutor'ом (e.g. Egor):

1. **Каталог** — `/tutor/mock-exams/new` → выбери Вариант N → preview-sheet раскрывается с 26 задачами.
2. **Markdown-таблицы** — пролистни до KIM 6/14/20 если они с таблицами → таблицы рендерятся (не raw markdown).
3. **Картинки** — KIM с графиками (зависит от варианта, обычно KIM 1, 5, 9, 11, ...) — картинки видны (не broken icon).
4. **PDF download** — нажми «Скачать задачи (PDF)» → файл качается, открывается, 13-14 страниц.
5. **Assignment** — назначь пробник тестовому ученику → ученик видит вариант на taking page.

Если что-то ломается — пройди checklist выше повторно.

---

## Edge cases / Troubleshooting

### A. EMF плохо рендерится (только grid без линий)

Симптом: pust картинка с подписями осей, но без кривых.

Причина: исходный EMF в docx — это **embedded picture** (OLE-объект внутри docx), не настоящий EMF.

Fix: попросить Егора вырезать график как отдельный PNG / JPEG и заменить в docx. Либо вручную создать график в graph editor.

### B. Markdown-таблица в KIM N не рендерится

Симптом: в preview сырой `| col | col |` вместо таблицы.

Причина: `MARKDOWN_TABLE_RE` regex не матчит (например, нет пустой строки перед `|---|---|`).

Fix: проверь tasks.json — таблица должна:
- Начинаться с пустой строки
- Иметь header row `| col1 | col2 |`
- Сразу следом `|---|---|` divider row
- Затем data rows
- Заканчиваться пустой строкой

### C. Numbered options без нумерации (1), 2), ...)

Симптом: варианты ответа показываются плоским текстом без «1)», «2)»...

Причина: Уже пофикшено в `MarkdownTaskText.tsx` (Round 8) — добавлены custom `ol`/`li` components с `list-decimal pl-6`. Если возникает снова — проверь не Tailwind ли preflight reset.

### D. KIM 20 в варианте использует таблицу (не схемы)

Если KIM 20 нового варианта — это табличная задача (как вариант 2), captions «Схема 1..5» не нужны и автоматически не появятся (logic `task.kim_number === 20 && imageUrls.length > 0`).

Если KIM 20 нового варианта — это 5 схем (как вариант 1), убедись что все 5 PNG отрендерены в `variantN/` и есть в seed как JSON-array в `task_image_url`.

### E. Vector graphic в docx — это WMF (Windows Metafile), не EMF

Скрипт `render-variant-images.ps1` обрабатывает И EMF, И WMF (расширение `.wmf`). .NET GDI+ нативно поддерживает оба. Если что-то странное — проверь что `vectorFiles` в скрипте найдены оба.

### F. variant 4+ — изменения в схеме `mock_exam_variants`

Если когда-нибудь понадобится колонка subject (для math/chem пробников) или другие fields:
1. Добавь миграцию `ALTER TABLE` ДО seed-миграции (timestamp newer)
2. Обнови `scripts/build-mock-exam-seed.py` чтобы emit'ил новые поля
3. Обнови frontend types в `src/types/mockExam.ts`
4. CLAUDE.md §11 / §20 — обнови инварианты

---

## Files / artifacts чек-лист

После всех шагов в репо должны быть:

```
docs/delivery/features/mock-exams-v1/source/
  Тр_вариант N.docx                              ← оригинал от Егора
  variantN-tasks.json                            ← parsed + reviewed
  variantN-review.md                             ← опционально, заметки ревью
  variantN/
    image*.png   (× 11 примерно)                 ← rendered via render-variant-images.ps1
    variantN-tasks.pdf                           ← sliced без ответов
supabase/
  migrations/<timestamp>_seed_mock_exams_variant_N.sql   ← auto-applied
  seed/mock_exams_variant_N.sql                          ← reference artifact
src/pages/tutor/mock-exams/TutorMockExamCreate.tsx       ← +VARIANT_LIBRARY entry
scripts/render-variant-images.ps1                        ← shared rendering tool
```

В Storage (manual upload):
```
mock-exam-variant-tasks/variantN/image*.png    ← 11 files
mock-exam-variant-pdfs/variantN-tasks.pdf      ← 1 file
```

---

## Время на новый вариант

Если все артефакты от Егора готовы (docx + reviewed tasks.json):
- Шаги 2, 3, 6, 7: автоматизация ~5 минут
- Шаг 4 (картинки): 1 команда + visual review ~10 минут
- Шаг 5 (PDF slice): 1 команда + visual review ~3 минуты
- Шаг 8 (Storage upload): manual ~10 минут
- Шаг 9 (deploy): ~5 минут
- Шаг 10 (verify): ~5 минут

**Итого: ~30-40 минут** на полный roll-out нового варианта при готовом docx.

Если docx ещё нужно парсить через Cowork — это дополнительные 1-2 часа.
