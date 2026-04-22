# Feature Spec: Homework Reuse v1 (Preview + Save-to-KB + Template post-factum + Groups + Share-link)

**Версия:** v0.1
**Дата:** 2026-04-22
**Автор:** Vladimir + Claude (PM session)
**Статус:** draft

---

## 0. Job Context (обязательная секция)

### Какую работу закрывает эта фича?

| Участник | Core Job | Sub-job | Ссылка на backlog |
|---|---|---|---|
| Репетитор | P1.3 — Работать из одного места, не переключаться между инструментами | Превратить разовую сборку ДЗ в переиспользуемый актив | doc 15 §5 |
| Репетитор | P1.2 — Сохранить результат в свою базу и переиспользовать позже | HW → KB bridge (сейчас отсутствует) | doc 15 §5 |
| Репетитор | P2.3 — Масштабировать себя на мини-группы без потери качества | Assign-to-group shortcut + filter-by-group | doc 15 §6 |
| Репетитор | P0.1 — Собрать ДЗ по теме после урока | Preview / PDF / Telegram-копирование «последняя миля» | doc 15 §4 |

### Wedge-связка

- **B2B-сегмент:** репетиторы физики ЕГЭ/ОГЭ с мини-группами и/или 10+ учениками
- **Score матрицы:** высокий (усиливает и wedge P0.1, и bundle-эффект через P1.2/P1.3)

### Pilot impact

Три прямые цитаты репетиторов пилота указали на этот pain (KB save, template post-factum, preview/PDF). Фича закрывает «последнюю милю» wedge-workflow: собранное ДЗ теперь становится (1) шаблоном для будущих групп, (2) пополнением персональной базы задач, (3) читаемым артефактом, который можно скопировать в Telegram или распечатать. Это единственный способ получить накопительный эффект retention — без него каждое новое ДЗ собирается с нуля.

---

## 1. Summary

Закрытие бреши в цикле работы репетитора: **собрал ДЗ → хочу капитализировать результат**. Добавляем пять связанных действий в одной фиче:

1. **Preview / PDF** — отдельный tutor-only вид `/tutor/homework/:id/preview` с длинным скроллом задач (условия + картинки + опциональные ответы/решения), с кнопками «Печать», «Копировать текст для Telegram».
2. **Share-link** — публичная read-only ссылка `/p/:slug` с конфигурируемыми флагами `show_answers` / `show_solutions`.
3. **Save tasks to KB** — действие «Сохранить задачи в мою базу» (bulk + per-task), с диалогом выбора папки каждый раз. Дедуп через существующий fingerprint.
4. **Save as Template post-factum** — действие «Сохранить как шаблон» из detail-страницы (не только из конструктора). PATCH endpoint для редактирования метаданных шаблона.
5. **Assign-to-group** — в конструкторе ДЗ на этапе «Кому» появляется вкладка `Группы`, клик группы = auto-select всех активных учеников. `homework_tutor_assignments.source_group_id` — soft FK для метаданных. На `/tutor/homework` — фильтр по группе + group badge в HWSummaryCard.

Плюс операционный cleanup: `/tutor/assistant` — пустой placeholder в SideNav — **удаляется из навигации**, route превращается в redirect на `/tutor/home` (backward compat). Вернётся в Sprint 2+ с реальными job workspace per doc 17 §4.1 (не в этой фиче).

---

## 2. Problem

### Текущее поведение

- **Save to KB:** workflow KB→HW односторонний. Задачу, введённую вручную в конструкторе ДЗ, **нельзя** сохранить в KB для будущих ДЗ. Жалоба репетитора: «Нет возможности сделать так, чтобы задачи заданные в домашке сохранить потом в свою базу?».
- **Template:** checkbox «Сохранить как шаблон» есть **только при создании ДЗ** (`HWActionBar`). После того как ДЗ отправлено и репетитор понял «это удачно» — кнопки нет, надо пересоздавать.
- **Preview:** `/tutor/homework/:id` показывает задачи в collapsible секции + HeatmapGrid учеников. Нет «читаемого» вида ДЗ целиком — 10 задач не помещаются на экране, нельзя оценить гармоничность подбора, нельзя скопировать в Telegram или распечатать.
- **Group assign:** группы как сущность (`tutor_groups`) существуют (с 2026-02-23, `mini_groups_enabled` toggle), но **не связаны с ДЗ**. Репетитор отмечает 5 учеников группы 10А чекбоксами вручную при каждом создании ДЗ.
- **`/tutor/assistant`:** пустой placeholder с 3 неактивными job cards. Занимает slot в SideNav без value.

### Боль

Репетитор вкладывает 20-30 минут в подборку ДЗ и **не может капитализировать этот труд**:
- задача, которая «зашла» ученику, не попадает в персональную базу → через месяц собирается заново с нуля
- ДЗ, удачное для группы 10А, нельзя одним кликом превратить в шаблон для 10Б → либо ручное пересоздание, либо забыли
- нельзя окинуть 10 задач взглядом для self-review «гармонично ли подобрано к уроку»
- нельзя послать родителю/коллеге копию ДЗ без развёрнутого скриншотинга
- группа создана, но при каждом ДЗ — 5 чекбоксов вручную, риск забыть ученика

Это нарушение UX-принципов doc 16:
- **Принцип 11 «Результаты переиспользуемы»** — AI/KB результаты доступны только в рамках одного ДЗ
- **Принцип 9 «Workflow first, library second»** — обрыв цепочки «собрал → сохранил → переиспользовал»
- **Принцип 17 «Экспорт и шаринг — часть workflow»** — ДЗ собрано, но нет way довести до коллеги/родителя
- **Антипаттерн #6 «База не связана с ДЗ»** — workflow односторонний

### Текущие «нанятые» решения

- **Save to KB:** копипаст задачи обратно вручную через интерфейс «Моя база» (10+ кликов)
- **Template:** пересоздание ДЗ руками для другой группы, дублируются ошибки
- **Preview / PDF:** скриншоты экрана HW Detail в чат, ручная сборка PDF в Word
- **Group:** хранение списка группы в Telegram-заметке, каждый раз сверяется
- **Share:** вставка задач в Telegram-сообщение в свободной форме, формулы теряются

---

## 3. Solution

### Описание

Все действия «капитализации результата» собираются в **Actions-меню** на `/tutor/homework/:id`. Текущие `Редактировать` / `Удалить ДЗ` расширяются до:

```
[Редактировать] [⋯ Ещё ▾] [Удалить ДЗ]
                  │
                  ├─ Открыть preview
                  ├─ Поделиться ссылкой
                  ├─ Сохранить задачи в базу
                  └─ Сохранить как шаблон
```

Preview открывается как отдельная страница (не модалка) на новом роуте, **внутри AppFrame** — там свой toolbar с export-функциями.

Save-to-KB и Save-as-template открывают контекстные диалоги. Share-link — диалог с конфигурацией, затем copy-to-clipboard.

Группы добавляются в `HWAssignSection` как альтернативная вкладка выбора учеников; `/tutor/homework` получает фильтр по группе.

### Ключевые решения

**A. Preview = route `/tutor/homework/:id/preview` (не modal)**
- Модалка ограничила бы полезную площадь и усложнила бы print-CSS. Route даёт чистый fullscreen, нативный `window.print()` и возможность bookmark/share.
- Layout: один длинный scroll. Рендер в колонке ~800px max-width. Заголовок задачи крупный (№X), условие через `MathText`, картинки `max-height: 300px` + click-to-zoom.
- Toolbar top: `[← Назад] | [Печать / PDF] [Скопировать текст] [Поделиться ссылкой] | [☐ С ответами] [☐ С решениями]`
- Print CSS: toolbar скрыт, каждая задача — `break-inside: avoid`, картинки inline, формулы через KaTeX (уже рендерятся как HTML, сохраняются в PDF через `window.print()`).
- **Tutor-only.** Student-side не затрагивается. `solution_text` в preview отображается только при `show_solutions=true` toggle (дефолт OFF), это валидно так как preview tutor-only — leak-invariant из `.claude/rules/40-homework-system.md` не нарушается.

**B. Share-link = публичный read-only роут `/p/:slug` + новая таблица `homework_share_links`**
- При создании ссылки — диалог: `☐ С ответами`, `☐ С решениями` (дефолт OFF), `☐ Истекает через 30 дней`. Сохраняются в `homework_share_links(slug, assignment_id, show_answers, show_solutions, expires_at, created_by, created_at)`. Slug — короткий base36 8 символов.
- В диалоге отдельная секция «Существующие ссылки» — список всех ссылок на текущее ДЗ с датой создания, флагами (чипы «С ответами» / «С решениями» / «Истекает 15.05»), и кнопкой 🗑️ Удалить. Несколько ссылок на одно ДЗ разрешены намеренно: одна для родителя (без ответов), другая для коллеги (с ответами), третья для пропустившего ученика с истечением 30 дней.
- `/p/:slug` — **не внутри AppFrame**, без TutorGuard, без SideNav. Минимальный layout «Сократ» + список задач (reuse Preview component с принудительными флагами).
- Edge function `GET /share/:slug` — public, no JWT, резолвит slug → подписывает картинки через service_role → возвращает JSON (условия, ответы/решения по флагам).
- Почему не `/tutor/homework/:id/public` — это снапшот: изменение ДЗ не должно автоматически менять то, что увидел родитель по отправленной ссылке. Slug живёт в своей таблице, резолвит на live-assignment но с фиксированными флагами.

**C. Save tasks to KB = диалог выбора папки каждый раз**
- Действие открывает Sheet с чекбоксами задач (default all selected — подтверждено), выпадающим списком папок `Моя база`, и полем «Создать новую папку» внизу списка. Нет хранения «last-used» в рамках этой фичи (можем добавить в Sprint 2 если окажется частым).
- Для каждой задачи: если `kb_task_id` указывает на задачу из **моей** базы → skip с меткой «✓ уже в базе». Если из каталога Сократа (`owner_id IS NULL`) → создаём копию в выбранной папке (использует существующий path «В мою папку» из KB каталога — подтверждено что уже работает).
- Новые задачи (`kb_task_id IS NULL`, т.е. введены вручную / загружены фото) → `INSERT INTO kb_tasks` с fingerprint-check. При fingerprint collision → возвращаем «✓ уже в базе: Папка X» и ссылку.
- **Поля копирования:** `task_text`, `task_image_url` (dual-format через `parseAttachmentUrls`), `correct_answer`, `solution_text`, `solution_image_urls`. **НЕ копируем** рубрику (`rubric_text`, `rubric_image_urls`) — рубрика специфична для конкретного ДЗ, не для задачи-сущности.

**D. Save as Template post-factum = independent action + PATCH endpoint**
- Действие открывает диалог: `Название шаблона` (prefill = `assignment.title` + «— шаблон»), `Теги` (prefill from subject/topic), `☐ Включить рубрику`, `☐ Включить материалы`, `☐ Включить настройки AI (disable_ai_bootstrap, check_format)`. Все включены дефолтом.
- Создаёт запись в `homework_tutor_templates` с существующим `tasks_json JSONB` snapshot. Формат снепшота расширяется: каждый task inline-snapshot получает **optional** `source_kb_task_id` — если исходно задача была из KB, сохраняем провенанс (для Sprint 2+ sync-feature «обновить шаблон из базы»). Не требует миграции — поле внутри JSONB.
- Оставляем **существующий** checkbox «Сохранить как шаблон» в `HWActionBar` при создании. Два пути — при создании (авансом) и пост-фактум — **не конфликтуют**, так как создают разные записи с разным timestamp. Продуктово основным становится post-factum (recognition over recall, Принцип 3).
- Добавляется `PATCH /templates/:id` endpoint — переименовать шаблон, обновить теги. Без него UX кривой: единственная опция сейчас — удалить и пересоздать.

**E. Assign-to-group = UX-shortcut + метаданные на ДЗ**
- `HWAssignSection` при `mini_groups_enabled=true` получает tabs-строку `[Группы] [Ученики]`. Default tab — `Группы` если у репетитора ≥1 группа, иначе `Ученики`.
- Выбор группы = autoSelect всех её активных `tutor_student_id` через `tutor_group_memberships.is_active=true`. Можно снять отдельных учеников (fallback к manual list). Можно выбрать несколько групп — объединение.
- Добавляется колонка `homework_tutor_assignments.source_group_id UUID NULL` (soft FK, без constraint — допускает удаление группы без каскада). Записывается при создании, если выбрана **ровно одна** группа и состав её учеников не модифицирован. Если две группы или ручное вмешательство — `NULL`. Эта колонка = метаданные для badge/filter, не ACL.
- `/tutor/homework` — фильтр `[Группа ▾]` рядом с `[По активности]`. HWSummaryCard показывает `Группа 10А` badge (на основе `source_group_id`).
- **Scope-ограничение:** НЕ делаем course/curriculum/lesson-plan entity. Это expansion P2.3 и отдельный эпик позже.

**F. Cleanup: убираем `/tutor/assistant` из SideNav**
- Удаляем пункт в `SideNav.tsx`. Route в `App.tsx` переводим на `<Navigate to="/tutor/home" replace />`. Telemetry: `tutor_assistant_route_hit` (понять, есть ли кто кто приходит по bookmark).
- Файл `TutorAssistant.tsx` **НЕ удаляем** — он вернётся в Sprint 2 с реальными job workspace. Пока — dead code, но zero-cost.

### Scope

**In scope:**
- `/tutor/homework/:id/preview` route + toolbar + print CSS
- `/p/:slug` public route + `homework_share_links` table + dialog
- Actions меню на `/tutor/homework/:id` с 4 новыми действиями
- Save-to-KB bulk dialog + per-task BookmarkPlus icon на HWTaskCard (только в edit-mode конструктора)
- Save-as-Template post-factum dialog + `PATCH /templates/:id`
- `HWAssignSection` tabs Группы/Ученики + `source_group_id` колонка + filter на `/tutor/homework` + badge на HWSummaryCard
- SideNav cleanup + `/tutor/assistant` redirect

**Out of scope:**
- Multi-select per-task в bulk dialog **(default all-selected подтверждено)** — т.е. multi-select есть, но без smart-suggestion «сохранить только лучшие»
- Template sync from KB source (provenance field пишется, но sync-button появится в Sprint 2+)
- Course / curriculum / lesson-plan entity
- AI-powered «Похожие задачи в недавних ДЗ» в preview (Sprint 2+)
- Cmd+K global palette
- Inline AI в HW Detail («Что покрывает это ДЗ»)
- Job workspace на `/tutor/assistant` (Sprint 2+)
- Shareable link с collaborative editing / комментариями
- PDF через headless Chrome / server-side (используем `window.print()` native)
- Share-link expire policy автоматическая очистка (оставляем cron на позже, сейчас — просто `expires_at` timestamp, frontend отсекает по нему)

---

## 4. User Stories

### Репетитор

> Когда я собрала ДЗ и отправила ученикам, и через неделю увидела что одна задача особенно хорошо сработала, я хочу одним кликом сохранить её в свою базу задач, чтобы через месяц при подготовке ДЗ для другой группы найти её за 5 секунд.

> Когда я провожу первый урок новой группы и подобрала удачное ДЗ, я хочу сохранить его как шаблон одним кликом, чтобы через год повторить то же ДЗ с другой параллелью.

> Когда я подобрала 10 задач для ДЗ, я хочу окинуть их взглядом на одной странице с крупными картинками, чтобы оценить гармоничность подбора **до** отправки и при необходимости заменить 1-2.

> Когда я отправляю ДЗ родителю как отчёт о подготовке к контрольной, я хочу получить ссылку с форматированным списком задач (без ответов), чтобы родитель открыл её в браузере и увидел профессиональный артефакт.

> Когда я создаю ДЗ для группы 10А, я хочу выбрать группу одним кликом, чтобы не отмечать 5 учеников чекбоксами и не забыть одного.

> Когда у меня в кабинете 6 групп, я хочу отфильтровать список ДЗ по группе 10А, чтобы увидеть все 5 ДЗ за месяц этой группы и оценить прогрессию тем.

### Родитель (external, consumer of share-link)

> Когда репетитор присылает ссылку на ДЗ моего ребёнка, я хочу открыть её в браузере и увидеть список задач с условиями (без ответов — чтобы ребёнок сам решал), чтобы проконтролировать объём работы без установки приложения.

### Школьник

Не применимо в этой фиче — student-side не затрагивается.

---

## 5. Technical Design

### Затрагиваемые файлы

**Frontend:**
- `src/App.tsx` — добавить route `/tutor/homework/:id/preview` внутри AppFrame; публичный route `/p/:slug` вне AppFrame; redirect `/tutor/assistant → /tutor/home`
- `src/components/tutor/chrome/SideNav.tsx` — удалить пункт «Помощник»
- `src/pages/tutor/TutorHomeworkPreview.tsx` — **новая** страница
- `src/pages/PublicHomeworkShare.tsx` — **новая** публичная страница (reuse компонентов preview)
- `src/pages/tutor/TutorHomeworkDetail.tsx` — расширение Actions-меню (4 новых пункта)
- `src/pages/tutor/TutorHomework.tsx` — filter-by-group + badge в `AssignmentCard`
- `src/components/tutor/homework-create/HWAssignSection.tsx` — tabs Группы/Ученики
- `src/components/tutor/homework-create/HWTaskCard.tsx` — iconSave-to-KB для edit-mode
- `src/components/tutor/homework-reuse/SaveTasksToKBDialog.tsx` — **новый** (bulk)
- `src/components/tutor/homework-reuse/SaveAsTemplateDialog.tsx` — **новый**
- `src/components/tutor/homework-reuse/ShareLinkDialog.tsx` — **новый**
- `src/components/tutor/homework-reuse/HomeworkPreviewContent.tsx` — **новый** shared component для `/preview` и `/p/:slug`
- `src/lib/tutorHomeworkApi.ts` — новые API функции (`saveTasksToKB`, `createTemplateFromAssignment`, `updateTemplate`, `createShareLink`)
- `src/lib/publicShareApi.ts` — **новый** (one function: `getPublicHomeworkShare(slug)`)
- `src/hooks/useTutorGroups.ts` — если нет, создать (чтение `tutor_groups` + memberships). Если есть — расширить.
- `src/styles/homework-preview-print.css` — **новый** print-specific CSS

**Backend (edge functions):**
- `supabase/functions/homework-api/index.ts` — новые handlers:
  - `handleSaveTasksToKB` (`POST /assignments/:id/save-tasks-to-kb`)
  - `handleCreateTemplateFromAssignment` (`POST /assignments/:id/save-as-template`)
  - `handleUpdateTemplate` (`PATCH /templates/:id`)
  - `handleCreateShareLink` (`POST /assignments/:id/share-links`)
- `supabase/functions/homework-api/index.ts::handleCreateAssignment` / `handleUpdateAssignment` — запись `source_group_id`
- `supabase/functions/homework-api/index.ts::handleListAssignments` — filter `?group_id=`
- `supabase/functions/public-homework-share/index.ts` — **новая** public edge function (`GET /share/:slug`), без JWT, использует `service_role`

**Миграции:**
- `supabase/migrations/20260422130000_homework_share_links.sql` — new table
- `supabase/migrations/20260422130100_homework_assignments_source_group_id.sql` — ADD COLUMN
- Без миграций: template `tasks_json` расширение — optional поле внутри JSONB, backward compatible

### Data Model

**Новая таблица `homework_share_links`:**
```sql
CREATE TABLE public.homework_share_links (
  slug             TEXT PRIMARY KEY,                      -- base36 8 chars, уникален
  assignment_id    UUID NOT NULL REFERENCES public.homework_tutor_assignments(id) ON DELETE CASCADE,
  show_answers     BOOLEAN NOT NULL DEFAULT false,
  show_solutions   BOOLEAN NOT NULL DEFAULT false,
  expires_at       TIMESTAMPTZ NULL,                      -- NULL = никогда
  created_by       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_homework_share_links_assignment ON public.homework_share_links(assignment_id);
CREATE INDEX idx_homework_share_links_created_by ON public.homework_share_links(created_by);

ALTER TABLE public.homework_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutors manage own share links"
  ON public.homework_share_links
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
-- Публичное чтение через service_role в edge function, не через RLS.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.homework_share_links TO authenticated;
```

**ADD COLUMN `homework_tutor_assignments.source_group_id`:**
```sql
ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS source_group_id UUID NULL
    REFERENCES public.tutor_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homework_assignments_source_group
  ON public.homework_tutor_assignments(source_group_id)
  WHERE source_group_id IS NOT NULL;

COMMENT ON COLUMN public.homework_tutor_assignments.source_group_id IS
  'Soft FK к tutor_groups. Записывается если ДЗ создано через assign-to-group без ручных правок списка учеников. NULL допустим. Используется для badge/filter, не для ACL.';
```

**Расширение `homework_tutor_templates.tasks_json` (без миграции):**
```typescript
interface HomeworkTemplateTask {
  task_text: string;
  task_image_url?: string | null;
  correct_answer?: string | null;
  rubric_text?: string | null;
  rubric_image_urls?: string | null;
  solution_text?: string | null;
  solution_image_urls?: string | null;
  max_score?: number;
  // NEW (optional, backward-compatible):
  source_kb_task_id?: string | null;   // провенанс для будущего sync
  check_format?: 'short_answer' | 'detailed_solution';
}
```

### API

**Новые endpoints в `homework-api`:**

| Method | Path | Body / Params | Response |
|---|---|---|---|
| POST | `/assignments/:id/save-tasks-to-kb` | `{ task_ids: string[], folder_id: string, new_folder_name?: string }` | `{ saved: {task_id, kb_task_id, already_in_base: boolean, folder_id, folder_name}[], skipped: string[] }` |
| POST | `/assignments/:id/save-as-template` | `{ title: string, tags: string[], include_rubric: boolean, include_materials: boolean, include_ai_settings: boolean }` | `HomeworkTemplate` |
| PATCH | `/templates/:id` | `{ title?: string, tags?: string[], topic?: string }` | `HomeworkTemplate` |
| POST | `/assignments/:id/share-links` | `{ show_answers: boolean, show_solutions: boolean, expires_in_days?: number }` | `{ slug, url, expires_at }` |
| GET | `/assignments?group_id=:gid` (existing endpoint, new param) | — | filtered list |

**Новая edge function `public-homework-share`:**

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/share/:slug` | **NONE** (public) | `{ title, tasks: [...], show_answers, show_solutions, expired: boolean }` |

Публичная функция:
- Использует `service_role` для чтения
- Резолвит slug → `homework_tutor_assignments` → tasks
- Подписывает картинки через `createSignedUrl` с TTL = 1 час (как в resolved task images pattern из `homework-api`)
- При `expires_at < now()` → `{ expired: true, tasks: [] }` (фронт показывает «Срок действия ссылки истёк»)
- НЕ возвращает `solution_*` / `rubric_*` если флаги не включены
- **НЕ возвращает** `student_assignments` — публичная ссылка не раскрывает имена учеников

### Миграции

Две SQL-миграции:
1. `20260422130000_homework_share_links.sql` — table + RLS + индексы
2. `20260422130100_homework_assignments_source_group_id.sql` — ADD COLUMN + partial index

Без миграции: `tasks_json` расширение типа (backward-compatible).

---

## 6. UX / UI

### UX-принципы (из doc 16)

- **Принцип 2 «Один экран = одна главная работа»** — на `/tutor/homework/:id` primary остаётся `[Редактировать]`; все новые действия вторичны (через Actions-меню). На `/preview` primary = `[Печать / PDF]`.
- **Принцип 3 «Recognition over recall»** — save-as-template post-factum именно об этом: репетитор не должен **заранее** предугадать «это ДЗ удачное», достаточно узнать это по факту.
- **Принцип 5 «AI output → действие»** — для KB save action layer остаётся: per-task BookmarkPlus на HWTaskCard, bulk диалог из Detail.
- **Принцип 7 «Progressive disclosure»** — Actions-меню со вторичными действиями под `⋯`; share-link диалог с опциональным «Истекает через 30 дней» collapsed по умолчанию.
- **Принцип 11 «Результаты переиспользуемы»** — каркасная мотивация фичи.
- **Принцип 12 «Надёжность > эффектность»** — KB save с dedup checks, не silent duplicate. Share-link toggles дефолтом OFF для answers/solutions (safe default — нельзя случайно отдать ответы родителю).
- **Принцип 13 «AI = черновик»** — неприменимо, фича не AI-heavy.
- **Принцип 14 «Первая ценность за 3 минуты»** — preview+share: от клика до отправленной в Telegram ссылки < 30 сек.
- **Принцип 15 «Каждая фича усиливает пилот»** — все 5 подфич имеют прямое evidence-основание.
- **Принцип 16 «Физика — не просто текст»** — preview рендерит LaTeX через KaTeX, картинки crisp, print-CSS сохраняет формулы.
- **Принцип 17 «Экспорт и шаринг — часть workflow»** — центральная реализация.

### UI-паттерны (из doc 17)

- §5.2 Task Card — reuse в preview (collapsed с возможностью zoom картинки)
- §5.5 Homework Summary Card — расширение с group badge
- §7 Экспорт и шаринг — Preview toolbar реализует паттерн: `Копировать | PDF (через Print) | Ссылка на веб-версию`
- §4.3 Drawer для встраивания — `SaveTasksToKBDialog` использует drawer/sheet паттерн (desktop side drawer, mobile bottom sheet)
- §8.1 Empty state — preview с 0 задачами показывает «Это ДЗ пустое. Добавьте задачи в редакторе.»
- §11 Антипаттерны — проверяем, что не нарушаем: 1 primary CTA на экране; export ≤2 клика; нет chat-ленты в preview

### Wireframe / Mockup

**`/tutor/homework/:id/preview` (desktop):**
```
┌─────────────────────────────────────────────────────────────────┐
│  [← Назад]  Кинематика · Группа 10А · 5 задач                  │
│                                                                  │
│  [🖨️ Печать / PDF] [📋 Копировать текст] [🔗 Поделиться ссылкой] │
│                                                                  │
│  ☐ С ответами   ☐ С решениями                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│              Задача №1 · ЕГЭ №7 · 2 балла                        │
│                                                                  │
│              Тело брошено вертикально вверх с начальной          │
│              скоростью v₀ = 20 м/с. Определите максимальную      │
│              высоту подъёма тела. g = 10 м/с².                   │
│                                                                  │
│              ┌─────────────────────────┐                         │
│              │  [Картинка max-h: 300]  │  ← click to zoom        │
│              └─────────────────────────┘                         │
│                                                                  │
│              [Ответ: 20 м]   (показывается только если toggle)  │
│                                                                  │
│              ─────────────────────────────────                   │
│                                                                  │
│              Задача №2 · ЕГЭ №8 · 2 балла                        │
│              ...                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Actions-меню на `/tutor/homework/:id` header (rightSlot):**
```
[Статус: Активное]  [Редактировать]  [⋯]  [Удалить]
                                      │
                                      ├─ 👁️ Открыть preview
                                      ├─ 🔗 Поделиться ссылкой
                                      ├─ 📚 Сохранить задачи в базу
                                      └─ 📋 Сохранить как шаблон
```

**SaveTasksToKBDialog (desktop side drawer):**
```
┌─ Сохранить задачи в мою базу ────────────┐
│                                           │
│  Папка назначения:                        │
│  [Моя база / Кинематика 10 класс ▾]       │
│                                           │
│  [+ Создать новую папку]                  │
│                                           │
│  Задачи (5):                              │
│  ☑ 1. Тело брошено вверх...               │
│  ☑ 2. Камень падает...          ✓ в базе │
│  ☑ 3. Скорость автомобиля...              │
│  ☑ 4. Равноускоренное движение            │
│  ☑ 5. Свободное падение...                │
│                                           │
│  Выбрано: 5, новых: 4, уже в базе: 1     │
│                                           │
│  [Отмена]  [Сохранить 4 задачи]           │
└───────────────────────────────────────────┘
```

**ShareLinkDialog:**
```
┌─ Поделиться ссылкой ─────────────────────┐
│                                           │
│  Настройки ссылки:                        │
│  ☐ С ответами                             │
│  ☐ С решениями                            │
│  ☐ Истекает через 30 дней                 │
│                                           │
│  [Создать ссылку]                         │
│                                           │
│  После создания:                          │
│  ┌─────────────────────────────────────┐ │
│  │ sokratai.ru/p/a7b2c9x3             │ │
│  └─────────────────────────────────────┘ │
│  [📋 Скопировать]  [Открыть в новой вкладке] │
└───────────────────────────────────────────┘
```

**HWAssignSection с tabs:**
```
┌─ Кому отправить? ─────────────────────────┐
│                                           │
│  [Группы]  [Ученики]                      │
│                                           │
│  Tab Группы:                              │
│  ○ 🟢 10А (5 учеников)                    │
│  ● 🔵 10Б (4 ученика)      ← выбрано     │
│  ○ 🟠 11А (6 учеников)                    │
│                                           │
│  Выбранные ученики: 4                     │
│  [Иван П.] [Мария С.] [Алексей К.] [Катя М.] │
│                                           │
│  (Можно убрать отдельных учеников, тогда  │
│   group_id не сохранится)                 │
└───────────────────────────────────────────┘
```

---

## 6a. Acceptance Criteria

Каждый AC имеет стабильный ID — задачи в `tasks.md` ссылаются на них.

**Preview route:**
- **AC-1** Route `/tutor/homework/:id/preview` доступен из Actions-меню на Detail. Открывается в любом статусе ДЗ (draft/active/completed). Не требует отдельных прав — использует существующий tutor access check.
- **AC-2** Задачи рендерятся в один вертикальный scroll (не pagination, не A4-сетка). Условия через `MathText` (KaTeX для LaTeX), картинки `max-height: 300px`, click → fullscreen zoom (reuse `TaskConditionGallery`-like pattern или Radix Dialog).
- **AC-3** Toolbar сверху: `[← Назад]`, `[🖨️ Печать / PDF]`, `[📋 Копировать текст]`, `[🔗 Поделиться ссылкой]`, `[☐ С ответами]`, `[☐ С решениями]`. Оба toggle дефолтом **OFF**. При ON показывается ответ / `solution_text`+`solution_image_urls` под условием.
- **AC-4** Print CSS: toolbar скрыт через `@media print { display: none }`, каждая задача `break-inside: avoid`, KaTeX сохраняется как HTML и рендерится в PDF через native `window.print()`.
- **AC-5** «Копировать текст» формирует Telegram-friendly формат: нумерация, Unicode-формулы через `stripLatex`, картинки заменяются на `[см. рисунок]`. Копирует через `navigator.clipboard.writeText` + toast-подтверждение.

**Public share-link:**
- **AC-6** Диалог `ShareLinkDialog` создаёт slug (base36 8 символов, уникальный). Несколько ссылок на одно ДЗ разрешены. Секция «Существующие ссылки» показывает список с датой / флагами / кнопкой удаления.
- **AC-7** Route `/p/:slug` **вне AppFrame**, без TutorGuard, без SideNav. Рендерит тот же `HomeworkPreviewContent` что и `/tutor/homework/:id/preview`, с `show_answers` / `show_solutions` флагами из slug. Toolbar минимальный: «Сократ» logo + title + link «Открыть в Сократе» (если viewer логинен и tutor).
- **AC-8** `expires_at < now()` → public страница показывает «Срок действия ссылки истёк». Edge function `public-homework-share` возвращает `{ expired: true }`. Не раскрывает содержимое.
- **AC-9** Public endpoint **НЕ возвращает**: `student_assignments`, имена учеников, `rubric_*`, а также `solution_*` когда флаг `show_solutions=false`. Картинки отдаются как signed URLs с TTL=1 час (re-signed при каждом запросе).

**Save tasks to KB:**
- **AC-10** `SaveTasksToKBDialog` (drawer desktop / bottom sheet mobile) открывается из Actions-меню Detail. Чекбоксы задач дефолтом **все selected**. Список папок — `Моя база` с возможностью выбора существующей. Inline-строка «+ Создать новую папку» разворачивает text-input → создаёт папку inline → автоматически выбирает её.
- **AC-11** Для каждой задачи: если `kb_task_id` ссылается на задачу в моей базе → skip с меткой «✓ уже в базе». Если из каталога (`owner_id IS NULL`) — создаём копию в выбранной папке через existing mechanism. Если новая задача (`kb_task_id IS NULL`) — `INSERT` с fingerprint-check; collision → вернуть ссылку на существующую.
- **AC-12** Копируются поля: `task_text`, `task_image_url`, `correct_answer`, `solution_text`, `solution_image_urls`. **НЕ копируются**: `rubric_text`, `rubric_image_urls` (рубрика ДЗ-специфична).
- **AC-13** Per-task иконка `BookmarkPlus` появляется на `HWTaskCard` **только в edit-mode** конструктора ДЗ. Клик → `SaveTasksToKBDialog` в режиме single-task (один чекбокс, предвыбран).

**Save as Template post-factum:**
- **AC-14** `SaveAsTemplateDialog` из Actions-меню Detail. Prefill: `title = "${assignment.title} — шаблон"`, `tags` = `[subject, topic]` если заданы. Три toggle дефолтом **ON**: `Включить рубрику`, `Включить материалы`, `Включить настройки AI (disable_ai_bootstrap, check_format)`.
- **AC-15** Создаёт запись в `homework_tutor_templates` с `tasks_json` snapshot. Для задач с `kb_task_id` — пишет `source_kb_task_id` в JSONB (провенанс, backward-compat).
- **AC-16** Существующий checkbox «Сохранить как шаблон» в `HWActionBar` при создании ДЗ **сохраняется** — два пути независимо создают записи.
- **AC-17** `PATCH /templates/:id` обновляет **только** `title`, `tags`, `topic`. `tasks_json` не трогается endpoint-ом. Request с полями `tasks_json` / `subject` → 400.

**Assign-to-group:**
- **AC-18** `HWAssignSection` при `tutors.mini_groups_enabled=true` показывает tabs `[Группы] [Ученики]`. Default tab — `Группы` если у репетитора ≥1 активная группа, иначе `Ученики`. При `mini_groups_enabled=false` tabs не рендерятся (legacy UX без групп).
- **AC-19** Выбор группы = autoSelect всех `tutor_student_id` из `tutor_group_memberships WHERE tutor_group_id=gid AND is_active=true`. Можно снять отдельных студентов (переходит в manual mode). Выбор нескольких групп = union.
- **AC-20** `homework_tutor_assignments.source_group_id` пишется при create/update **только если**: выбрана ровно одна группа И итоговый список учеников = активным членам группы (не модифицирован). В противном случае — `NULL`.
- **AC-21** `/tutor/homework` получает фильтр `[Группа ▾]` рядом с sort. HWSummaryCard отображает badge `Группа 10А` (color из `tutor_groups.color`) когда `source_group_id IS NOT NULL` и группа ещё существует.

**Cleanup:**
- **AC-22** Пункт «Помощник» удалён из `SideNav.tsx`. Route `/tutor/assistant` в `App.tsx` → `<Navigate to="/tutor/home" replace />`. Telemetry `tutor_assistant_route_hit` фиксирует bookmark-трафик. Файл `TutorAssistant.tsx` остаётся в репо (не используется).

**Telemetry:**
- **AC-23** 11 событий зарегистрированы в `homeworkTelemetry` (или equivalent): `homework_preview_opened`, `homework_preview_printed`, `homework_preview_copied_text`, `homework_saved_to_kb`, `homework_saved_to_kb_per_task`, `homework_saved_as_template_post_factum`, `homework_share_link_created`, `homework_share_link_visited` (public, анонимно), `homework_assign_group`, `homework_filter_by_group`, `tutor_assistant_route_hit`. Payload без PII (нет имён, email, текста задач).

---

## 7. Validation

### Как проверяем успех?

Telemetry events (добавить в новом PR):
- `homework_preview_opened` (assignment_id)
- `homework_preview_printed` (assignment_id)
- `homework_preview_copied_text` (assignment_id, task_count)
- `homework_saved_to_kb` (assignment_id, tasks_count, folder_id, skipped_count)
- `homework_saved_to_kb_per_task` (assignment_id, task_id, folder_id)
- `homework_saved_as_template_post_factum` (assignment_id, template_id, include_rubric, include_materials)
- `homework_share_link_created` (assignment_id, show_answers, show_solutions, has_expiry)
- `homework_share_link_visited` (slug) — public, анонимно, без user_id
- `homework_assign_group` (group_id, student_count, is_multi_group)
- `homework_filter_by_group` (group_id)
- `tutor_assistant_route_hit` — на redirect-е, понять, есть ли bookmark-трафик

**Метрики успеха через 2 недели пилота:**
- ≥30% отправленных ДЗ → хотя бы одно открытие `/preview`
- ≥15% отправленных ДЗ → хотя бы одно сохранение в KB (bulk или per-task)
- ≥10% отправленных ДЗ → сохранение как шаблон post-factum
- ≥5% отправленных ДЗ → создание share-link
- ≥40% ДЗ у репетиторов с ≥1 группой → создаются через assign-to-group (`source_group_id IS NOT NULL`)
- «Время до отправки ДЗ» (от открытия HW Create до `published`) ↓ на ≥15% у репетиторов с группами

**Negative signals (rollback-трiggers):**
- Preview opens, но нет ни copy-text, ни print — значит preview не конвертирует, подсвечивает кривой UX
- Share-link visited = 0 при create > 5 — репетиторы создают ссылки, но никто по ним не ходит → формат неправильный
- `tutor_assistant_route_hit` ≥ 20% от DAU — bookmark-трафик реальный, нужна более мягкая migration

### Связь с pilot KPI

Прямая. Wedge-обещание «собрал ДЗ за 5-10 минут» расширяется до «собрал + капитализировал за 5-10 минут». Это усиление retention-кривой — репетитор через месяц находит в базе прошлые задачи, шаблон для новой группы создаётся из кнопки, а не с нуля.

### Smoke check

```bash
npm run lint && npm run build && npm run smoke-check
```

Дополнительно ручные проверки (tasks.md оформит):
- Safari/iOS: preview горизонтальный scroll формул внутри карточек, не ломает layout
- Print CSS: `window.print()` даёт читаемый PDF без toolbar
- Share-link `/p/:slug` открывается в incognito (без auth)
- `expires_at < now()` отображает «Срок действия истёк» на публичной странице

---

## 8. Risks & Open Questions

| Риск | Вероятность | Митигация |
|---|---|---|
| Print CSS ломается в Safari (WebKit известен странностями при `window.print()`) | Средняя | Тестировать на macOS Safari + iOS Safari в QA. Fallback — вариант скачивания через `print-js` library, но это +20KB bundle. |
| Share-link leak через logged URLs (Sentry/access logs) | Средняя | Slug 8 символов base36 = 2.8 трлн вариантов. Не PII, но дедатировать в Sentry PII filter. `expires_at` даёт user control. |
| Save-to-KB создаёт дубли при гонках (user кликает save 2 раза) | Низкая | Fingerprint dedup + pg_advisory_xact_lock (уже есть в KB moderation v2). idempotent. |
| `source_group_id IS NOT NULL` но состав группы изменился после создания ДЗ — badge `10А` misleading | Низкая | Badge показывает «Группа 10А» как создавалось. Не пересчитываем на lookup. OK trade-off. |
| Template provenance `source_kb_task_id` указывает на удалённую KB-задачу | Низкая | Sprint 1 не использует это поле. Sprint 2 sync-feature должен обрабатывать NULL lookup gracefully. |
| `/tutor/assistant` удаление ломает bookmark репетиторов | Низкая (вкладка пустая) | Route остаётся как 302. Telemetry покажет реальный трафик. |
| Preview показывает solution_text при `show_solutions=true` в share-link родителю по ошибке | Высокая если не default OFF | Дефолт OFF + явный confirm в диалоге при включении. Edge function игнорирует флаг если он `true` на ДЗ без `solution_text` вообще. |

### Resolved decisions (2026-04-22)

1. ✅ **Folder creation UX:** inline в том же диалоге. Строка «+ Создать новую папку» разворачивает text-input под селектом папок. Сразу создаёт папку и выбирает её. Без отдельной модалки.
2. ✅ **Share-link multiplicity:** несколько ссылок на одно ДЗ разрешены. Репетитор может создать: (1) для родителя без ответов, (2) для коллеги с ответами, (3) для ученика-пропустившего с ответами на месяц. Отдельная секция в ShareLinkDialog показывает **существующие ссылки** с датой создания / флагами / кнопкой `Удалить`.
3. ✅ **Template update scope:** только метаданные (`title`, `tags`, `topic`). `tasks_json` в Sprint 1 **read-only после create**. Редактирование задач шаблона — Sprint 2+ (требует отдельного dialog с task picker, вне scope).
4. ✅ **Preview для draft-ДЗ:** доступно в любом статусе (`draft` / `active` / `completed`). Preview — read-only view существующих задач, безопасно для всех статусов.
5. ✅ **Save-to-KB из preview toolbar:** НЕ добавляем. Actions-меню на `/tutor/homework/:id` — единственный entry point. Preview остаётся read-only surface (сохраняет single-responsibility и упрощает mental model).

---

## 9. Implementation Tasks

> Переносятся в `tasks.md` после approve спека. Оценка по t-shirt size и условный порядок исполнения.

- [ ] **TASK-1** (M, 1-2д) DB миграции: `homework_share_links` table + `source_group_id` column + партиальный индекс
- [ ] **TASK-2** (S, 0.5д) Удалить «Помощник» из SideNav, redirect `/tutor/assistant → /tutor/home`, telemetry `tutor_assistant_route_hit`
- [ ] **TASK-3** (M, 2-3д) `TutorHomeworkPreview.tsx` + `HomeworkPreviewContent.tsx` + print-CSS + toolbar (Печать / Копировать / Поделиться)
- [x] **TASK-4** (S, 1д) Public `PublicHomeworkShare.tsx` + `public-homework-share` edge function + `/p/:slug` route вне AppFrame — ✅ Done 2026-04-22. Public edge function `GET /share/:slug` (no JWT, service_role, CORS `*`) with slug regex gate (`/^[a-z0-9]{8}$/i` → 400), expires-at check (`{expired:true}`), column-whitelisted SELECT (never rubric / student linkage; conditional `correct_answer` + `solution_*`), signed URLs TTL=3600s for task + solution images via `parseAttachmentUrls`, anonymous `homework_share_link_visited` telemetry (slug only). Frontend `PublicHomeworkShare.tsx` mounted at `/p/:slug` outside AppFrame with 5-state UI (loading / invalid_slug / not_found / expired / error / ok) and inline task rendering designed for trivial extraction into TASK-3's `HomeworkPreviewContent` when that lands. Client `publicShareApi.fetchPublicHomeworkShare` returns a discriminated result union.
- [ ] **TASK-5** (M, 2д) `SaveTasksToKBDialog` + `handleSaveTasksToKB` edge handler + per-task BookmarkPlus на `HWTaskCard` в edit-mode
- [ ] **TASK-6** (S, 1д) `SaveAsTemplateDialog` + `handleCreateTemplateFromAssignment` handler + `PATCH /templates/:id`
- [x] **TASK-7** (S, 1д) `ShareLinkDialog` + `handleCreateShareLink` handler — ✅ Done 2026-04-22 (commit `bab6ae2`). Three tutor-only handlers (`POST/GET/DELETE /share-links`), slug via `crypto.randomUUID` 8-hex with collision retry ≤3, ownership via `created_by` + `getOwnedAssignmentOrThrow`; `ShareLinkDialog` with two sections (new-link form + existing-links list with flag chips + copy + trash); `homework_share_link_created` telemetry PII-free (no slug).
- [ ] **TASK-8** (M, 1-2д) `HWAssignSection` tabs Группы/Ученики + `useTutorGroups` hook (если нет) + запись `source_group_id` в handleCreate/handleUpdate
- [ ] **TASK-9** (S, 1д) Filter `?group_id=` в `handleListAssignments` + UI фильтр на `/tutor/homework` + group badge в `AssignmentCard`
- [ ] **TASK-10** (S, 0.5д) Actions-меню на `TutorHomeworkDetail` — добавить 4 новых пункта, связать с диалогами
- [ ] **TASK-11** (S, 0.5д) Telemetry events во всех точках (11 новых events перечислены в §7)
- [ ] **TASK-12** (S, 1д) QA: Safari/iOS preview + print + share-link в incognito + group assign flow + KB dedup collision test

**Итого:** ~12-16 человеко-дней, 1 sprint (2 недели) для одного fullstack разработчика, либо 1 неделя при параллельной работе 2 человек.

**Критический путь:** TASK-1 (миграции) → TASK-3/4 (preview/share) параллельно с TASK-5 (save-kb) параллельно с TASK-8 (groups) → TASK-10 (связка в меню) → TASK-11 (telemetry) → TASK-12 (QA).

---

## Checklist перед approve

- [x] Job Context заполнен (секция 0)
- [x] Привязка к Core Job из backlog doc 15 (P0.1 + P1.2 + P1.3 + P2.3)
- [x] Scope чётко определён (in/out)
- [x] UX-принципы из doc 16 учтены (принципы 2, 3, 5, 7, 11, 12, 14, 15, 16, 17 явно названы)
- [x] UI-паттерны из doc 17 учтены (§5.2, §5.5, §7, §4.3, §8.1, §11)
- [x] Pilot impact описан — 3 evidence-based жалобы
- [x] Метрики успеха определены (4 positive + 3 negative)
- [x] High-risk файлы не затрагиваются без необходимости (AuthGuard, TutorGuard, Chat.tsx, TutorSchedule.tsx, telegram-bot/index.ts — не трогаем)
- [x] Student/Tutor изоляция не нарушена (public share-link специально изолирован вне AppFrame, student-side не затронут)

---

## Связанные документы

- **Wedge:** `docs/discovery/research/08-wedge-decision-memo-sokrat.md`
- **Product PRD:** `docs/discovery/product/tutor-ai-agents/14-ajtbd-product-prd-sokrat.md`
- **Jobs backlog:** `docs/discovery/product/tutor-ai-agents/15-backlog-of-jtbd-scenarios-sokrat.md` (P0.1, P1.2, P1.3, P2.3)
- **UX principles:** `docs/discovery/product/tutor-ai-agents/16-ux-principles-for-tutor-product-sokrat.md`
- **UI patterns:** `docs/discovery/product/tutor-ai-agents/17-ui-patterns-and-component-rules-sokrat.md`
- **KB architecture:** `.claude/rules/50-kb-module.md`
- **Homework system:** `.claude/rules/40-homework-system.md`
- **Template schema:** `supabase/migrations/20260226100000_homework_20.sql`
- **Groups schema:** `supabase/migrations/20260223193000_tutor_mini_groups_foundation.sql`

## Следующие спринты (out of this spec)

- **Sprint 2:** Cmd+K global palette + inline AI (HWTaskCard «Похожие», `/preview` «Оценить гармоничность подбора»); возвращение `/tutor/assistant` с Job workspace #3 «Решить / объяснить» per doc 17 §4.1
- **Sprint 3+ (по результатам пилота):** Template sync from KB source (provenance-driven), «Похожие задачи в недавних ДЗ» в preview, Job workspaces #1-#2 (если Cmd+K + KB окажутся недостаточными)
- **Deferred indefinitely:** Course / curriculum / lesson-plan entity (expansion P2.3, не pilot scope)
