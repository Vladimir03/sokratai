---
name: fipi-task-loader
description: Массово импортирует задачи из открытого банка ФИПИ (fipi.ru) в Банк задач Сократа (kb_tasks) — в «Черновики для Сократа» репетитора-модератора на ревью. Use whenever Vladimir says "спарси ФИПИ / загрузи задачи ФИПИ", "добавь ОГЭ/ЕГЭ физика стр. N в Сократа", "давай ещё страниц из банка ФИПИ", или даёт ссылку на open-bank fipi (oge.fipi.ru / ege.fipi.ru /bank/). Walks a parse → solve → preview-gate → upload-images → insert-via-MCP → verify pipeline с обязательным превью-гейтом владельцу перед записью в прод. Эталон — пилот 10 задач ОГЭ физика стр.1 (2026-07-21), см. scripts/fipi-import/ + memory project_fipi_oge_import_2026_07_21.md. Канон конвейера — .claude/rules/50-kb-module.md «Массовый импорт задач из ФИПИ».
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, mcp__Claude_Browser__navigate, mcp__Claude_Browser__javascript_tool, mcp__Claude_Browser__get_page_text, mcp__Claude_Browser__preview_start, mcp__7cd7c182-a7ed-4b05-a7e7-52910eaba397__query_database, Artifact, AskUserQuestion
---

# FIPI Task Loader

Импортирует задачи из открытого банка ФИПИ в `kb_tasks` Сократа под модерацию. Первая Job репетитора по ДЗ — поиск задач; наполняем Банк готовым выверенным контентом. Проверено пилотом (10 задач ОГЭ физика, стр. 1, 2026-07-21). Все инварианты — в **`.claude/rules/50-kb-module.md` → «Массовый импорт задач из ФИПИ»** (читать первым) + rule 40 (kb_tasks поля/write-path) + rule 80 (Safari/MathText).

## Три стоп-поинта (нельзя пропускать)

1. **STOP 1 — согласование объёма и назначения** (перед парсингом): какой проект/предмет/страницы, к какому модератору (owner_id), в какую папку-черновик, решать ли задачи самому. Если неоднозначно — `AskUserQuestion`.
2. **STOP 2 — превью-гейт** (перед записью в прод): собрать HTML-превью ВСЕХ задач (условие + картинки + ответ + решение + классификация) через Artifact, показать владельцу. Записывать в БД ТОЛЬКО после явного «ок». Это защита от неверных ответов (ФИПИ их не отдаёт — решаем сами).
3. **STOP 3 — загрузка картинок владельцем** (перед вставкой задач): скрипт `upload-images.mjs` запускает ВЛАДЕЛЕЦ под своим логином (пароль агенту не передаётся). Агент ждёт `refs.json`, затем подставляет ссылки.

## Pipeline

### Шаг 1 — Разведка + STOP 1
- Открыть URL банка (`preview_start`). Задания в same-origin iframe `#questions_container` (грузится из `/bank/questions.php?proj=<GUID>`, кодировка windows-1251).
- Определить: `proj` GUID из URL; предмет; страницы (по 10 заданий, всего ~151 на банк).
- Проверить в БД (`query_database`, project `5fbe4a32-1baf-47b0-8f47-83e3060cf929`): owner_id модератора по email, id папки «Черновики для Сократа» (⚠ live-имя с заглавной «С»), живые темы каталога (`kb_topics` exam+subject), наличие source «ФИПИ» в `kb_sources`.
  - Егор (физика): owner `a7212758-8cdd-4d7c-8608-4fedcb34d74c`, черновики `59f40091-c338-4c45-ab92-8f77d8ee6ff9`. Другой предмет/модератор → найти по email (rule 50 онбординг: обе роли tutor+moderator).
- **STOP 1:** подтвердить объём/назначение/решать-ли-ответы.

### Шаг 2 — Парсинг
- Через `javascript_tool` в iframe извлечь по каждому `div.qblock#q{ID}`: `input[name=guid]`, ФИПИ-номер и КЭС (из соседа `div#i{ID}` «Свойства задания»), `.hint` (тип ответа), полный текст условия, варианты (radio-опции / select-опции соответствия / список слов), URL всех `<img>`, MathML.
- Картинки скачать `curl` c UA `Mozilla/5.0...` + Referer `oge.fipi.ru/bank/index.php?proj=<GUID>` в `scripts/fipi-import/out/images/p{N}/{ФИПИномер}.{ext}`. Прочитать их (Read) — они нужны для решения задач.

### Шаг 3 — Трансформация + решение (качество-first)
Для каждой задачи собрать объект в `scripts/fipi-import/out/page{N}.json`:
- `text` — чистый текст + `$...$` LaTeX (MathML/формулы-gif транскрибировать руками, сверяясь с рендером). Варианты включить нумерованным списком в текст. Мелкие формульные gif НЕ в attachment — только содержательные рисунки (схемы/графики).
- **Решить задачу:** `answer` (краткий — число / строка цифр для соответствия-выбора; несколько допустимых → «X или Y», rule 40); `solution` = краткое решение + финальная строка `⚠ Проверить модератору. Источник: ФИПИ, задание {ФИПИномер}, КЭС {код}`.
- Классификация: `exam` ('oge'/'ege'); `kim_number` только где однозначно по спецификации, иначе NULL; `primary_score` из `src/lib/kbKimScores.ts` (`getKimPrimaryScoreForSubject`, physics-only) при известном КИМ, иначе 1; **`check_format` ЯВНО** (`inferCheckFormatFromKim` знает лишь ЕГЭ 21–26 → для ОГЭ развёрнутых ставить `detailed_solution`+`task_kind='extended'`+черновик `rubric_text` руками); `answer_format='число'` только числовым; `topic_id` — маппинг КЭС-раздела на живую тему каталога, иначе NULL (folder_id покрывает CHECK); `subtopic_id` NULL; `source_label='ФИПИ'`.

### Шаг 4 — Превью-гейт (STOP 2)
- Билдер `scratchpad/build-preview.mjs` → HTML из `page{N}.json` (условие с картинками data-URI, ответ, решение, чипы классификации). Задачи-«соответствия» → `preview_table` (настоящая `<table>` в превью; в task_text остаётся структурный текст, т.к. MathText таблицы не рендерит — rule 80).
- Опубликовать `Artifact` (private), дать владельцу. **Ждать «ок».** Правки — итерировать.

### Шаг 5 — Картинки (STOP 3)
- `scripts/fipi-import/upload-images.mjs` (готов; supabase-js, hardcoded `api.sokratai.ru`, anon key из `src/lib/supabaseClient.ts`, интерактивный ввод email+пароль скрыто). Загружает в `kb-attachments/{uid}/fipi-oge/p{N}/` (политика: первый сегмент = uid; читается любым authenticated).
- **Запускает ВЛАДЕЛЕЦ.** Дать чёткую пошаговую инструкцию (PowerShell в корне репо → `node scripts/fipi-import/upload-images.mjs`). Ждать содержимое `out/refs.json`.
- Если владелец на OAuth без пароля — `signInWithPassword` не сработает; предложить иной путь (service_role / другой аккаунт с паролем).

### Шаг 6 — Вставка + верификация
- Генератор `scratchpad/gen-insert.mjs` → `scripts/fipi-import/out/page{N}-insert.sql`: подпапка (детерминированный uuidv5, `ON CONFLICT DO NOTHING`) + N `INSERT INTO kb_tasks` (id = `uuidv5(NS_DNS, 'sokratai.fipi-oge.'+GUID)`, `owner_id`=модератор, `attachment_url` из refs, `fingerprint` НЕ передавать, экранировать `'`→`''`; LaTeX бэкслеши безопасны при `standard_conforming_strings=on`).
- Исполнить через `query_database`.
- Верификация SQL: SELECT задач папки (kim/answer/check_format/score/topic/has_img/mod), + кросс-джойн `attachment_url` ↔ `storage.objects` (0 битых).

### Шаг 7 — Финализация
- Обновить memory `project_fipi_oge_import_*` (id папки, диапазон, уроки).
- Handoff-сообщение модератору (что проверить — ответы!; как довести; перенос в «сократ» → авто-публикация в Каталог).
- Предложить следующие страницы.

## Жёсткие правила

- **НИКОГДА** не писать в прод до STOP 2 (превью одобрено).
- **НИКОГДА** не запрашивать/вводить пароль владельца — только он запускает upload-скрипт.
- **НИКОГДА** не публиковать в Каталог напрямую — только в черновики модератора; публикацию делает модератор (перенос в «сократ»).
- Вставка — через MCP `query_database`, **НЕ миграция** (rule 50 обоснование).
- `fingerprint` при INSERT в черновики — NULL (вычислится при публикации).
- `check_format`/`kim_number` для ОГЭ — явно (эвристика знает только ЕГЭ 21–26).
- Ответы решаю сам + пометка модератору (ФИПИ правильных ответов не отдаёт).
- Коммит: `scripts/fipi-import/` + доки; **НЕ** картинки/refs.json (`.gitignore`); перед коммитом `git checkout -- supabase/functions/mcp/index.ts` (готча dev-сервера).

## Известные follow-ups
- Спецификация/структура предмета (номера, темы, баллы) — сверять с ФИПИ демо перед проставлением kim_number/score. Для ОГЭ физики структура на ревью (2026-07-21).
- ОГЭ-подтемы (`kb_subtopics`) — сейчас нет; завести через `kb_mod_create_subtopic` при нужде.
- Рендер таблиц в карточках задач (MathText) — отдельная фронт-доработка (соответствия сейчас текстом).
