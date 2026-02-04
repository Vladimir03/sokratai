

# План: Создание компонента AddStudentDialog

## Проблема

Build ошибки в `TutorStudents.tsx` и `TutorDashboard.tsx`:
```
Cannot find module '@/components/tutor/AddStudentDialog'
```

Компонент упоминается в коде, но файл не существует в директории `src/components/tutor/`.

## Решение

Создать компонент `AddStudentDialog.tsx` с двумя вкладками:
1. **По ссылке** — QR-код и копирование инвайт-ссылки
2. **Вручную** — форма для ручного добавления ученика

## Интерфейс компонента

На основе использования в `TutorStudents.tsx` и `TutorDashboard.tsx`:

```typescript
interface AddStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteCode: string | undefined;
  inviteWebLink: string;
  inviteTelegramLink: string;
  onManualAdded: (tutorStudentId: string) => void;
}
```

## Структура компонента

```text
┌─────────────────────────────────────────────┐
│  Добавить ученика                      [X]  │
├─────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────────────┐  │
│  │  По ссылке   │ │     Вручную          │  │
│  └──────────────┘ └──────────────────────┘  │
├─────────────────────────────────────────────┤
│                                             │
│  Вкладка "По ссылке":                      │
│    - QR-код (react-qr-code)                │
│    - Кнопка копирования веб-ссылки         │
│    - Кнопка открытия Telegram-ссылки       │
│                                             │
│  Вкладка "Вручную":                        │
│    - Имя ученика*                          │
│    - Telegram username*                    │
│    - Цель обучения*                        │
│    - Класс, Экзамен, Предмет               │
│    - Начальный/Целевой балл                │
│    - Контакт родителя, Заметки             │
│    - Кнопка "Добавить"                     │
│                                             │
└─────────────────────────────────────────────┘
```

## Зависимости

- `react-qr-code` — уже установлен
- `manualAddTutorStudent` — уже есть в `src/lib/tutors.ts`
- `ManualAddTutorStudentInput` — уже есть в `src/types/tutor.ts`

---

## Техническая секция

### Файл для создания

`src/components/tutor/AddStudentDialog.tsx`

### Импорты

```typescript
import { useState } from 'react';
import QRCode from 'react-qr-code';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, ExternalLink, Check, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { manualAddTutorStudent } from '@/lib/tutors';
import type { ManualAddTutorStudentInput } from '@/types/tutor';
```

### Логика вкладки "Вручную"

1. Форма с валидацией обязательных полей (name, telegram_username, learning_goal)
2. При сабмите — вызов `manualAddTutorStudent(input)`
3. При успехе — вызов `onManualAdded(response.tutor_student_id)` и закрытие диалога
4. При ошибке — показать toast с сообщением

### Экспорт

```typescript
export { AddStudentDialog };
```

