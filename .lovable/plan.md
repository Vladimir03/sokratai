## Контекст
Маркер из main (commit 1c347e3) **уже присутствует** в рабочем дереве Lovable:
- `supabase/functions/mock-exam-student-api/index.ts:672` → `const value = typed ?? ocrValueForKim(kim);` ✅

Значит код актуальный, дополнительный sync с GitHub не требуется. Прошлый деплой, видимо, использовал кэш — нужен принудительный передеплой.

## Шаги
1. Передеплоить 4 edge-функции из текущего рабочего дерева:
   - `mock-exam-student-api`
   - `mock-exam-tutor-api`
   - `mock-exam-grade`
   - `mock-exam-public`
2. Подтвердить успех деплоя.

## Что НЕ делаем
- Не правим код (маркер уже на месте).
- Не трогаем миграции / config.toml / фронтенд.
- Не делаем frontend deploy block — это backend-only изменение.

После approve выполню `supabase--deploy_edge_functions` с массивом из 4 имён.