# RU Auth Bypass — инварианты (всегда в контексте)

Регрессии здесь блокировали регистрацию репетиторов в РФ (май 2026). **Глубина — skill `auth-ru-bypass`** (архитектурные схемы флоу, OAuth Yandex/VK и 406-ФЗ, claim-код и онбординг-активация v2, сброс пароля, ops-чеклисты Supabase-дашборда, история инцидентов).

**ЛЮБОЕ изменение auth-флоу сначала проходит этот список.**

## Сеть

`supabase` — только из `@/lib/supabaseClient` (хардкод `https://api.sokratai.ru`). **Никогда** `@/integrations/supabase/client`, никогда `vrsseotrfmsxpbciyqzc.supabase.co`, `${PROJECT_ID}.supabase.co`, `VITE_SUPABASE_PROJECT_ID` или `import.meta.env.VITE_SUPABASE_URL` (Lovable форсит его в заблокированный домен). Pre-merge: `git diff --staged | grep -E "supabase\.co"` — любое не-комментарийное попадание кроме `api.sokratai.ru` = блокер мержа.

## Frontend

1. **Гарды ЖДУТ `INITIAL_SESSION`.** Синхронный `getSession()` в `useEffect` возвращает `null` ДО того, как supabase-js распарсит URL-хэш `#access_token=…` от наших edge-функций. Симптом нарушения: бесконечный цикл Google → `/tutor/home` → `/register-tutor`.
2. **Никогда не silent-fail на `!data.session` после `signUp()`.** При email-confirm сессии нет; продолжать (вызывать `assign-tutor-role` без JWT) = 401 и non-actionable ошибка. Показывать экран «Подтвердите почту» (`EmailConfirmWaiting`), а не `toast + return`.
3. **Никакого client-side consent/role для email-флоу** — сессии нет. Intent сохраняется в `user_metadata` (`signup_source`, `consent_intent`, `trial_intent`), `email-verify` флашит его server-side под admin-клиентом.
4. **`intendedRole="tutor"` только со страниц С consent-гейтом** (`/register-tutor`, `/tutor/signup-trial`). Со страниц входа — запрещено: новый юзер кликнул «Войти» → создался → авто-роль tutor → обход оферты.
5. **Ре-верификация гарда НЕ размонтирует кабинет.** `supabase-js` переэмитит `SIGNED_IN` на возврате вкладки (не только при логине). Пока пользователь уже `authorized`, нельзя дёргать `setLoading(true)`/`setError()` — иначе `<Outlet/>` размонтируется и **теряются открытые формы** (баг Егора, 3 репетитора). Паттерны: `AuthGuard` — fire-once (`sessionHandled`); `TutorGuard` — «тихая» ре-верификация через `authorizedRef`. При cached same-user **НЕ бампать `verifiedAt`** (иначе 10-мин TTL роли становится скользящим «последним фокусом»). Смена юзера → блокирующая проверка.

## Backend / edge

6. **`intendedRole` из запроса — не доверять без двух сигналов.** Tutor-роль назначается только когда: явно передан `intendedRole=tutor` **И** `redirectTo.pathname` начинается с `/tutor/` **И** `isNewUser === true`.
7. **Exact allow-list, не regex, для security-adjacent проверок.** `TUTOR_SIGNUP_SOURCES` — `Set` точных значений. `/tutor/i.test(signupSource)` пропустит `"not-tutor"`. Новый entrypoint → расширять Set явно.
8. **Провал вставки роли — ФАТАЛЬНЫЙ.** Не продолжать 302 на `/tutor/home`: TutorGuard увидит отсутствие роли → bounce → бесконечный цикл. Вставка строки `tutors` — non-fatal (гард пропускает по роли).
9. **Никогда не хардкодить `redirect_to` в email-шаблоне.** Шаблоны глобальные per-type; хардкод `/tutor/home` уведёт и ученика. Только `{{ .RedirectTo }}`.
10. **Никаких PII в логах** auth-функций: не логировать email, user_id, Telegram-токены, invite-код (он = bearer). Структурные события с boolean/status — ок.
11. **Новая edge-функция НЕ выкладывается сама. Push в main её не деплоит.** GitHub-workflow удалён 2026-07-27 и **не подлежит восстановлению**: прод-проект Supabase (`vrsseotrfmsxpbciyqzc`) принадлежит НЕ владельцу — его выделил и держит Lovable, в организации владельца (`Vladimir03's Org`) его нет. Личный токен любого нашего аккаунта получает `403 does not have the necessary privileges` на functions-эндпоинтах (проверено дважды, в т.ч. свежевыпущенным токеном; 30 прогонов из 30 красные за всё время). Это ограничение ПРАВ, а не конфигурации — не трать время на новые токены. Синк Lovable подтягивает КОД, но не применяет миграции и не деплоит функции — проверено 2026-07-27: миграции лежали в синхронизированном воркспейсе неприменёнными. Реальный путь — попросить агента Lovable задеплоить явно. **Записал функцию в `config.toml` → обязан ПРОВЕРИТЬ факт выкладки:** `curl -X OPTIONS https://api.sokratai.ru/functions/v1/<имя>` — **404 = не задеплоена**, 503 = boot-fail (rule 98), 401/200 = жива. Плюс `node scripts/supabase-drift-check.mjs` (ось config↔workflow).
12. **Публичная функция: клиент шлёт anon-ключ, не полагайся на `verify_jwt=false`.** Lovable иногда деплоит с включённым JWT-гейтом → gateway отдаёт 401 ДО входа в функцию (подтверждено снова 2026-07-27: первый деплой `health-check` поднял её с `verify_jwt=true`). **Отличить шлюз от функции — по ТЕЛУ ответа:** `{"code":401,...}` / `UNAUTHORIZED_INVALID_JWT_FORMAT` = гейт включён; твоя русская фраза = выключен. Для cron-функций (`Authorization: Bearer <не-JWT>`) включённый гейт = молча мёртвый cron, поэтому после деплоя ОБЯЗАТЕЛЬНА эта проба. Шли `SUPABASE_PUBLISHABLE_KEY` в `apikey` И `Authorization`. **Исключение — browser-navigation функции** (OAuth-init, `email-verify`, `invite-preview`): браузер идёт 302-редиректом без заголовков, там `verify_jwt=false` обязателен по-настоящему, и правится только sync-on-push деплоем (агентский deploy-тул Lovable игнорирует `config.toml`).
13. **Смена пароля отзывает ВСЕ сессии.** Любой `admin.updateUserById({password})` для залогиненного пользователя ОБЯЗАН вернуть свежую сессию (`_shared/mint-session.ts::mintFreshSession`, с identity-гардом), а клиент — сделать `setSession`. Иначе юзер разлогинивается на СЛЕДУЮЩЕМ edge-запросе (access-token несёт мёртвый `session_id`).

## 406-ФЗ — только российские провайдеры

Авторизация через иностранные сервисы (Google, Apple, **Telegram**) запрещена. Живые: email+пароль, **Yandex ID**, **VK ID** (кастомный RU-bypass OAuth, `_shared/oauth-helpers.ts`). `oauth-google-*`, `GoogleAuthButton`, `*TelegramLoginButton` — **DORMANT, не возрождать как вход**. Telegram-**бот** (уведомления/`/pay`/ДЗ/инвайты) не тронут.

Новый OAuth-провайдер: только российская ИС; зеркалить `_shared/oauth-helpers.ts` (signState/verifyState, path-guard `deriveIntendedRole`, findOrCreateUser, mintSession); расширять `ConsentSource` + `TUTOR_SIGNUP_SOURCES`; `config.toml verify_jwt=false` + deploy-workflow.

**OAuth state ≤ 255 символов, у VK ≤ ~128.** VK ID корраптит длинный `state`, поэтому у VK payload лежит в `oauth_state_store` и в URL едет только короткий handle — **PKCE-verifier VK никогда не кладём в URL**. Яндекс остаётся на компактном подписанном state (работает, не трогать). Подписывать только `signStateBounded`, не голым `signState`.

## ⚠️ Lovable-sync стирает незакоммиченное

Работа по auth дважды пропадала: Lovable перезаписывал рабочее дерево своим cloud-state, удаляя uncommitted файлы. **Коммить auth-изменения сразу.**
