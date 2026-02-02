

# План: Добавление входа для репетиторов на главную страницу

## Текущее состояние

| Элемент | Сейчас | Проблема |
|---------|--------|----------|
| Главная Hero | CTA для учеников (Telegram + браузер) | Репетиторам некуда нажать |
| Навигация | Только якоря на секции | Нет кнопок "Войти" |
| Footer | Контакты + юридические ссылки | Нет входа для репетиторов |
| `/login` | Универсальный вход | Работает, но не очевиден путь |
| `/register-tutor` | Существует | Никак не доступна с главной |

## UX-решение: Два пути входа

```text
+------------------------------------------------------------------+
|  [Логотип Сократ]                            [Войти ▼]           |
+------------------------------------------------------------------+
                                                   │
                                                   ▼
                                          ┌─────────────────┐
                                          │  Я ученик       │
                                          │  Я репетитор    │
                                          └─────────────────┘
```

**Концепция:** Добавить в навигацию главной страницы dropdown-меню "Войти", которое показывает два варианта:
- **Я ученик** → `/login`  
- **Я репетитор** → `/login` (после входа редиректит на `/tutor/dashboard`)

**Почему один `/login` для всех:**
- Текущий код `Login.tsx` уже проверяет роль и редиректит репетиторов на дашборд
- Не нужно дублировать логику
- Меньше путаницы для пользователей

## Изменения

### 1. Index.tsx — Добавить кнопку "Войти" в навигацию

**Было:**
```tsx
<nav className="sticky top-0 z-50 ...">
  <a href="#hero">Главная</a>
  <a href="#benefits">Преимущества</a>
  ...
</nav>
```

**Станет:**
```tsx
<nav className="sticky top-0 z-50 ...">
  <div className="container mx-auto flex justify-between items-center">
    {/* Левая часть — секции */}
    <div className="flex overflow-x-auto">
      <a href="#hero">Главная</a>
      ...
    </div>
    
    {/* Правая часть — вход */}
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <LogIn className="w-4 h-4 mr-2" />
          Войти
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link to="/login">
            <BookOpen className="w-4 h-4 mr-2" />
            Я ученик
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/login">
            <GraduationCap className="w-4 h-4 mr-2" />
            Я репетитор
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</nav>
```

### 2. Footer.tsx — Добавить секцию для репетиторов

**Добавить перед "Реквизиты":**
```tsx
{/* Для репетиторов */}
<div className="mb-8">
  <p className="text-sm text-white/60 mb-2">Вы репетитор?</p>
  <div className="flex justify-center gap-4">
    <Link 
      to="/login" 
      className="text-accent hover:text-accent/80 transition-colors"
    >
      Войти
    </Link>
    <Link 
      to="/register-tutor" 
      className="text-accent hover:text-accent/80 transition-colors"
    >
      Зарегистрироваться
    </Link>
  </div>
</div>
```

### 3. Login.tsx — Добавить ссылку на регистрацию репетитора

**Было:**
```tsx
<p>
  Нет аккаунта?{" "}
  <Link to="/signup">Зарегистрироваться</Link>
</p>
```

**Станет:**
```tsx
<p>
  Нет аккаунта?{" "}
  <Link to="/signup">Зарегистрироваться</Link>
</p>
<p className="text-muted-foreground text-center">
  Вы репетитор?{" "}
  <Link to="/register-tutor" className="text-primary hover:underline">
    Регистрация репетитора
  </Link>
</p>
```

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/pages/Index.tsx` | Добавить dropdown "Войти" в навигацию |
| `src/components/sections/Footer.tsx` | Добавить секцию для репетиторов |
| `src/pages/Login.tsx` | Добавить ссылку на `/register-tutor` |

## Визуальная структура

### Навигация (desktop)
```text
┌─────────────────────────────────────────────────────────────────┐
│ Главная | Преимущества | Как работает | ... | FAQ    [Войти ▼] │
└─────────────────────────────────────────────────────────────────┘
                                                        └──> Dropdown:
                                                             📚 Я ученик
                                                             🎓 Я репетитор
```

### Навигация (mobile)
```text
┌─────────────────────────────────────────────────────────────────┐
│ Главная | Преимущества | ...                          [Войти ▼] │
└─────────────────────────────────────────────────────────────────┘
```

### Footer
```text
┌─────────────────────────────────────────────────────────────────┐
│                         [Логотип Сократ]                        │
│                                                                 │
│                    📧 Контакты и описание                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│                     Вы репетитор?                               │
│                   [Войти] [Регистрация]                         │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│              Реквизиты | Оферта | Политика                      │
│                    © 2025 Сократ                                │
└─────────────────────────────────────────────────────────────────┘
```

## UX-преимущества

1. **Чёткое разделение аудиторий** — Dropdown сразу спрашивает "кто вы?"
2. **Единая точка входа** — Обе роли используют один `/login`, система сама определит, куда редиректить
3. **Видимость для репетиторов** — Footer явно приглашает репетиторов
4. **Минимальные изменения** — Используем существующую инфраструктуру (`/login` уже проверяет роль)

## Технические детали

### Импорты для Index.tsx
```typescript
import { Link } from "react-router-dom";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { BookOpen, GraduationCap, LogIn, ChevronDown } from "lucide-react";
```

### Адаптивность
- На desktop: dropdown справа в навигации
- На mobile: dropdown тоже справа, но компактнее
- Используем `flex justify-between` для разделения секций и кнопки входа

