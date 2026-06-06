# Выкатка Тренировочного варианта 5 (физика ЕГЭ-2026) — runbook

`variant_id` = **`03660fb4-5247-5376-a0e9-2eb5faae844e`** (uuid5, детерминирован).

План варианта от Егора: **Часть 1 (1–20)** из Варианта 4, **№21/22/24** из Варианта 2, **№23** из Варианта 4, **№25** из присланного скриншота, **№26** из Варианта 1.

Seed оформлен миграцией `supabase/migrations/20260606120000_seed_mock_exams_variant_5.sql` → применится автоматически при push в main.

---

## ⚠️ Важные нюансы

1. **Задача 25 — полное решение Егора получено 2026-06-06** (геометрия рассеивающей линзы с диафрагмой, ответ **D = 40 см**). `solution_text` зафиксирован в `variant5-tasks.json` с LaTeX-формулами; миграция вставит его в БД. Если хочешь добавить картинку решения (2 скриншота из чата с диаграммой хода лучей), смотри блок «Что осталось для Claude Code» ниже.

2. **Задача 14 — на фигуре в V4-исходнике подписана только точка C** (метки A и B оказались за границей canvas EMF при конвертации, как было с image17 V2). Авточекер не страдает (ответ `45` сверяется по тексту), но ученик может задать вопрос. Если критично — Егор может прислать «правильную» картинку, заменим через Storage без миграций.

3. **Кнопка «По критериям ФИПИ» в кабинете репетитора убрана** (`TutorMockExamReview.tsx`) — Часть 1 авто-проверяется по ФИПИ 2026 partial credit на сабмите. UX-улучшение из feedback Егора 2026-06-06.

---

## Шаги выкатки — 3 действия

### Шаг 1 — Закоммитить и запушить

Изменённые/новые файлы:
- `supabase/migrations/20260606120000_seed_mock_exams_variant_5.sql` — авто-применяемый seed
- `supabase/seed/mock_exams_variant_5.sql` — артефакт
- `src/pages/tutor/mock-exams/TutorMockExamCreate.tsx` — Вариант 5 в каталоге
- `docs/delivery/features/mock-exams-v1/source/variant5-tasks.json` + `variant5/` (12 картинок)

```bash
cd C:\Users\kamch\sokratai
git add -A
git commit -m "feat(mock-exams): add Тренировочный вариант 5 (микс V4+V2+V1 для Егора)"
git push origin main
```

→ Lovable Cloud применит миграцию (вставит вариант + 26 задач). Lovable preview обновит фронт автоматически.

### Шаг 2 — Залить 12 картинок в Storage

Bucket **`mock-exam-variant-tasks`**, папка **`variant5/`** (создай папку). Файлы готовы в `docs/delivery/features/mock-exams-v1/source/variant5/` (и в `outputs/variant5-figures/` для удобства).

| Файл (имя в Storage) | Задача | Источник |
|---|---|---|
| `image1.png` | №1 — график $v_x(t)$ | V4 |
| `image6_situation.png` | №6 — диаграмма запуска (v₀, α, h, оси x–y) | V4 (PDF-crop) |
| `image6_a.png` | №6 — график А (U-shape кривая) | V4 (PDF-crop) |
| `image6_b.png` | №6 — график Б (горизонтальная линия) | V4 (PDF-crop) |
| `image8.png` | №8 — p–V диаграмма с 4 процессами | V4 |
| `image11.png` | №11 — график I(U) | V4 (PDF-crop) |
| `image13.png` | №13 — цепь с L, Lₓ, C, ключ K | V4 |
| `image14.png` | №14 — линии напряжённости + пластина + C | V4 (PDF-crop, без меток A/B — см. ⚠️) |
| `image16.png` | №16 — фрагмент таблицы Менделеева | V4 |
| `image17.png` | №17 — диаграмма энергетических уровней | V4 (PDF-crop) |
| `image19.jpeg` | №19 — фото вольтметра | V4 |
| `image21.png` | №21 — цикл p–T | V2 (повторно) |
| `image22.png` | №22 — стакан с шаром в двух жидкостях | V2 (повторно) |
| `image24.png` | №24 — цикл p–V (изобара/изохора/адиабата) | V2 (повторно) |

Имена должны точно совпадать — seed ссылается на `storage://mock-exam-variant-tasks/variant5/<имя>`.

### Шаг 3 — Деплой фронтенда

```
ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182
deploy-sokratai
```

---

## Без PDF варианта

Для V5 **не нарезаем** `variant_pdf_url` (нет единого исходного docx — задачи собраны из разных вариантов). Ученик может пройти только в **form-режиме** (ввод ответов на сайте). Кнопка «скачать бланк» не покажется. Если Егор захочет печатный бланк — соберём отдельно как агрегированный PDF.

## Шаг 4 — Проверка (Lovable Studio → SQL editor)

```sql
SELECT COUNT(*) FROM public.mock_exam_variant_tasks
 WHERE variant_id = '03660fb4-5247-5376-a0e9-2eb5faae844e';            -- = 26

SELECT kim_number, correct_answer
 FROM public.mock_exam_variant_tasks
 WHERE variant_id = '03660fb4-5247-5376-a0e9-2eb5faae844e' AND part = 1
 ORDER BY kim_number;
-- Ожидаем: 1=0, 2=250, 3=30, 4=1,8, 5=135, 6=43, 7=4, 8=2, 9=35, 10=22,
--         11=3, 12=2, 13=2,25, 14=45, 15=23, 16=29, 17=31, 18=145, 19=3,00,2, 20=25

SELECT kim_number, solution_text IS NOT NULL AS has_sol
 FROM public.mock_exam_variant_tasks
 WHERE variant_id = '03660fb4-5247-5376-a0e9-2eb5faae844e' AND part = 2
 ORDER BY kim_number;
-- Ожидаем все has_sol = TRUE, но №25 = placeholder, заменить от Егора.
```

Затем зайди репетитором → «Назначить пробник» → выбери **Тренировочный 5** (бейдж «Новый»). Превью должно показать все 26 задач с картинками. Назначь тестовому ученику, пройди Часть 1 — авточекер должен корректно засчитать ответы.
