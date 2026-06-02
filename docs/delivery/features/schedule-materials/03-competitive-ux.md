# Конкурентный + UX/UI анализ — «Материалы в расписании» (schedule-materials)

**Дата:** 2026-06-02 · **Линза:** доставка занятий + материалов (запись/конспект/ДЗ) + student-хаб «мои занятия». Не EdTech вообще.
**Дополняет:** `docs/discovery/research/конкуренты/edtech_competitors_analysis.md` (позиционирование/геймификация — общий обзор). Этот файл — узкий разбор под фичу.
**Метод:** свежий веб-ресёрч (РФ + зарубеж, 2025-2026) с цитатами + reuse существующего разбора.

---

## 0. Главный вывод (gap = возможность)

**Никто на рынке РФ не закрывает связку {видеозапись + PDF-конспект + ДЗ}, привязанную к конкретному занятию и показанную ученику единой per-lesson лентой.**

- **Маркетплейс-школы** (Skyeng/Skysmart, Тетрика, Учи.Дома, Фоксфорд) — курсо/тетрадь-центричны. Критично: **видеозаписи 1:1 уроков нет** (Skyeng — только аудио, helpcenter art. 335).
- **Tutor-CRM** (AlfaCRM, HolliHop, Параплан, Repetitor.tech) — крепят файлы+ДЗ к уроку и показывают в кабинете ученика, но это generic «скачать файл», а не спроектированный хаб «Среда».
- **Ближайший прямой конкурент — Repetitor.tech** (CRM+LMS для частных репетиторов, Telegram-native, ДЗ в кабинете, PDF-отчёты, AI). Его стоит изучать пристально.
- **Маркетплейсы** (Профи.ру, Repetit.ru) — без LMS-хаба вообще: видео в Zoom/Skype, материалы по почте. Это статус-кво, который мы бьём.

Вывод: фича — не «догоняем», а **занимаем незанятую нишу**. Это повышает уверенность инвестировать в качественный student-хаб.

---

## 1. РФ — сравнение под нашу линзу

| Игрок | Расписание | Крепление к уроку (видео/PDF/ДЗ) | Student-хаб | ДЗ ↔ урок | Mobile + уведомления |
|---|---|---|---|---|---|
| **Skyeng/Skysmart** | Да, кабинет + напоминания | Материалы курса + ДЗ; **запись только аудио, видео нет** | Богатый кабинет: next lesson, ДЗ, прогресс, возврат к прошлым материалам | ДЗ привязано к курсу/уроку, интерактивная тетрадь | Родит. приложение: расписание/оценки/коммент + запись если пропустил |
| **Тетрика** | Да | Загрузка ДЗ + фидбэк; **материалы урока пере-смотрибельны** | Виртуальный класс + кабинет: расписание, материалы, доска, чат | Персональная программа ДЗ | Кабинет; чат до/после |
| **Учи.Дома** | Да, календарь | Материалы встроены; ДЗ в программе | Кабинет: прогресс (уроков пройдено/осталось) | ДЗ часть программы | Кабинет/календарь |
| **Фоксфорд** | Курсы/вебинары (мало 1:1) | Записи вебинаров + материалы | Role-based кабинет (ученик/родитель/учитель), пересмотр вебинаров | Курсовое ДЗ | Вход по коду email/SMS |
| **AlfaCRM** | Да, «Уроки»/календарь, recurring | **Да — скачать ДЗ + файлы по уроку**, ссылка-join | Кабинет: расписание, ДЗ, баланс, оценки, оплата; график ср.оценки (редизайн 2025) | ДЗ привязано к урокам | iOS/Android; **Push (2025)** + MAX-бот; онлайн-оплата |
| **HolliHop** | Да, recurring группы | LMS: конструктор курса, материалы, тесты, файлы через кабинет | Кабинет: расписание, оплаты, посещаемость, ДЗ; чаты | ДЗ в кабинете | Schoolmaster app; чат+файлы |
| **Параплан** | Да — все занятия (будущие/прошлые/перенос/отмена) | ДЗ + ссылки на вебинар; **интеграция Яндекс.Диск** для файлов | Кабинет: посещаемость, расписание, оплаты | ДЗ по ученику | Mobile; Telegram/WhatsApp; авто-уведомления |
| **Repetitor.tech** ⭐ | Да — уроки, invite, recurring | **Конструктор курса (главы→разделы→уроки), ДЗ с дедлайнами, тесты с автопроверкой + импорт Google Forms** | Кабинет: курсы, задачи, прогресс, расписание, оплаты; **родители видят всё**; авто PDF-отчёты | ДЗ привязано к курсу/уроку, дедлайны | Telegram/VK/OK в одном инбоксе; авто-напоминания об оплате |
| **Профи.ру / Repetit.ru** | Только бронь | **Нет LMS** — Zoom/Skype + материалы по почте | Аккаунт = заказы/сообщения, без хаба | Standalone | App для заказов |

*Честность: кабинеты за логином → раскладка per-lesson карточек выведена из доков/help, не из скринов. «Skyeng без видео» — helpcenter art. 335. Детали Параплан про ДЗ/ссылки — medium-confidence (агрегатор, не офиц. KB).*

---

## 2. Зарубеж — сравнение + эталон Google Classroom

| Продукт | Организация материалов | Главный student-вью | Статус ДЗ | Запись/видео | Mobile + уведомления |
|---|---|---|---|---|---|
| **Google Classroom** ⭐ | **Classwork по Topics** (сворачиваемые); элемент крепит Drive/YouTube/upload/link | Classwork (по темам) + Stream (хроно) + cross-class **To-do** (Assigned/Missing/Done); карточка класса = ≤3 due на неделе | Явные: **Assigned → Turned in → Graded/Returned** + Missing, Done late | Drive/YouTube как вложения (откр. в Drive/YT) | Нативные app; **guardian email digest** (день/неделя) |
| **TutorCruncher** | Per-lesson Lesson Reports + записи | Портал клиент/ученик: Lesson Reports | Через отчёты, менее гранулярно | Нативная запись в портале | Responsive портал |
| **TutorBird** | Файлы ученику (Resources) + per-lesson Lesson Notes + Homework | Портал: расписание, новости, заметки, ресурсы | **Homework**: ученик грузит, лог времени, вопросы; тьютор возвращает | Видео/аудио **стримится в портале**; Zoom/Meet URL на календаре | Авто-уведомление о новом ресурсе; Daily Agenda |
| **Teachworks** | Shared lesson notes + Attach Files add-on | Портал: календарь, история, инвойсы | Слабее (через заметки) | Внешнее; файлы через заметки | Заметки можно слать на email |
| **Preply** | Всё per-lesson: ДЗ, лексика, файлы, заметки «в одном месте» | My lessons / Home; после урока: Learn > Notes > урок = learning report | ДЗ в learning report урока | В классе; **доска недоступна после урока** | App для join; заметки/файлы持续; доска desktop-only |
| **Outschool** | Syllabus → Lessons → Posts + Assignments; пост = видео ≤1GB + worksheet | **Classroom-таб подсвечивает следующий урок** | Assignments под уроками | **Нативное видео** per post + записи (90 дней) | Learner Space; посты истекают 30 дней |
| **Canvas / Moodle** (LMS-эталон) | **Modules / Topics-секции** держат страницы, файлы, задания | Дашборд + **To-Do (≤7)** / линейные секции | Состояния заданий + To-Do/timeline | Файлы/URL/видео в модулях | Нативный app; гранулярные нотификации |
| **Khan / Brilliant** (только вовлечение) | n/a | daily-goal / mastery | n/a | n/a | **Streaks (Khan: daily→weekly на осмысленное действие), уровни, прогресс-бары** |

### Эталон — IA Google Classroom (берём щедро; у нас записи уже на Google Drive)

- **Три поверхности, чёткое разделение:** **Classwork** (долговременный «склад» материалов, по Topics) ↔ **Stream** (хроно-лента «что нового», материалы туда НЕ попадают) ↔ **To-do** (агрегатор ученика: Assigned/Missing/Done).
- **Topic = организующий примитив.** Учитель группирует материалы/задания по темам; **один topic на элемент**; **ученик видит только темы с опубликованным контентом** (пустые скрыты); drag-reorder; «No Topic» закреплён сверху; **collapse/expand + Collapse all**.
- **→ Для нас: каждое ЗАНЯТИЕ = Topic** («Урок 12 · Кинематика, 21 мар»), внутри 3 элемента: запись (link), конспект (PDF), ДЗ (assignment).
- **Единый «Add»:** файл/Drive/YouTube/ссылка — все first-class; вставка URL рендерит превью до добавления.
- **Машина состояний ДЗ:** Assigned → Turned in → Graded/Returned; авто Missing/Done late; фильтры; на карточке класса — **≤3 due на неделю** («что дальше» без открытия).

---

## 3. РФ-константы (HIGH IMPACT — меняют одно наше решение)

- **Google Drive под риском throttling/блокировки (2025-2026).** Google News заблокирован, YouTube де-факто замедлен; заявления Госдумы (Горелкин) про возможную блокировку Google-сервисов в 2026; политика — постепенное замедление ради миграции на РФ-аналоги. Drive-видео может грузиться нестабильно у RU-учеников.
  - **→ Решение: поле «запись» = ОБЫЧНЫЙ URL** (Google Drive / Яндекс.Диск / VK Video / YouTube / любой), не Drive-специфичный. Это и проще (Парето), и снимает риск блокировки. Параплан уже интегрирует Яндекс.Диск — это локальный дефолт.
- **Telegram официально замедлен (с 10.02.2026; звонки с авг-2025).** Доставка/диплинки Telegram могут быть нестабильны.
  - **→ Решение: каскад Push→Telegram→Email сохраняем, но НЕ полагаемся только на Telegram** — web-push + email = устойчивые fallback. Наш каскад (rule 70) уже спроектирован правильно. MAX (санкционированный РФ-мессенджер) — watch, не строить.

---

## 4. Что берём в Сократ (паттерны → наши поверхности)

**Student-лента «Среда»:**
1. **P0 — Занятие = одна сворачиваемая карточка с 3 «слотами» (запись/конспект/ДЗ)** + чипы статуса ДЗ. *(Classroom lesson-as-Topic; Preply «всё в одном».)*
2. **P0 — Якорь «сегодня» + «Ближайшие/Прошедшие» + закреп «ближайшие 1-3 ДЗ» сверху.** *(Outschool «next lesson», Canvas To-Do ≤7, Classroom ≤3 due.)*
3. **P0 — Две линзы, не свалка:** сегмент **[Занятия | Домашка]** — «Занятия» = расписание-склад, «Домашка» = to-do со ВСЕМИ активными ДЗ (привязанными + standalone). *(Classroom Classwork↔Stream↔To-do split.)*
4. **P1 — Collapse-all/expand-all, новейшее занятие авто-раскрыто.** *(Classroom/Moodle — длинные списки уроков у ЕГЭ-ученика 30+.)*
5. **P1 — Inline-превью PDF** (ученик не уходит со страницы); запись открывается в новой вкладке (ок).
6. **P0 — Пустые состояния:** «Домашка» показывает только реальные ДЗ; «Занятия» показывает **сам факт урока** (расписание = наша ось), но с «материалов пока нет». *(Дивергенция от Classroom осознанная: наш объект — занятие/расписание, не только опубликованный контент.)*

**Tutor drawer «Материалы занятия»:**
7. **P0 — Единый «Добавить» с типами: запись (URL) · PDF · ДЗ;** вставка URL → превью-чип до сохранения. *(Classroom unified attach.)*
8. **P0 — Материал всегда принадлежит занятию** (нет «висящих»); «создать ДЗ»/«создать урок» inline. *(Classroom one-topic-per-item + create-in-flow → совпадает с нашим решением «создать ДЗ из drawer».)*
9. **P1 — Запись = generic URL (Drive/Яндекс.Диск/VK/YouTube)** — см. §3.

**Статус ДЗ:**
10. **P0 — Легибельные чипы: Назначено → Сдано → Проверено (+ Просрочено/Не начато)**, фильтруемые в «Домашке». Roll-up чип на карточке занятия → клик в детальный экран (у нас уже богатый guided-статус). *(Classroom Assigned/Turned-in/Graded.)*

**Уведомления:**
11. **P0 — Дайджест, не спам:** одно «Материалы к Уроку N готовы» (батч на «Готово»), deep-link на карточку. *(Classroom guardian digest; совпадает с нашим решением о батчинге.)*

**Привычка / эмоции (серьёзный тон, rule 90):**
12. **P1 — Лёгкий weekly-streak на осмысленное действие** (сдал ДЗ к занятию), не daily-давление; нудж «у тебя непросмотренная запись Урока N». *(Khan перешёл daily→weekly на meaningful action именно из-за shallow engagement.)*
13. **P1 — Фрейминг записи как «safety net»** («пропустил — пересмотри»), не слежка. *(Skysmart missed-lesson.)* Родителю — авто-прогресс виден (стык со `student-progress`, P3 ROI).

---

## 5. Решения, которые этот разбор УТОЧНЯЕТ (для PRD)

1. **Запись — не «Google Drive URL», а generic recording URL** (Drive/Яндекс.Диск/VK Video/YouTube/любой). Снимает РФ-риск блокировки, проще. *(было: «только Drive URL».)*
2. **«Среда» = две линзы [Занятия | Домашка]** — формализует объединение ДЗ и занятий из прошлого раунда; standalone-ДЗ живут в «Домашке», ничего не теряется.
3. **Пустые состояния разнесены:** «Занятия» показывает occurrence даже без материалов (расписание-ось); «Домашка» — только реальные ДЗ.
4. **Уведомление — дайджест per-lesson**, не per-file; Telegram не единственный канал (web-push/email fallback).
5. **Habit-механика** — weekly-streak на осмысленное действие + нудж непросмотренной записи (а не очки/подарки).
6. **Позиционирование:** мы занимаем gap (никто не делает end-to-end; Repetitor.tech ближе всех) — изучить Repetitor.tech как референс перед SPEC.

---

## Sources

**РФ:**
- Skyeng аудио-запись: https://helpcenter.skyeng.ru/article/335 · платформа https://skyeng.ru/platform/
- Skysmart родит. приложение / пропущенный урок: https://skysmart.usedocs.com/article/69106 · https://skysmart.ru/process
- Учи.Дома: https://www.doma.uchi.ru/
- Тетрика кабинет: https://tetrika-school.ru/
- Фоксфорд: https://foxford.ru/
- AlfaCRM кабинет/Push/MAX/редизайн: https://alfacrm.pro/knowledge/getting-started/customer-account · https://alfacrm.pro/news/releases/pushuvedomleniya · https://alfacrm.pro/news/releases/novayaopciyamax
- HolliHop: https://hollipedia.t8s.ru/books/baza-znanii-crm/page/vvedenie-funkcii-licnogo-kabineta
- Параплан кабинет/Яндекс.Диск/Telegram: https://paraplancrm.ru/knowledgebase/personal-account/ · https://paraplancrm.ru/blog/telegram-integration/
- Repetitor.tech: https://repetitor.tech/
- Маркетплейсы: https://repetit.ru/ · https://profi.ru/repetitor/web/
- Google throttling 2025-2026: https://www.rbc.ru/life/news/697a0bb79a7947059faa8e92 · https://gogov.ru/ru-detector/google-disk
- Telegram throttling 2026: https://ru.wikipedia.org/wiki/Блокировка_Telegram_в_России_(2026) · https://www.fontanka.ru/2026/02/10/76258208/

**Зарубеж:**
- Google Classroom — attachments: https://support.google.com/edu/classroom/answer/6020260 · materials: https://support.google.com/edu/classroom/answer/9123621 · topics: https://support.google.com/edu/classroom/answer/9093681 · student classwork: https://support.google.com/edu/classroom/answer/6020284 · assignment: https://support.google.com/edu/classroom/answer/6020265 · guardian summaries: https://support.google.com/edu/classroom/answer/6386354
- TutorCruncher: https://help.tutorcruncher.com/en/articles/8228238-lesson-recordings · https://help.tutorcruncher.com/en/articles/8225037-lessons
- TutorBird: https://www.tutorbird.com/learning-management/ · https://www.tutorbird.com/student-portal/
- Teachworks: https://teachworks.com/addons/notes-communications · https://teachworks.com/tutorials/completing-lessons
- Preply: https://help.preply.com/en/articles/4182666-preply-classroom-a-student-s-guide
- italki: https://www.italki.com/en/blog/italki-classroom
- Outschool: https://teach.outschool.com/handbook/how-to-add-posts-and-assignments-to-your-course-class/ · https://support.outschool.com/en/articles/452568-class-recordings
- Canvas To-Do: https://sas-lps.freshdesk.com/support/solutions/articles/42000092946 · Moodle formats: https://docs.moodle.org/502/en/Course_formats
- Khan streaks: https://blog.khanacademy.org/get-motivated-to-learn-with-khan-academys-new-streaks-and-levels-features/
