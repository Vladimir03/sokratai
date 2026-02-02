
# План: Исправление проблем дашборда репетитора

## Выявленные проблемы

### Проблема 1: Зависание скелетонов на дашборде
**Симптом**: Дашборд репетитора показывает скелетоны бесконечно, данные не загружаются.

**Причина**: Хуки `useTutor()`, `useTutorStudents()`, `useTutorPayments()` делают цепочечные запросы:
1. Сначала `getCurrentTutor()` получает профиль репетитора
2. Затем `getTutorStudents()` снова вызывает `getCurrentTutor()` внутри себя
3. То же с `getTutorPayments()`

Каждый хук независимо вызывает `getCurrentTutor()`, что создаёт **3 одинаковых запроса** на каждой странице. При нестабильном соединении это может привести к таймаутам.

### Проблема 2: Редирект на главную при переходе на "Оплаты"
**Симптом**: При клике на вкладку "Оплаты" пользователя выбрасывает на главную страницу.

**Причина**: `TutorGuard` на каждой странице заново проверяет роль через RPC `is_tutor`. Если запрос выдаёт ошибку (таймаут), срабатывает `navigate("/")`.

### Проблема 3: RegisterTutor редиректит неверно (дополнительно)
**Симптом**: При переходе на `/register-tutor` авторизованного пользователя (ученика) выбрасывает на главную.

**Причина**: `RegisterTutor.tsx` редиректит любую активную сессию на `/tutor/dashboard`, не проверяя роль.

---

## Решения

### Решение 1: Добавить обработку ошибок и таймаутов в хуки

**Файл**: `src/lib/tutors.ts`

Изменения:
- Добавить кэширование профиля репетитора в памяти (в рамках сессии)
- Избежать повторных запросов `getCurrentTutor()` в каждом хуке

```typescript
// Кэш профиля репетитора (в памяти)
let cachedTutor: Tutor | null = null;
let cachedTutorUserId: string | null = null;

export async function getCurrentTutor(): Promise<Tutor | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    cachedTutor = null;
    cachedTutorUserId = null;
    return null;
  }
  
  // Возвращаем кэш если user_id не изменился
  if (cachedTutor && cachedTutorUserId === user.id) {
    return cachedTutor;
  }

  const { data, error } = await supabase
    .from('tutors')
    .select('*')
    .eq('user_id', user.id)
    .single();
  
  if (error) {
    console.error('Error fetching tutor:', error);
    return null;
  }
  
  cachedTutor = data as Tutor;
  cachedTutorUserId = user.id;
  return cachedTutor;
}

// Функция для сброса кэша (при выходе из аккаунта)
export function clearTutorCache() {
  cachedTutor = null;
  cachedTutorUserId = null;
}
```

### Решение 2: Улучшить TutorGuard с повторными попытками

**Файл**: `src/components/TutorGuard.tsx`

Изменения:
- Добавить retry-логику для RPC-запроса
- Добавить таймаут с понятным сообщением об ошибке
- Показывать кнопку "Повторить" при ошибке вместо редиректа

```typescript
const TutorGuard = ({ children }: TutorGuardProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkAccess = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/login");
        return;
      }

      // Retry logic для нестабильного соединения
      let retries = 2;
      let isTutor = false;
      let lastError = null;
      
      while (retries >= 0) {
        const { data, error } = await supabase.rpc("is_tutor", { 
          _user_id: session.user.id 
        });
        
        if (!error) {
          isTutor = data;
          break;
        }
        
        lastError = error;
        retries--;
        if (retries >= 0) {
          await new Promise(r => setTimeout(r, 1000)); // Ждём 1 сек
        }
      }

      if (lastError && retries < 0) {
        console.error("Error checking tutor role after retries:", lastError);
        setError("Ошибка проверки доступа. Попробуйте ещё раз.");
        return;
      }

      if (!isTutor) {
        navigate("/");
        return;
      }

      setAuthorized(true);
    } catch (error) {
      console.error("Error in TutorGuard:", error);
      setError("Ошибка соединения. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    checkAccess();
    // ... subscription
  }, [checkAccess]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <Button onClick={checkAccess}>Повторить</Button>
        </div>
      </div>
    );
  }
  
  // ... rest
};
```

### Решение 3: Исправить RegisterTutor с проверкой роли

**Файл**: `src/pages/RegisterTutor.tsx`

Изменения:
- Проверять роль перед редиректом
- Редиректить только репетиторов

```typescript
useEffect(() => {
  const checkSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Проверяем, является ли пользователь репетитором
      const { data: isTutor } = await supabase.rpc("is_tutor", { 
        _user_id: session.user.id 
      });
      
      if (isTutor) {
        navigate("/tutor/dashboard");
      }
      // Если не репетитор — показываем форму регистрации
    }
  };
  checkSession();
}, [navigate]);
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/lib/tutors.ts` | Добавить кэширование `getCurrentTutor()` |
| `src/components/TutorGuard.tsx` | Добавить retry-логику и UI ошибки |
| `src/pages/RegisterTutor.tsx` | Проверять роль перед редиректом |

---

## Порядок выполнения

1. **Сначала**: Исправить `RegisterTutor.tsx` — это самое простое и критичное
2. **Затем**: Добавить retry в `TutorGuard.tsx` — предотвращает редирект при таймаутах
3. **Затем**: Добавить кэширование в `tutors.ts` — оптимизация для медленных соединений

---

## Ожидаемый результат

| Сценарий | Было | Станет |
|----------|------|--------|
| Репетитор на медленном соединении | Скелетоны зависают | Данные загружаются (с кэшем) |
| Таймаут при проверке роли | Редирект на `/` | Показ кнопки "Повторить" |
| Ученик на `/register-tutor` | Редирект на `/` через дашборд | Показ формы регистрации |
| Репетитор на `/register-tutor` | Редирект на дашборд | Редирект на дашборд ✓ |

---

## Технические детали

- Кэш репетитора хранится в памяти модуля и сбрасывается при перезагрузке страницы
- Retry делает до 3 попыток с интервалом 1 секунда
- При ошибке показывается понятное сообщение на русском языке
