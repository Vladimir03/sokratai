-- ══════════════════════════════════════════════════════════════
-- Единая модель задач (unified-task-model, Фаза 0 / M4) — 2026-07-05
-- Провенанс снимка: homework_tutor_tasks.source_kb_task_id (per-row,
-- вместо позиционного homework_kb_tasks) + source_template_id на ДЗ.
--
-- ON DELETE SET NULL (НЕ RESTRICT, в отличие от ссылок шаблонов M3):
-- выданное ДЗ — снимок; потеря указателя никогда не должна блокировать
-- удаление задачи из Базы.
--
-- Anti-leak (rule 40): SELECT на homework_tutor_tasks — column-GRANT whitelist
-- (20260630170000) → новые колонки АВТОМАТИЧЕСКИ не видны authenticated.
-- source_kb_task_id ученику не нужен → в GRANT НЕ добавляем (tutor-читается
-- через edge под service_role).
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.homework_tutor_tasks
  ADD COLUMN IF NOT EXISTS source_kb_task_id UUID NULL
    REFERENCES public.kb_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_kb_synced_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_hw_tasks_source_kb
  ON public.homework_tutor_tasks(source_kb_task_id)
  WHERE source_kb_task_id IS NOT NULL;

COMMENT ON COLUMN public.homework_tutor_tasks.source_kb_task_id IS
  'Провенанс снимка: задача Базы, из которой снят этот homework-снимок (unified-task-model, 2026-07-05). Предпочитается позиционному homework_kb_tasks (legacy). Tutor-only: НЕ в column-GRANT authenticated.';
COMMENT ON COLUMN public.homework_tutor_tasks.source_kb_synced_at IS
  'Когда снимок последний раз синхронизирован с источником («Обновить в Базе» / создание). Для divergence-бейджа у тутора.';

ALTER TABLE public.homework_tutor_assignments
  ADD COLUMN IF NOT EXISTS source_template_id UUID NULL
    REFERENCES public.homework_tutor_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.homework_tutor_assignments.source_template_id IS
  'Шаблон, из которого выдано ДЗ (usage_count-инкремент + аналитика Банка). NULL для ДЗ не из шаблона.';
