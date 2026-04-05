
Проблема сейчас выглядит уже не как seed/RLS/auth issue, а как ошибка загрузки lazy-route: браузер падает ещё на импорте `StudentFormulaRound.tsx`, поэтому страница не доходит до логики round screen.

Что я считаю основной причиной после ревью кода:
- в formula-round стеке всё ещё используются импорты из автогенерируемого `@/integrations/supabase/client`
- это есть минимум в:
  - `src/pages/StudentFormulaRound.tsx`
  - `src/lib/formulaRoundApi.ts`
- при этом весь проект уже живёт на preview-safe клиенте `@/lib/supabaseClient`, где есть fallback для preview/dev host
- это особенно подозрительно, потому что `Navigation.tsx` и остальной app используют именно fallback-клиент, а formula-round маршрут — исключение
- из-за этого lazy chunk для `/homework/:id/round/:roundId` может валиться на preview host и наружу это выглядит как `Failed to fetch dynamically imported module`

План исправления:
1. Вернуть formula-round flow на единый preview-safe клиент
   - заменить импорты `@/integrations/supabase/client` на `@/lib/supabaseClient` в:
     - `src/pages/StudentFormulaRound.tsx`
     - `src/lib/formulaRoundApi.ts`
   - дополнительно быстро проверить, что в formula-round цепочке больше не осталось прямых импортов generated client

2. Убедиться, что preview auto-login и загрузка round используют один и тот же экземпляр клиента
   - preview sign-in
   - `fetchFormulaRound`
   - `saveFormulaRoundResult`
   - logout/navigation
   всё должно идти через один shared client

3. Пересобрать preview
   - нужен свежий preview bundle, чтобы исчезло состояние с битым lazy-chunk
   - это же должно убрать экран ErrorBoundary с “Доступна новая версия”

4. Проверить QA URL end-to-end
   - открыть preview ссылку с `?student=...301`
   - проверить:
     - auto-login как `formula-round+student1@sokratai.test`
     - badge `Preview mode`
     - round screen открывается
     - видны progress bar, 3 lives и первое задание

5. Если после этого ошибка останется, уже точечно добивать реальную причину lazy-import
   - посмотреть console/network именно для `/src/pages/StudentFormulaRound.tsx?...`
   - зафиксировать точный transform/runtime error от Vite
   - чинить следующий проблемный импорт только по фактической ошибке, а не по гипотезе

Какие файлы, скорее всего, менять:
- `src/pages/StudentFormulaRound.tsx`
- `src/lib/formulaRoundApi.ts`

Технические детали:
- `src/lib/supabaseClient.ts` уже специально создан для preview/dev, когда env-переменные на host могут быть недоступны
- `src/integrations/supabase/client.ts` трогать не нужно и нельзя — проблема в том, что formula-round сейчас использует не тот клиент для preview
- текущий симптом (`Failed to fetch dynamically imported module`) хорошо совпадает с падением lazy route на инициализации зависимостей, ещё до рендера страницы
- поэтому предыдущие фиксы с seed/schema cache/route сами по себе не устраняют именно этот класс ошибки

Критерий успеха:
- ссылка открывается на `*.lovableproject.com`
- больше нет ErrorBoundary с chunk/module ошибкой
- preview bootstrap логинит тест-студента
- formula round сразу показывает первый экран раунда
