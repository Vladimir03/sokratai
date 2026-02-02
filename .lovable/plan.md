

## План: Исправление генерации пригласительных ссылок

### Проблема
Функция `getTutorInviteWebLink()` в файле `src/utils/telegramLinks.ts` использует `window.location.origin`:

```typescript
export const getTutorInviteWebLink = (inviteCode: string): string => {
  return `${window.location.origin}/invite/${inviteCode}`;
};
```

В среде разработки Lovable это возвращает:
```
https://5fbe4a32-1baf-47b0-8f47-83e3060cf929.lovableproject.com
```

Вместо опубликованного домена:
```
https://sokratai.ru
```

Ученик переходит по ссылке и попадает в редактор Lovable (видит "Access Denied"), вместо страницы приложения Сократ.

### Решение
Захардкодить production URL для пригласительных ссылок:

```typescript
// Продакшн URL приложения
const PRODUCTION_URL = 'https://sokratai.ru';

export const getTutorInviteWebLink = (inviteCode: string): string => {
  return `${PRODUCTION_URL}/invite/${inviteCode}`;
};
```

### Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/utils/telegramLinks.ts` | Заменить `window.location.origin` на константу `PRODUCTION_URL` |

### Результат
После изменения:
- Ссылка будет: `https://sokratai.ru/invite/JPYRPYCN`
- Ученик увидит красивую страницу с инструкцией и QR-кодом
- Сможет перейти в Telegram и подключиться к репетитору

