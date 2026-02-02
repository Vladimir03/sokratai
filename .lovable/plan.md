

## План: Dropdown на кнопке "Открыть в браузере" для выбора роли

### UX-анализ

**Текущее поведение:**
- Кнопка "Открыть в браузере" → переход на `/chat` (для учеников)
- Репетиторам непонятно, куда нажимать

**Проблема с простым копированием dropdown:**
- Если сделать точно как "Войти" → будет избыточно (2 одинаковых dropdown рядом)
- Пользователь уже выбрал "браузер" — ему нужен только выбор роли

### Лучшее UX-решение

Сделать dropdown на кнопке "Открыть в браузере" с двумя вариантами:

```text
┌─────────────────────────────────┐
│  🌐 Открыть в браузере ▼        │
└─────────────────────────────────┘
              │
              ▼
     ┌────────────────────┐
     │ 📚 Я ученик        │ → /chat
     │ 🎓 Я репетитор     │ → /login (потом на /tutor/dashboard)
     └────────────────────┘
```

**Почему это лучший UX:**

1. **Один клик для выбора платформы + роли** — не нужно сначала выбрать "браузер", потом искать "Войти"
2. **Контекстно понятно** — пользователь понимает, что это вход через браузер
3. **Репетитор сразу видит свой путь** — не нужно скроллить до футера или искать "Войти"
4. **Для ученика** — /chat работает без авторизации, поэтому ведём сразу на чат
5. **Для репетитора** — /login → после входа автоматический редирект на /tutor/dashboard

### Изменения в коде

**Файл:** `src/pages/Index.tsx`

**Было (строки 201-210):**
```tsx
<Link to="/chat">
  <Button size="lg" className="...">
    <Globe className="w-5 h-5 mr-2" />
    Открыть в браузере
  </Button>
</Link>
```

**Станет:**
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button
      size="lg"
      className="bg-white/10 backdrop-blur-sm border-2 border-white/30 text-white hover:bg-white/20 text-base md:text-lg px-8 py-6 rounded-2xl font-semibold transition-all hover:scale-105 w-full sm:w-auto"
    >
      <Globe className="w-5 h-5 mr-2" />
      Открыть в браузере
      <ChevronDown className="w-4 h-4 ml-2" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent 
    align="center" 
    className="w-56 bg-white dark:bg-gray-800"
  >
    <DropdownMenuItem asChild>
      <Link to="/chat" className="flex items-center gap-2 cursor-pointer">
        <BookOpen className="w-4 h-4" />
        Я ученик
      </Link>
    </DropdownMenuItem>
    <DropdownMenuItem asChild>
      <Link to="/login" className="flex items-center gap-2 cursor-pointer">
        <GraduationCap className="w-4 h-4" />
        Я репетитор
      </Link>
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Визуальный результат

```text
Hero секция:
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│   🎯 ИИ-помощник по математике...                             │
│                                                               │
│   ┌─────────────────────┐  ┌─────────────────────────┐        │
│   │ 📤 Открыть в        │  │ 🌐 Открыть в браузере ▼ │        │
│   │    Telegram         │  └─────────────────────────┘        │
│   └─────────────────────┘           │                         │
│                                     ▼                         │
│                            ┌──────────────────┐               │
│                            │ 📚 Я ученик      │               │
│                            │ 🎓 Я репетитор   │               │
│                            └──────────────────┘               │
│                                                               │
│   📱 Telegram — удобнее на телефоне • 🖥️ Веб — для больших    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/pages/Index.tsx` | Заменить `<Link>` на `<DropdownMenu>` для кнопки "Открыть в браузере" |

### Дополнительные UX-улучшения

- Добавить `ChevronDown` иконку на кнопку, чтобы было понятно, что это dropdown
- Dropdown открывается по центру относительно кнопки (`align="center"`)
- Контрастный белый фон для dropdown (хорошо читается на тёмном hero)

