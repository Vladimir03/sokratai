# Промпт код-ревью: онлайн-доска, этапы 3–4 (вход ученика/гостя, живой синк, follow/bring)

Скопируй всё ниже в ChatGPT-5.6 (VSCode, репозиторий открыт).

---

Ты — независимый старший ревьюер. Проверь этапы 3–4 онлайн-доски SokratAI: вход ученика и гостя, снапшот-синк с reconcile, оптимистическая блокировка rev, live-канал follow/bring/курсоры. Этапы 1–2 уже прошли твоё ревью; его 3 P0 закрыты фикс-пассом — проверь и КАЧЕСТВО этих закрытий.

## Скоуп (изменённые файлы)

Клиент:
- `src/lib/whiteboard/reconcile.ts` + `reconcile.test.ts` — LWW-слияние (version/versionNonce, тай-брейк меньшим nonce, щит активного редактирования)
- `src/lib/whiteboard/boardRealtime.ts` — Realtime по сигнальной `board_page_revs`
- `src/lib/whiteboard/boardLive.ts` + `boardLive.test.ts` — broadcast/presence канал: viewport/cursor/bring/follow, троттлинг, `stablePeerColor`, `shouldApplyBring`
- `src/lib/whiteboard/frameRows.ts`, `src/lib/whiteboardStudentApi.ts`, `src/lib/whiteboardPublicApi.ts`, `src/lib/whiteboardApi.ts`
- `src/components/whiteboard/SharedBoardView.tsx` — общий вью ученика/гостя (транспорт-инъекция), live-интеграция
- `src/pages/student/StudentBoard.tsx`, `src/pages/GuestBoard.tsx`, `src/pages/tutor/Whiteboard.tsx` (реврайт синка/409/live), `src/components/whiteboard/BoardCanvas.tsx` (курсоры, подписи screen-space, ghost-tap, hidden-скоуп), `src/App.tsx` (роуты `/student/board/:id`, `/b/:slug`)

Сервер:
- `supabase/functions/whiteboard-api/index.ts` — CAS-сохранение через RPC, `POST /boards/:id/bring`, create-with-elements
- `supabase/functions/whiteboard-student-api/index.ts` — `GET /boards/:id/me`, живое участие на записи, фильтр подписи картинок
- `supabase/functions/whiteboard-public/index.ts` — гостевые роуты, X-Guest-Token, двухуровневый троттл, bring в /signals
- `supabase/migrations/20260730140000_whiteboard_save_cas.sql` (RPC `wb_save_page_elements`/`wb_bump_page_rev`), `20260730150000_whiteboard_live_bring.sql` (`boards.live_bring`)

## Что проверять (в порядке приоритета)

1. **Гонки синка.** Атомарность CAS-RPC (`FOR UPDATE`, бутстрап rev=0, семантика NULL base_rev), пути 409 у всех трёх писателей, двухпопыточный reconcile-retry в `AutosaveQueue.savePage` (обе поверхности), «свой rev» против «чужого» в realtime-хендлерах (`rev >= knownRev`), gap-fill на reconnect. Ищи: lost update, затирание локальной грязи, вечный цикл 409, расхождение rev клиента и сервера, воскрешение удалённого (известное ограничение — но проверь, что оно НЕ хуже заявленного).
2. **Безопасность гостя и ученика.** Bearer-модель slug/guest_token (заголовок, троттлы, отзыв), живое участие на КАЖДОЙ записи (убранный из группы = read-only), фильтр подписи картинок по `tutor/<uid>/<boardId>/` в обоих edge, anti-leak `/me` (полное участие, 404), `boards.live_bring` не утекает клиентам мимо edge, RPC service_role-only (тройной REVOKE). Извеcтное принятое решение владельца: гость сам выбирает «я — Маша» без PIN — НЕ флагать как P0, но флагай любые НОВЫЕ векторы поверх него.
3. **Live-канал (Этап 4).** Общий broadcast-топик (намеренно), presence re-track после обрыва, троттлинг viewport/cursor и «только при слушателях», дедуп bring по seq + окно свежести 2 мин (гость получает bring поллингом — проверь двойное применение broadcast+поллинг у УЧЕНИКА исключено), follow: авто-выход по own-pan/зум-кнопкам/уходу участника, бейдж гаснет по таймауту без пинга. Ищи: утечки интервалов/каналов при unmount, setState после unmount, спам-канал при смене deps эффекта (например, пере-подключение канала на каждый resync).
4. **Перфоманс.** frameViews в useMemo (не зависят от камеры), LOD-бакет, hidden-скоуп на рамку жеста, курсорный слой и подписи вне memo-слоёв, частота setState от курсоров (5 Гц × N участников). Бюджет: INP < 200 мс на сцене 800 штрихов × 10 листов.
5. **Cross-browser (rule 80).** Safari 15/iOS 15: без lookbehind/structuredClone/Array.at/Object.hasOwn/crypto.randomUUID в новом коде; 16px инпуты; touch-action; поведение pointer events на iOS (ghost-tap slop, pinch vs pan с ячейки).
6. **Контракты.** rule 97 (все non-2xx — JSON с русской фразой), rule 96 (все signed URL наружу — rewriteToProxy; никакого `*.supabase.co` в клиенте), rule 60 (FK-дрейф tutor_id/tutor_students), идемпотентность миграций (Lovable кладёт дубль-копии).

## Формат ответа

- Сводка 3 строки.
- Находки: `[P0/P1/P2] заголовок — файл:строка — что ломается, при каких условиях, минимальный фикс`. P0 = потеря данных/утечка/дыра доступа; P1 = реальный сбой урока; P2 = качество.
- Отдельно: «что прошло проверку» (коротко) и вердикт APPROVE / REQUEST CHANGES.
- Прогони сам: `npm run build`, `npm run smoke-check`, `npx vitest run` — приложи результаты. Файлы не менять.
- Обязательно перечисли, какие П0/П1 из твоего прошлого ревью этапов 1–2 ты считаешь закрытыми корректно, а какие — нет.
