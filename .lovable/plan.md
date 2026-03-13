

## Анализ

Код в `TutorAssistant.tsx` выглядит корректно (`sm:grid-cols-3`), но в Lovable preview карточки отображаются в стопку. Две вероятные причины:

1. **Card component добавляет `animate-in fade-in slide-in-from-bottom-2`** по умолчанию — это может конфликтовать с grid layout в момент анимации входа.
2. **`hover:bg-accent/50`** на карточках — `--accent` равен зелёному (`142 76% 36%`), отсюда зелёный фон при hover.

## План исправления

### 1. TutorAssistant — отключить animation на Card

В `src/pages/tutor/TutorAssistant.tsx` — добавить `animate={false}` на каждую `<Card>`, чтобы убрать `animate-in` класс, который может ломать grid:

```tsx
<Card
  key={job.title}
  animate={false}
  className="cursor-pointer transition-colors hover:border-socrat-primary/50 hover:bg-accent/50"
>
```

### 2. База знаний — аналогичная проверка

Проверить `TopicCard`, `FolderCard` и другие KB-компоненты на наличие Card с дефолтной анимацией и отключить где нужно.

Если после отключения анимации grid по-прежнему не работает — проблема в кеше preview, и потребуется hard refresh.

