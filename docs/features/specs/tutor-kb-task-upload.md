# Feature Spec: Tutor KB Task Upload

**Status:** implemented through Phase 3B (2026-03-14)  
**Job:** P1.2 — Сохранить результат в свою базу и переиспользовать позже  
**Supports:** P0.1 — Собрать ДЗ по теме после урока, P0.2 — Нарастить новую практику по теме  
**Latest hardening commit:** `b6cd865` `fix(kb): harden multi-image task attachment flow`

---

## Problem

Репетитор часто получает полезную задачу не в виде готового текста, а как:

- скриншот из Telegram / PDF;
- фото задания из тетради или сборника;
- 2-5 изображений одной задачи (несколько страниц, рисунок + условие, условие + график).

Если задача не попадает в личную Базу знаний быстро, она теряется в заметках, папках и чатах и не участвует в reuse внутри ДЗ и практики.

---

## Product intent

Цель фичи — ускорить путь:

`скриншот / фото задачи -> Моя база -> reuse в ДЗ / практике`

Это **не** OCR-first и не AI-first feature.  
Это input + storage + reuse feature внутри уже существующего flow создания своей задачи.

---

## Scope

## Phase 2A — single-image attachment

- прикрепление одного изображения к своей задаче в `CreateTaskModal` и `EditTaskModal`
- preview + remove
- изображение может заменить текст задачи
- upload в Supabase Storage через `storage://` ref

## Phase 3A — faster input

- paste image from clipboard в textarea
- drag & drop изображения в modal content area
- reuse existing upload / validation path

## Phase 3B — multi-image attachments

- до `5` изображений на одну задачу
- multi-select через file input
- multi-drop
- preview grid
- per-image remove
- helper text `до 5 изображений`
- `aria-label` на remove buttons
- freeze controls while saving
- orphan upload cleanup при failed upload / save

---

## Explicitly out of scope

- OCR / AI parsing
- generic upload wizard
- PDF attachments for KB tasks
- multi-image support в student homework runtime
- reorder / primary image selection

---

## UX contract

## Create / Edit

- Репетитор создаёт или редактирует задачу в уже существующем modal flow.
- Текст остаётся primary field.
- Если есть хотя бы одно изображение, текст может быть пустым.
- Форма должна оставаться понятной без нового экрана и без wizard.

## Attachment block

- Допустимы только изображения: JPG, PNG, GIF, WebP
- Максимум `5` изображений
- Максимум `10 MB` на файл
- Channels:
  - file picker
  - paste from clipboard
  - drag & drop

## States

- idle
- uploading / saving
- preview ready
- remove image
- validation error
- upload error with cleanup

Во время `saving` attachment controls frozen.

---

## Data contract

Поле БД остаётся прежним:

- `kb_tasks.attachment_url TEXT | NULL`

Serialization contract:

- no images -> `NULL`
- single image -> `storage://kb-attachments/...`
- multiple images -> JSON array string  
  example: `["storage://kb-attachments/...","storage://kb-attachments/..."]`

Helpers:

- `parseAttachmentUrls()`
- `serializeAttachmentUrls()`

Их нужно использовать во всех новых consumers этого поля.

---

## Downstream contract today

## KB surfaces

- `TaskCard` в KB показывает image icon
- если изображений больше одного, показывает count
- в expanded state отображается gallery всех attachment images

## Homework surfaces

Текущий homework flow остаётся **single-image**:

- в `TutorHomeworkCreate` в `kb_attachment_url` попадает только первое изображение KB-задачи
- в `HWDrawer` в `task_image_url` уходит только первое изображение
- count badge в drawer показывает, что у KB-задачи attachment images больше одного

Если репетитор добавляет multi-image задачу в ДЗ из KB-страниц, UI должен предупредить, что в ДЗ сейчас используется только первое изображение.

Это сознательный current limitation до отдельной фазы homework multi-image support.

---

## Architecture rules

- не создавать вторую upload/storage систему
- reuse `kbApi.ts` helpers для validation / upload / signed URL / delete
- не менять schema `kb_tasks`
- не расширять scope в OCR / AI parsing

---

## Future phase

Следующая отдельная фаза, если pilot подтвердит спрос:

- multi-image support в Homework / student runtime
- явная semantics для primary image
- reorder внутри KB attachment list

До этого order attachment images не должен становиться скрытым продуктовым контрактом.
