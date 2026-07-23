-- ══════════════════════════════════════════════════════════════════════════
-- Идемпотентность сохранения шаблона ДЗ — ревью ChatGPT-5.6, P1 #8.
--
-- Сценарий: сервер создал шаблон и вернул 201, но соединение оборвалось до
-- получения ответа (RU-DPI рвёт TLS вероятностно, rule 95). Тьютор жмёт
-- «Повторить» в тосте → создаётся ВТОРОЙ идентичный шаблон.
--
-- Ключ идемпотентности генерит клиент ОДИН раз на попытку сохранения и шлёт
-- неизменным во всех ретраях этой попытки. Уникальность — на (tutor_id,
-- creation_request_id): повтор ловится индексом, edge возвращает уже созданный
-- шаблон вместо дубля.
--
-- Уникальность ТОЛЬКО по assignment_id была бы неверна: post-factum-диалог
-- намеренно разрешает несколько разных шаблонов из одного ДЗ (AC-16).
--
-- TEXT, а не UUID: клиентский генератор (`src/lib/clientUuid.ts`) на Safari 15
-- падает в Math.random-fallback, и мы не хотим, чтобы формат значения был
-- money-critical'ным контрактом БД. Валидность формата обеспечивает edge.
-- Аддитивно: колонка nullable, старые клиенты (без ключа) пишут NULL и в
-- partial-unique индекс не попадают — поведение прежнее.
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.homework_tutor_templates
  ADD COLUMN IF NOT EXISTS creation_request_id TEXT;

COMMENT ON COLUMN public.homework_tutor_templates.creation_request_id IS
  'Идемпотентный ключ одной попытки сохранения (генерит клиент, неизменен между ретраями). NULL = старый клиент. Уникален в пределах тьютора.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_hw_templates_creation_request
  ON public.homework_tutor_templates (tutor_id, creation_request_id)
  WHERE creation_request_id IS NOT NULL;
