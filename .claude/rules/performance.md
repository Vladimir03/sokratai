### 2. Производительность (< 2 секунды загрузка)
- **ЗАПРЕЩЕНО** использовать `framer-motion` где-либо в проекте (полностью удалён 2026-04-03)
  - Используй CSS transitions/animations (`transition-all`, `animate-in fade-in`, `zoom-in-*`, `slide-in-from-*`) из `tailwindcss-animate`
  - `hover:scale-*` / `active:scale-*` запрещены на shared-компонентах (button, badge, card) — используй `transition-colors`
  - Для entrance-анимаций: `animate-in fade-in zoom-in-90 slide-in-from-bottom-4 duration-300`
- **ЗАПРЕЩЕНО** добавлять тяжёлые библиотеки (recharts, pyodide) в shared-компоненты
- Изображения в карточках и чате ОБЯЗАНЫ иметь `loading="lazy"`
- Все новые страницы ОБЯЗАНЫ использовать `React.lazy()` + `Suspense`
- Тяжёлые компоненты ОБЯЗАНЫ грузиться лениво (`React.lazy`, dynamic import)

### 2a. Supabase API — быстрые вызовы
- **`getSession()`** — читает из локального кеша (мгновенно, без сетевого запроса). Используй для получения `user.id` в hot-path
- **`getUser()`** — делает сетевой запрос к Supabase Auth (медленно). Используй ТОЛЬКО когда нужна свежая серверная верификация
- **ПРАВИЛО**: в `src/lib/tutors.ts` и `src/lib/tutorSchedule.ts` для получения user.id использовать ТОЛЬКО `getSession()`
- **Guard-компоненты** (`TutorGuard`, `AuthGuard`) должны кешировать результат проверки ролей, чтобы переход между вкладками был мгновенным
- **`visibilitychange` обработчик** — обязателен в guard-компонентах для восстановления сессии после бездействия пользователя (2+ минуты)
- **Исключение**: `src/hooks/useTutorAccess.ts` вызывает `getUser()` — это намеренно (условный рендер навигации, не guard-логика). **Не копировать этот паттерн** в новый код.

### 2b. tutors.ts vs tutorSchedule.ts — правило разделения
- **Вся логика уроков / слотов / бронирования** живёт **ТОЛЬКО** в `src/lib/tutorSchedule.ts`
- `src/lib/tutors.ts` содержит лишь ре-экспорт функций из `tutorSchedule.ts` (последний блок файла) — не дублируй туда новую логику
- Добавляя новую функцию расписания/уроков: пиши в `tutorSchedule.ts`, при необходимости добавляй ре-экспорт в `tutors.ts`

### 2c. React Query key-конвенция (tutor)
- **Обязательный префикс** для всех tutor-запросов: `['tutor', entity, ...params]`
- Примеры: `['tutor','students']`, `['tutor','student', id]`, `['tutor','payments']`, `['tutor','lessons']`, `['tutor','homework','assignments', filter]`
- Отклонение от конвенции **ломает** `tutorStudentCacheSync.ts` (`applyTutorStudentPatchToCache`, `invalidateTutorStudentDependentQueries`)
- Перед добавлением нового tutor-query сверяйся с `src/lib/tutorStudentCacheSync.ts` — там перечислены все ключи для инвалидации
