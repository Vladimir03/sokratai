-- P0 из docs/delivery/features/ai-request-optimization/research.md:
-- начать измерять кэш-хиты провайдера.
--
-- Зачем: implicit caching у Gemini включён по умолчанию и ловит общий префикс,
-- а наш SYSTEM_PROMPT (~2.8k токенов) байт-в-байт одинаков у всех вызовов чата,
-- т.е. формально мы в условиях кэш-хита. Но кэш серверный, ключ — проект
-- Lovable, а не наш, и до сих пор `emitUsage` читал из ответа шлюза только три
-- поля, молча выбрасывая cached-токены. Без этой колонки нельзя отличить
-- «кэш не работает» от «мы про него не спрашивали» — и любая оптимизация
-- префикса делалась бы вслепую.
--
-- Аддитивно: nullable-колонка, дефолта нет, старые строки не трогаются.

alter table public.token_usage_logs
  add column if not exists cached_tokens integer;

comment on column public.token_usage_logs.cached_tokens is
  'Prompt-токены, зачтённые провайдером как кэш-хит (implicit/explicit caching). '
  'NULL = шлюз поле не прислал (не знаем, работает ли кэш); 0 = прислал, кэш не сработал — '
  'РАЗНЫЕ факты, не сливать. Пишется _shared/token-usage.ts, observability-only, на логику не влияет.';
