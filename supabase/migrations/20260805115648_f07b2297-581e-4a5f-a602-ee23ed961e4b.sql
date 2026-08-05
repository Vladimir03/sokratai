alter table public.token_usage_logs
  add column if not exists cached_tokens integer;

comment on column public.token_usage_logs.cached_tokens is
  'Prompt-токены, зачтённые провайдером как кэш-хит (implicit/explicit caching). NULL = шлюз поле не прислал (не знаем, работает ли кэш); 0 = прислал, кэш не сработал — РАЗНЫЕ факты, не сливать. Пишется _shared/token-usage.ts, observability-only, на логику не влияет.';