

# План: Исправление ошибки сборки и деплой Edge Functions

## 1. Исправить ошибку TypeScript

В файле `src/types/tutor.ts` дублируется поле `learning_goal` в интерфейсе `ManualAddTutorStudentInput`:

```typescript
// Было (строки 56-68):
export interface ManualAddTutorStudentInput {
  name: string;
  telegram_username: string;
  learning_goal: string;       // строка 59
  grade?: number;
  exam_type?: 'ege' | 'oge';
  subject?: string;
  start_score?: number;
  target_score?: number;
  notes?: string;
  parent_contact?: string;
  learning_goal?: string;      // строка 67 — дубликат!
}
```

**Решение**: Удалить дублирующую строку 67 (`learning_goal?: string;`).

## 2. Обновить config.toml

Добавить конфигурацию для новой Edge Function:

```toml
[functions.tutor-manual-add-student]
verify_jwt = true
```

## 3. Задеплоить Edge Functions

Две функции требуют деплоя:

| Функция | Описание |
|---------|----------|
| `tutor-manual-add-student` | Ручное добавление ученика по Telegram username |
| `telegram-bot` | Обновлённая логика автопривязки по telegram_username |

---

## Техническая секция

### Порядок действий

1. **Удалить дублирующее поле** в `src/types/tutor.ts` (строка 67)
2. **Добавить конфиг** в `supabase/config.toml` для `tutor-manual-add-student`
3. **Деплой функций** после исправления ошибки сборки

### Финальный интерфейс

```typescript
export interface ManualAddTutorStudentInput {
  name: string;
  telegram_username: string;
  learning_goal: string;  // обязательное поле — единственное
  grade?: number;
  exam_type?: 'ege' | 'oge';
  subject?: string;
  start_score?: number;
  target_score?: number;
  notes?: string;
  parent_contact?: string;
}
```

