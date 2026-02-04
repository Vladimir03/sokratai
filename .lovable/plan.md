

# План: Создание Edge Function `tutor-update-student`

## Описание

Новая Edge Function для редактирования профиля ученика репетитором. Нужна потому что:
- Таблица `profiles` имеет RLS, ограничивающий редактирование только самим пользователем
- Репетитору нужен доступ через `service_role` для изменения данных ученика

## Что нужно сделать

### 1. Создать Edge Function

Файл: `supabase/functions/tutor-update-student/index.ts`

Принимает:
| Поле | Тип | Описание |
|------|-----|----------|
| `tutor_student_id` | string | ID связи репетитор-ученик |
| `name` | string | Имя ученика (→ profiles.username) |
| `telegram_username` | string | Telegram username |
| `learning_goal` | string | Цель обучения |
| `grade` | number? | Класс |
| `exam_type` | string? | ege / oge |
| `subject` | string? | Предмет |
| `start_score` | number? | Начальный балл |
| `target_score` | number? | Целевой балл |
| `parent_contact` | string? | Контакт родителя |
| `notes` | string? | Заметки |

Логика:
1. Проверить JWT и получить user_id
2. Проверить, что tutor_student принадлежит этому репетитору
3. Обновить `profiles` через service_role (username, telegram_username, learning_goal, grade)
4. Обновить `tutor_students` (exam_type, subject, start_score, target_score, parent_contact, notes)

### 2. Добавить конфиг

В `supabase/config.toml`:
```toml
[functions.tutor-update-student]
verify_jwt = true
```

### 3. Добавить типы

В `src/types/tutor.ts` добавить:
```typescript
export interface UpdateTutorStudentProfileInput {
  tutor_student_id: string;
  name: string;
  telegram_username: string;
  learning_goal: string;
  grade?: number;
  exam_type?: 'ege' | 'oge';
  subject?: string;
  start_score?: number;
  target_score?: number;
  parent_contact?: string;
  notes?: string;
}

export interface UpdateTutorStudentProfileResponse {
  success: boolean;
}
```

### 4. Добавить клиентскую функцию

В `src/lib/tutors.ts`:
```typescript
export async function updateTutorStudentProfile(
  input: UpdateTutorStudentProfileInput
): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tutor-update-student`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(input),
    }
  );

  return response.ok;
}
```

### 5. Деплой

Задеплоить функцию `tutor-update-student`.

---

## Техническая секция

### Структура Edge Function

```typescript
// supabase/functions/tutor-update-student/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Проверить авторизацию
  // 2. Получить tutor_id по user_id
  // 3. Проверить, что tutor_student принадлежит репетитору
  // 4. Получить student_id из tutor_students
  // 5. Обновить profiles (service_role)
  // 6. Обновить tutor_students
  // 7. Вернуть { success: true }
});
```

### Файлы для изменения

| Файл | Действие |
|------|----------|
| `supabase/functions/tutor-update-student/index.ts` | Создать |
| `supabase/config.toml` | Добавить секцию |
| `src/types/tutor.ts` | Добавить интерфейсы |
| `src/lib/tutors.ts` | Добавить функцию |

