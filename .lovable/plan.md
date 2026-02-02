
# План: Исправление ссылок для репетиторов на /register-tutor

## Проблема

При выборе "Я репетитор" в dropdown-меню открывается страница `/login` (для учеников), хотя должна открываться `/register-tutor`.

## Места для исправления

| Файл | Строка | Текущее | Исправить на |
|------|--------|---------|--------------|
| `src/pages/Index.tsx` | 107 | `/login` | `/register-tutor` |
| `src/pages/Index.tsx` | 221 | `/login` | `/register-tutor` |
| `src/components/sections/Footer.tsx` | 89 | `/login` | `/register-tutor` |

## Изменения

### 1. Index.tsx — Навигация "Войти"

**Было (строка 106-110):**
```tsx
<DropdownMenuItem asChild>
  <Link to="/login" className="flex items-center gap-2 cursor-pointer">
    <GraduationCap className="w-4 h-4" />
    Я репетитор
  </Link>
</DropdownMenuItem>
```

**Станет:**
```tsx
<DropdownMenuItem asChild>
  <Link to="/register-tutor" className="flex items-center gap-2 cursor-pointer">
    <GraduationCap className="w-4 h-4" />
    Я репетитор
  </Link>
</DropdownMenuItem>
```

### 2. Index.tsx — Кнопка "Открыть в браузере"

**Было (строка 220-224):**
```tsx
<DropdownMenuItem asChild>
  <Link to="/login" className="flex items-center gap-2 cursor-pointer">
    <GraduationCap className="w-4 h-4" />
    Я репетитор
  </Link>
</DropdownMenuItem>
```

**Станет:**
```tsx
<DropdownMenuItem asChild>
  <Link to="/register-tutor" className="flex items-center gap-2 cursor-pointer">
    <GraduationCap className="w-4 h-4" />
    Я репетитор
  </Link>
</DropdownMenuItem>
```

### 3. Footer.tsx — Ссылка "Войти" для репетиторов

**Было (строка 88-93):**
```tsx
<Link 
  to="/login" 
  className="text-accent hover:text-accent/80 transition-colors font-medium"
>
  Войти
</Link>
```

**Станет:**
```tsx
<Link 
  to="/register-tutor" 
  className="text-accent hover:text-accent/80 transition-colors font-medium"
>
  Войти
</Link>
```

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/pages/Index.tsx` | Заменить `/login` на `/register-tutor` в 2 местах (строки 107 и 221) |
| `src/components/sections/Footer.tsx` | Заменить `/login` на `/register-tutor` (строка 89) |

## Логика

- Страница `/register-tutor` уже содержит форму регистрации И возможность входа через Telegram
- Для репетиторов это правильная точка входа, т.к.:
  - Новые репетиторы — регистрируются
  - Существующие репетиторы — могут войти через Telegram или перейти на `/login` по ссылке "Уже есть аккаунт?"
