# Mock Exams v1 — source artifacts

Workspace folder для подготовки seed-файла `supabase/seed/mock_exams_variant_1.sql`. Содержит intermediate artifacts от парсинга `.docx` Егора + raw images + checklists для Vladimir.

## Workflow (TASK-2)

```
Тр_вариант 1.docx (Егор)                                     not in repo (IP)
    │
    │ scripts/parse-mock-exam-docx.py
    ▼
variant1_parsed.json (raw paragraphs/tables/images)         not in repo (large)
    │
    │ scripts/structure-mock-exam.py
    ▼
variant1-tasks.json + variant1-review.md  ◄────── Егор review here
    │
    │ scripts/build-mock-exam-seed.py
    ▼
supabase/seed/mock_exams_variant_1.sql                    ◄── Vladimir commit here
```

Дополнительно:
- `raw-images/` — 20 извлечённых кандидатов из docx; после content review в Storage нужны только 13 task-рисунков (Vladimir конвертирует WMF/EMF→PNG и заливает их в Storage)
- `storage-upload-checklist.md` — пошаговая инструкция Vladimir'у для Storage uploads

## Файлы в этой папке

| Файл | Назначение | Когда обновлять |
|---|---|---|
| `variant1-review.md` | Markdown для Егора с 26 задачами + ответами + решениями | После повторного парсинга docx |
| `variant1-tasks.json` | Машинно-читаемый intermediate (источник для seed) | После Егоровых правок |
| `storage-upload-checklist.md` | Инструкция Vladimir'у для Storage uploads | При смене путей/имён файлов |
| `raw-images/` | 20 PNG/WMF/EMF/JPEG кандидатов из docx; upload whitelist — 13 файлов в checklist | При смене варианта |

## Регенерация seed.sql после правок Егора

Если Егор находит ошибки в review.md и Vladimir правит `variant1-tasks.json`:

```bash
python scripts/build-mock-exam-seed.py \
  docs/delivery/features/mock-exams-v1/source/variant1-tasks.json \
  supabase/seed/mock_exams_variant_1.sql
```

UUIDs в seed детерминированные (uuid5 от стабильного namespace) → re-running на том же tasks.json даёт идентичный seed. Egor может прислать список правок («kim 12 — заменить таё-таё на ...») — Vladimir правит `variant1-tasks.json` точечно, регенерирует seed, коммитит. Без полного re-парсинга docx.

## Полный re-parse из docx (если Егор пришлёт новый файл)

```bash
# 1. Распаковать новую docx (это zip)
unzip "<path-to-new-docx>" -d /tmp/variant_extracted

# 2. Парсить XML
python scripts/parse-mock-exam-docx.py /tmp/variant_extracted /tmp/parsed.json

# 3. Структурировать
python scripts/structure-mock-exam.py /tmp/parsed.json variant1-tasks.json variant1-review.md

# 4. Сгенерировать seed
python scripts/build-mock-exam-seed.py variant1-tasks.json ../../../supabase/seed/mock_exams_variant_1.sql
```

## Известные ограничения парсинга

1. **OMML/WMF math (Word-формулы) → текст:** исходный парсер вытягивает text-runs и `<m:t>` кусками, а часть формул приходит как отдельные WMF-картинки. После Codex review 2026-05-07 LaTeX вручную дописан в `variant1-tasks.json` для KIM 1, 12, 14, 16, 17, 21–26. При полном re-parse эти ручные правки нужно перенести заново.

2. **Layout anomaly tasks 4 и 7:** в docx маркер kim-номера стоял ПОСЛЕ тела задачи (Егор видимо использовал колоночный layout). Structurer патчит автоматически (`_layout_anomaly_fixed: true` в tasks.json), но **визуально проверить** перед коммитом.

3. **Изображения:** structurer мапит images по их позиции в paragraph stream. Для anomaly tasks (4, 7) и для соседей — image binding может быть неточным. `_review_images: true` помечен у соседей.

4. **WMF/EMF не рендерятся в браузере:** 11 из 13 upload-файлов — Microsoft Metafile, не показываются `<img>`. Конвертация в PNG обязательна перед upload (см. `storage-upload-checklist.md`). Inline-формулы (`image5`, `image12`, `image13`, `image14`, `image23`, `image24`) и warning icon `image25` не загружаются как task images.

5. **Score totals:** после сверки с критериями docx используется `total_max_score=45, part1_max=28, part2_max=17`. Часть 2: KIM 21=3, 22=2, 23=2, 24=3, 25=3, 26=4.

6. **`created_by` в variant insert:** placeholder `(SELECT id FROM auth.users ORDER BY created_at LIMIT 1)`. Vladimir заменит на UUID Егора перед merge (см. checklist §4).

## Что НЕ в репо

- Оригинальный `Тр_вариант 1.docx` — IP Егора, у Vladimir на ноутбуке. Если нужно регенерить: путь в `C:\Users\kamch\Downloads\Telegram Desktop\Тр_вариант 1.docx`.
- `variant1_parsed.json` — raw парсинг, ~32KB, легко регенерится.
- `variant1_extracted/` — unzipped docx, ~5MB, в `/tmp`.
