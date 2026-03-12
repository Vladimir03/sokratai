

## Диагноз

Таблицы `kb_folders`, `kb_tasks` и остальные KB-таблицы **существуют** в БД. FK `kb_folders_parent_id_fkey` тоже существует. Проблема в **PostgREST**: он не может разрешить self-referencing FK через hint `kb_folders!kb_folders_parent_id_fkey` в schema cache — возвращает 400 с ошибкой `"Could not find a relationship between 'kb_folders' and 'kb_folders'"`.

Это известная проблема PostgREST с self-referencing foreign keys в embedded selects.

## Исправление

**Файл: `src/hooks/useFolders.ts`** — заменить embedded self-join на отдельные запросы.

### 1. `fetchRootFolders()` (строки 58–78)

Вместо:
```ts
.select('*, kb_folders!kb_folders_parent_id_fkey(count), kb_tasks(count)')
```

Делаем два отдельных запроса: основной `select('*')` и потом для каждой папки считаем children/tasks отдельно. Или проще — один запрос `select('*')`, а counts считаем двумя агрегирующими запросами:

```ts
const [foldersRes, childCountsRes, taskCountsRes] = await Promise.all([
  supabase.from('kb_folders').select('*').eq('owner_id', userId).is('parent_id', null).order('sort_order'),
  supabase.from('kb_folders').select('parent_id').eq('owner_id', userId).not('parent_id', 'is', null),
  supabase.from('kb_tasks').select('folder_id').not('folder_id', 'is', null),
]);
```

Затем считаем counts на клиенте через `reduce`.

### 2. `fetchFolder()` (строки 93–130)

Аналогично: заменить `childrenRes` запрос — убрать `kb_folders!kb_folders_parent_id_fkey(count)`, вместо этого считать child counts и task counts отдельными запросами.

### Итого

- Только фронтенд-изменения в `src/hooks/useFolders.ts`
- Никаких миграций не нужно — таблицы и FK уже на месте
- Убираем PostgREST embedded self-join, заменяем на параллельные count-запросы

