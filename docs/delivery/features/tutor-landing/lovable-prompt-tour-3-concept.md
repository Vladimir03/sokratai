# Lovable Prompt — Insert Tour #3 «Отчёт родителю» concept mockup

**Action:** заменить video-placeholder в Tour #3 (Отчёт родителю) на статический PNG-макет (концепт), плюс перевести копию в future tense, плюс CTA в TG-канал Егора. Видео **не** записываем — фича в разработке, показываем концепт.

**Files Vladimir attaches к промпту:**
- `tour-3-concept.png` (~91 KB, 1920×1200, дизайн-макет «Еженедельный отчёт родителю» с ochre-плашкой «В РАЗРАБОТКЕ» внутри карточки рядом с датой)

**Почему так, а не видео:**
1. Функция «отчёт родителю» в продукте пока не реализована, скринкаст записать невозможно.
2. Полностью убирать блок не хочу — это ключевой value-prop для буферного сегмента «родитель платит, репетитор продаёт».
3. Концепт-мокап + честная плашка «В разработке» + CTA «Узнай первым в канале Егора» = транспарентность + сбор лида + пре-сейл интерес. Делает обещание, которое мы можем сдержать.

---

## Copy-paste prompt для Lovable

```
I'm attaching 1 file for Tour #3 (Отчёт родителю) section на tutor landing (sokratai.ru/, target component src/components/sections/tutor/ProductTour3.tsx). Static PNG mockup replaces existing video placeholder. Plus copy changes — future tense + TG channel CTA.

ATTACHED FILES:
- tour-3-concept.png → save to public/marketing/tutor-landing/tour-3-concept.png

IMAGE SPECS:
- Resolution: 1920×1200 (aspect ratio ~16:10)
- Format: PNG, ~91 KB (already optimized)
- Content: design mockup «Еженедельный отчёт родителю» — header С Сократ AI logo, дата «12—18 мая 2026», ochre chip «В РАЗРАБОТКЕ», KPI tiles (74 балла / +9 за 6 нед / прогноз 80–85), карта тем (зелёная/жёлтая/красная зоны), линейный график 6 недель, таблица из 4 ДЗ, footer sokratai.ru
- The "В РАЗРАБОТКЕ" ochre chip is ALREADY baked into the PNG (top-right corner of the report card). Do not add another chip overlay.

PERFORMANCE REQUIREMENTS:
1. Add `loading="lazy"` and `decoding="async"` to <img>
2. Wrap image container in CSS aspect-ratio div (1920/1200) to prevent CLS
3. NO click-to-play, NO video — это static image
4. NO state management — компонент полностью stateless

DESIGN REQUIREMENTS:
- Container: rounded-xl (var(--sokrat-radius-xl)), shadow-md (var(--sokrat-shadow-md)), overflow-hidden, bg-slate-100 (placeholder fallback цвет на время загрузки)
- <img> covers full container с object-cover
- Caption overlay (bottom-left of image): «Концепт. Узнай первым в канале Егора →», bg rgba(15, 23, 42, 0.75), white text, padding 8px 14px, rounded
- NO play button, NO hover state, NO animations — это просто картинка с подписью

ACCESSIBILITY:
- <img> alt: "Концепт-макет: еженедельный отчёт родителю — карта тем, динамика балла, последние ДЗ"
- Caption — обычный <div>, не <button> (картинка не кликабельна, кликабелен только inline-CTA в текстовой колонке)

TARGET COMPONENT STRUCTURE (TypeScript React):

Create new component `src/components/sections/tutor/Tour3ConceptMockup.tsx`:
```tsx
const MOCKUP_SRC = "/marketing/tutor-landing/tour-3-concept.png";

export default function Tour3ConceptMockup() {
  return (
    <div
      className="relative w-full overflow-hidden bg-slate-100"
      style={{
        aspectRatio: "1920 / 1200",
        borderRadius: "var(--sokrat-radius-xl)",
        boxShadow: "var(--sokrat-shadow-md)",
      }}
    >
      <img
        src={MOCKUP_SRC}
        alt="Концепт-макет: еженедельный отчёт родителю — карта тем, динамика балла, последние ДЗ"
        width={1920}
        height={1200}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute bottom-4 left-4 rounded bg-slate-900/75 px-3.5 py-1.5 text-sm font-semibold text-white">
        Концепт. Узнай первым в канале Егора →
      </div>
    </div>
  );
}
```

UPDATE `src/components/sections/tutor/ProductTour3.tsx` — три изменения:

1. Add inlineCTA → t.me/sokrat_rep with telemetry goal `tutor_landing_tg_channel_click` (этот goal уже существует в `src/lib/tutorLandingAnalytics.ts`, не добавлять дубликат)
2. Replace video placeholder через `videoSlot={<Tour3ConceptMockup />}`
3. Перевести lede + bullets в future tense (см. полный текст ниже)

```tsx
import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";

import ProductTour from "./ProductTour";
import Tour3ConceptMockup from "./Tour3ConceptMockup";

export default function ProductTour3() {
  return (
    <ProductTour
      id="tour-3"
      headline={<>Отчёт родителю — пока вы спите</>}
      lede="Еженедельная сводка будет генерироваться автоматически: карта тем, динамика балла, активность ученика между уроками. Будет приходить родителю в мессенджер по его предпочтению."
      bullets={[
        {
          title: "Карта тем — зелёный, жёлтый, красный",
          body:
            "Родитель будет видеть, какие темы у ребёнка закрыты, какие в работе, какие «красная зона». Привязка к номерам заданий ЕГЭ и ОГЭ — родитель без физического образования поймёт без ваших комментариев.",
        },
        {
          title: "Динамика за недели и месяцы",
          body:
            "Было 65 баллов — стало 74 за шесть недель. Темп +1,5 балла в неделю. Прогноз на экзамен: 80–85 при текущем режиме. Цифры, которые закроют вопрос «а работают ли наши деньги».",
        },
        {
          title: "Telegram, email или push",
          body:
            "Родитель получит отчёт в том мессенджере, где он живёт. Вы не напишете ни одного сообщения вручную.",
        },
      ]}
      inlineCTA={{
        label: "Узнай первым в канале Егора →",
        href: "https://t.me/sokrat_rep",
        onClick: () => trackTutorLandingGoal("tutor_landing_tg_channel_click"),
      }}
      videoPlaceholderText="Отчёт родителю"
      videoPlaceholderCaption="Концепт — функция в разработке"
      videoSrc={undefined}
      videoSlot={<Tour3ConceptMockup />}
      zigzag="text-left"
    />
  );
}
```

PATCH `src/components/sections/tutor/ProductTour.tsx` — поддержка external href в inlineCTA:

Текущий код оборачивает inlineCTA в `<Link to={inlineCTA.href}>` (react-router). Это сломает CTA на `https://t.me/sokrat_rep` — react-router отнесётся к URL как к относительному пути и не откроет внешнюю ссылку. Нужно добавить branching: если href начинается с `https://`, `http://`, `mailto:`, `tel:` — рендерить `<a target="_blank" rel="noopener noreferrer">`, иначе оставить `<Link>`.

Add helper at top of file (after imports):
```tsx
// External hrefs (mailto:, https://t.me/..., etc.) must use <a> instead of
// react-router <Link>, which expects a relative path.
function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}
```

And in the inlineCTA JSX block, branch:
```tsx
{inlineCTA && (
  isExternalHref(inlineCTA.href) ? (
    <a
      href={inlineCTA.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={inlineCTA.onClick}
      className="inline-flex items-center font-semibold border-b border-transparent transition-colors hover:border-b-[color:var(--sokrat-green-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sokrat-green-700)]/60 focus-visible:ring-offset-2"
      style={{ color: "var(--sokrat-green-700)" }}
    >
      {inlineCTA.label}
    </a>
  ) : (
    <Link
      to={inlineCTA.href}
      onClick={inlineCTA.onClick}
      className="inline-flex items-center font-semibold border-b border-transparent transition-colors hover:border-b-[color:var(--sokrat-green-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sokrat-green-700)]/60 focus-visible:ring-offset-2"
      style={{ color: "var(--sokrat-green-700)" }}
    >
      {inlineCTA.label}
    </Link>
  )
)}
```

IMPORTANT — do NOT change:
- Tour #1 / Tour #2 video components (Tour1Video.tsx, Tour2Video.tsx если уже existing)
- Existing copy в ProductTour1, ProductTour2, любых других tour-секциях
- Hero, Pricing, FAQ, Footer и любые другие секции лендинга
- Tour #3 headline («Отчёт родителю — пока вы спите») — оставляем present tense, это про общий обещанный результат
- Telemetry goal type `tutor_landing_tg_channel_click` уже существует в `src/lib/tutorLandingAnalytics.ts` — не добавлять дубликат, просто использовать

VALIDATION:
- `npm run lint && npm run build` должны проходить без ошибок
- Network tab при first page load: запрашивается tour-3-concept.png (~91 KB) с lazy loading (только когда секция в viewport)
- Открытие `/` на мобиле + scroll до Tour #3 — image грузится корректно, не растягивается, ochre chip «В РАЗРАБОТКЕ» виден внутри report card
- Клик на «Узнай первым в канале Егора →» открывает `https://t.me/sokrat_rep` в новой вкладке (target="_blank")
- Tour #1 + Tour #2 продолжают работать как раньше (regression check на их inlineCTA — у Tour #1 он внутренний `/signup?...`, должен использовать `<Link>`, не `<a>`)
- В Яндекс.Метрике после клика на TG-CTA фиксируется goal `tutor_landing_tg_channel_click` (этот goal уже работает на других CTA в Hero / FinalCTA / Footer — не должен сломаться)

CONTEXT:
- Tour #3 = «Отчёт родителю» section на sokratai.ru/ для репетиторов
- Фича в продукте пока не реализована, поэтому **mockup**, не **screenshot**
- Концепт-PDF показывает что родитель получит: карту тем (зелёная/жёлтая/красная зоны), динамику балла за 6 недель с прогнозом ЕГЭ, последние ДЗ
- TG-канал Егора @sokrat_rep — место где Vladimir + Егор пишут о фиче-разработке, апдейтах, апи; CTA «Узнай первым» собирает теплых лидов на момент запуска фичи в проде
- Tone of voice: future tense («будет приходить родителю»), не present («приходит родителю») — честность вместо vapourware
- Aspect ratio mockup 1920×1200 vs Tour #1 1920×1030 vs Tour #2 1920×1080 — разные пропорции, не пытаться унифицировать

После реализации — проверь что:
1. tour-3-concept.png лежит в public/marketing/tutor-landing/
2. Tour3ConceptMockup.tsx создан как новый файл (sibling Tour1Video.tsx)
3. ProductTour3.tsx обновлён (lede + bullets future tense, inlineCTA на TG, videoSlot=Tour3ConceptMockup)
4. ProductTour.tsx содержит isExternalHref helper + branching <a>/<Link>
5. Никакие другие компоненты не тронуты
```

---

## Краткая выжимка изменений vs Tour #1/#2 prompts

| Параметр | Tour #1 | Tour #2 | Tour #3 (этот) |
|---|---|---|---|
| Тип медиа | MP4 video | MP4 video | **PNG mockup** |
| Aspect ratio | 1920×1030 (custom) | 1920×1080 (16:9) | **1920×1200 (~16:10)** |
| Размер | 2.4 MB MP4 | 1.9 MB MP4 | **91 KB PNG** |
| Click-to-play | Да | Да | **Нет — static image** |
| Component name | `Tour1Video` | `Tour2Video` или `LazyVideo` | **`Tour3ConceptMockup`** |
| Caption text | «Смотреть как AI проверяет ДЗ — 32 сек» | «Смотреть как собрать ДЗ за 5 минут — 25 сек» | **«Концепт. Узнай первым в канале Егора →»** |
| inlineCTA | `/signup?...` (internal) | — | **`https://t.me/sokrat_rep` (external)** |
| Telemetry goal | `tutor_landing_cta_tour1` | — | **`tutor_landing_tg_channel_click`** (reuse) |
| Bullets tense | Present | Present | **Future** |

**Ключевые отличия:**
1. Static image вместо click-to-play видео — функция не записываема, мокап честно сигналит «будет, но пока концепт».
2. **Patch ProductTour.tsx** — добавление branching внешний/внутренний href для inlineCTA. Без этого `<Link to="https://t.me/...">` зашит в react-router и сломает open-in-new-tab поведение.
3. Future tense в bullets — «будет видеть» / «получит» / «закроет» вместо «видит» / «получает» / «закрывает». Снимает риск vapourware-claim.
4. Reuse существующего telemetry goal `tutor_landing_tg_channel_click` (уже задефайнен в `tutorLandingAnalytics.ts`, не плодим дубликаты).

## Что делает Vladimir

1. Открой Lovable chat
2. Прикрепи файл: `tour-3-concept.png`
3. Скопируй prompt блок выше (от `I'm attaching 1 file...` до `Никакие другие компоненты не тронуты.`)
4. Вставь в Lovable
5. Lovable размещает PNG в `public/marketing/tutor-landing/`, создаёт `Tour3ConceptMockup.tsx`, обновляет `ProductTour3.tsx`, патчит `ProductTour.tsx` external-href branching
6. Test:
   - Open `sokratai.ru/` в incognito → DevTools Network → scroll до Tour #3 → должен запросить `tour-3-concept.png` (~91 KB) с lazy loading
   - Image отрендерилась корректно, ochre chip «В РАЗРАБОТКЕ» видно внутри report card
   - Click на «Узнай первым в канале Егора →» — открывается `https://t.me/sokrat_rep` в новой вкладке
   - Tour #1 + Tour #2 видео продолжают играть (regression check)
7. Если всё ОК — push на main → deploy через `ssh -i "$HOME\.ssh\sokratai_proxy" root@185.161.65.182 deploy-sokratai`

## Известные V2 follow-ups (не для текущего промпта)

- **Когда фича «отчёт родителю» будет в проде** — заменить `Tour3ConceptMockup` на `Tour3Video` (по паттерну Tour #1/#2), записать скринкаст из реального продукта, убрать chip «В РАЗРАБОТКЕ» из мокапа, перевести bullets обратно в present tense. Файл скрипта генерации мокапа (`generate_tour3_mockup.py`) сохранён в outputs/ для регенерации, если понадобится промежуточная версия.
- **Если CTA «Узнай первым» окажется слабым** — поменять на email-capture inline form (require отдельный компонент + Supabase table `feature_interest`).
- **Если мокап смотрится слишком как product screenshot** — добавить более явный watermark «КОНЦЕПТ» по диагонали через всю карточку. Сейчас сигнал даёт только ochre chip + caption + future tense в copy — этого должно хватить.
