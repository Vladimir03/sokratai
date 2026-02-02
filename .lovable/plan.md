

## План: Исправление ошибки "supabaseUrl is required" на странице приглашения

### Причина бага

На скриншоте чётко видна ошибка:
```
Error: supabaseUrl is required.
at InviteToTelegram-CqzWpYdo.js:1:636
```

**Проблема:** Файл `src/pages/InviteToTelegram.tsx` (строка 9) импортирует Supabase клиент из `@/integrations/supabase/client` — этот файл автоматически генерируется и **не имеет fallback значений** для переменных окружения.

**Результат:** Когда `VITE_SUPABASE_URL` не определена (что происходит на production-домене), Supabase клиент падает при инициализации, и вся страница не работает.

### Решение

Заменить импорт на `@/lib/supabaseClient`, который уже содержит fallback значения:

```typescript
// Было (строка 9)
import { supabase } from '@/integrations/supabase/client';

// Станет
import { supabase } from '@/lib/supabaseClient';
```

### Почему это работает

Файл `src/lib/supabaseClient.ts` содержит:
```typescript
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 
  'https://vrsseotrfmsxpbciyqzc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 
  'eyJhbGciOiJIUzI1NiI...';
```

Это гарантирует работу даже когда переменные окружения недоступны.

### Файл для изменения

| Файл | Изменение |
|------|-----------|
| `src/pages/InviteToTelegram.tsx` | Строка 9: заменить `@/integrations/supabase/client` → `@/lib/supabaseClient` |

### Результат после исправления

- Страница `https://sokratai.ru/invite/JPYRPYCN` будет загружаться корректно
- Школьники смогут переходить по ссылке приглашения и видеть QR-код
- Никаких "белых экранов" или ошибок инициализации Supabase

