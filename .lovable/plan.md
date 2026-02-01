
## План: Исправление ошибки supabaseUrl is required

### Проблема
Страница `/tutor/students` не открывается из-за ошибки `supabaseUrl is required`. Причина — файл `TutorLayout.tsx` импортирует Supabase клиент из автогенерируемого файла без fallback-значений.

### Решение
Исправить импорт в файле `src/components/tutor/TutorLayout.tsx`:

**Было:**
```typescript
import { supabase } from '@/integrations/supabase/client';
```

**Станет:**
```typescript
import { supabase } from '@/lib/supabaseClient';
```

### Техническое объяснение
- `@/integrations/supabase/client` — автогенерируемый файл без fallback-значений для preview-окружения
- `@/lib/supabaseClient` — файл с fallback URL и ключом, работает в любом окружении

### Изменяемые файлы
| Файл | Изменение |
|------|-----------|
| `src/components/tutor/TutorLayout.tsx` | Исправить import на `@/lib/supabaseClient` |

### Результат
После исправления страница `/tutor/students` будет корректно загружаться в preview-окружении.
