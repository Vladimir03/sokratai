## Контекст

В БД сегодня только Эмилия упёрлась в лимит — `messages_today=10`, `subscription_tier='free'`, trial истёк. Это **репетитор зашёл в своё ДЗ под своей учёткой как ученик**.

Текущий backend payload (`buildLimitReachedResponse`):
```json
{
  "error": "limit_reached",
  "message": "Вы достигли дневного лимита в 10 сообщений. Оформите подписку...",
  "limit": 10,
  "tutor_can_upgrade": false
}
```

Сейчас фронт через `extractApiErrorMessage` показывает только серверный message + AI-старт nudge (когда `tutor_can_upgrade=true`). Юзер не понимает, **почему 10, а не 50**, и не догадывается, что попал в ученический лимит.

## Что меняем (frontend-only, UX)

Один файл: `src/lib/apiErrorMessage.ts` — расширяем `extractApiErrorMessage()`.

Когда `body.error === 'limit_reached'` И `body.limit === 10` (free chat-tier лимит) И `body.tutor_can_upgrade !== true` → добавить пояснение:

> «Это лимит ученика без подписки. Если вы репетитор и открыли своё ДЗ для проверки — выйдите в кабинет репетитора, там лимит не действует.»

Когда `tutor_can_upgrade === true` (есть тутор, но не платит) — оставить уже существующий nudge про AI-старт (без «лимит ученика без подписки» — это сбивает).

Когда `limit === 50` (homework-контекст, тутор платящий) — оставить как есть.

## Файлы

- `src/lib/apiErrorMessage.ts` — расширить условную ветку в `extractApiErrorMessage`. ~5 строк.

## Что НЕ трогаем

- Backend (`_shared/subscription-limits.ts`, RPC `get_subscription_status`) — без изменений.
- Лимиты (10/50) — без изменений.
- Логику инкремента — без изменений.
- Остальные 4 API-обёртки (`studentHomeworkApi`, `mockExamApi`, ...) — они уже используют `extractApiErrorMessage`, фикс автоматически разойдётся по всем 429-кейсам.

## Деплой

Только frontend (`src/lib/*`). Backend deploy не нужен. После apply patch — `deploy-sokratai` на VPS (Phase B requirement).
