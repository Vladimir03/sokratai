# Lovable Prompt — Insert Tour #2 video с lazy-load

**Action:** заменить video-placeholder в Tour #2 (Конструктор ДЗ) на реальное видео + poster, та же click-to-play стратегия как в Tour #1.

**Files Vladimir attaches к промпту:**
- `tour-2-builder.mp4` (1.9 MB, 25 sec, 1920×1080, H.264 muted)
- `tour-2-poster.jpg` (227 KB, 1920×1080, frame с каталогом Сократа AI и физикой задач + green «База задач Сократ AI — по теме урока» overlay)

---

## Copy-paste prompt для Lovable

```
I'm attaching 2 files for Tour #2 (Конструктор ДЗ) section на tutor landing (sokratai.ru/, target component src/components/sections/tutor/ProductTour2.tsx). Video replaces existing placeholder.

ATTACHED FILES:
- tour-2-builder.mp4 → save to public/marketing/tutor-landing/tour-2-builder.mp4
- tour-2-poster.jpg → save to public/marketing/tutor-landing/tour-2-poster.jpg

VIDEO SPECS:
- Duration: 25 sec
- Resolution: 1920×1080
- Format: MP4 H.264 muted (no audio track), faststart enabled
- Aspect ratio: 16:9

PERFORMANCE REQUIREMENTS (same as Tour #1):
1. On first page load, ONLY the 227 KB poster JPG should be downloaded — NOT the 1.9 MB video
2. Video file must NOT be requested by browser until user explicitly clicks Play button
3. Use click-to-play pattern: visitor sees poster → clicks Play → video loads + plays with autoplay+muted+playsInline+controls
4. Add `preload="none"` to <video> tag and only render <video> AFTER click (use React state)
5. Add `loading="lazy"` and `decoding="async"` to poster <img>
6. Wrap video container in CSS aspect-ratio 16:9 div to prevent CLS

DESIGN REQUIREMENTS:
- Match Tour #1 video component styling — if reusable LazyVideo or Tour1Video component exists, prefer extracting as <LazyVideo videoSrc posterSrc caption ariaLabel /> component and reuse for Tour #2. If Tour #1 is hard-coded inline, create parallel Tour2Video component with identical visual treatment.
- Container: rounded-xl (16px radius), shadow-md, overflow-hidden
- Poster <img> covers full container с object-cover
- Play button: 80px × 80px white circle, centered absolute, semi-transparent dark backdrop (rgba(0,0,0,0.3)) over poster
- Play icon: Lucide React <Play>, 32px, color --sokrat-green-700, slight ml-1
- Caption overlay (bottom-left of poster): «Смотреть как собрать ДЗ за 5 минут — 25 сек», bg rgba(15, 23, 42, 0.75), white text, padding 8px 14px, rounded
- Hover state: play button scales 1.1×, backdrop darkens к rgba(0,0,0,0.4), 200ms transition

ACCESSIBILITY:
- Poster <img> alt: "Превью: Конструктор ДЗ — задачи + AI-генерация за 5 минут"
- Play button: <button> с aria-label="Воспроизвести видео: Конструктор ДЗ"
- Focus-visible ring (--sokrat-focus-ring) on Play button
- Respect prefers-reduced-motion — disable hover scale animation

TARGET COMPONENT STRUCTURE (TypeScript React):

If reusable LazyVideo component already exists from Tour #1:
```tsx
<LazyVideo
  videoSrc="/marketing/tutor-landing/tour-2-builder.mp4"
  posterSrc="/marketing/tutor-landing/tour-2-poster.jpg"
  alt="Превью: Конструктор ДЗ — задачи + AI-генерация за 5 минут"
  caption="Смотреть как собрать ДЗ за 5 минут — 25 сек"
  ariaLabel="Воспроизвести видео: Конструктор ДЗ"
/>
```

If not — create parallel Tour2Video component identical to Tour1Video patterns:
```tsx
import { useState, useRef, useEffect } from "react";
import { Play } from "lucide-react";

export default function Tour2Video() {
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isPlaying && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [isPlaying]);

  return (
    <div className="relative aspect-video rounded-xl overflow-hidden shadow-[var(--sokrat-shadow-md)] bg-slate-100">
      {!isPlaying ? (
        <button
          type="button"
          onClick={() => setIsPlaying(true)}
          aria-label="Воспроизвести видео: Конструктор ДЗ"
          className="group absolute inset-0 w-full h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sokrat-green-700)] focus-visible:outline-offset-2"
        >
          <img
            src="/marketing/tutor-landing/tour-2-poster.jpg"
            alt="Превью: Конструктор ДЗ — задачи + AI-генерация за 5 минут"
            className="absolute inset-0 w-full h-full object-cover"
            width={1920}
            height={1080}
            loading="lazy"
            decoding="async"
          />
          <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors flex items-center justify-center motion-safe:transition-transform">
            <div className="w-20 h-20 rounded-full bg-white shadow-2xl flex items-center justify-center group-hover:motion-safe:scale-110 motion-safe:transition-transform duration-200">
              <Play className="w-8 h-8 text-[var(--sokrat-green-700)] fill-current ml-1" aria-hidden="true" />
            </div>
          </div>
          <div className="absolute bottom-4 left-4 bg-slate-900/75 text-white text-sm font-semibold px-3.5 py-1.5 rounded">
            Смотреть как собрать ДЗ за 5 минут — 25 сек
          </div>
        </button>
      ) : (
        <video
          ref={videoRef}
          src="/marketing/tutor-landing/tour-2-builder.mp4"
          poster="/marketing/tutor-landing/tour-2-poster.jpg"
          controls
          autoPlay
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover bg-black"
        >
          Ваш браузер не поддерживает HTML5-видео. <a href="/marketing/tutor-landing/tour-2-builder.mp4">Скачать видео</a>.
        </video>
      )}
    </div>
  );
}
```

REPLACE: existing video placeholder в Tour #2 section (likely в src/components/sections/tutor/ProductTour2.tsx — параметр videoSrc или video slot вокруг VideoPlaceholder). Component should render внутри Tour #2's video slot.

IMPORTANT — do NOT change:
- Existing copy в ProductTour2 (headline «ДЗ из базы за пять минут», bullets, badge «За 5 минут вместо 40»). Только video replacement.
- Tour #1 video component (тоже не трогать, только если экстрагируешь reusable LazyVideo для обоих)

VALIDATION:
- npm run lint && npm run build — должны проходить
- Network tab при first page load: запрашивается tour-2-poster.jpg (~227 KB), НЕ tour-2-builder.mp4 (1.9 MB)
- После клика на Tour #2 video: MP4 запрашивается, начинается playback в течение 1-2 сек
- Tour #1 video continue working (если был extracted в reusable LazyVideo)

CONTEXT:
- Tour #2 = «Конструктор ДЗ» section на sokratai.ru/ для репетиторов
- 25-sec видео покрывает: кабинет → каталог Сократ AI с задачами по физике → конструктор с AI-вариациями → preview готового ДЗ → отправка
- Aspect ratio video: 16:9 (1920×1080) — vs Tour #1 которое было 1920×1030. Compatible с aspect-video Tailwind class.

После реализации — проверь Network tab показывает только poster при первой загрузке.
```

---

## Краткая выжимка изменений vs Tour #1 prompt

| Параметр | Tour #1 | Tour #2 |
|---|---|---|
| Video file | `tour-1-ai-check.mp4` (2.4 MB) | `tour-2-builder.mp4` (1.9 MB) |
| Poster | `tour-1-poster.jpg` (141 KB) | `tour-2-poster.jpg` (227 KB) |
| Aspect ratio | 1920×1030 (custom — `aspect-[1920/1030]`) | **1920×1080 (16:9 — `aspect-video`)** |
| Component name | `Tour1Video` | `Tour2Video` (или reuse `<LazyVideo>`) |
| Caption text | «Смотреть как AI проверяет ДЗ — 32 сек» | «Смотреть как собрать ДЗ за 5 минут — 25 сек» |
| Aria-label | «Воспроизвести видео: AI-проверка ДЗ» | «Воспроизвести видео: Конструктор ДЗ» |
| Target component | Tour #1 section | `ProductTour2.tsx` |

**Ключевое отличие:** Tour #2 — стандартный 16:9, можно использовать Tailwind `aspect-video` class (Tour #1 был custom `aspect-[1920/1030]`). Если Lovable extract'ил reusable `<LazyVideo>` component при Tour #1 — оптимально передать через props без duplication.

## Что делает Vladimir

1. Открой Lovable chat
2. Прикрепи 2 файла: `tour-2-builder.mp4` + `tour-2-poster.jpg`
3. Скопируй prompt блок выше (от `I'm attaching 2 files...` до `показывает только poster при первой загрузке.`)
4. Вставь в Lovable
5. Lovable размещает файлы в `public/marketing/tutor-landing/` и обновляет `ProductTour2.tsx`
6. Test: open `sokratai.ru/` в incognito → DevTools Network → refresh → должен запросить **только** `tour-2-poster.jpg`. Click Tour #2 Play → video loads.

Если Lovable экстрактил reusable `<LazyVideo>` component при Tour #1 — Tour #2 ляжет в одну строку:
```tsx
<LazyVideo
  videoSrc="/marketing/tutor-landing/tour-2-builder.mp4"
  posterSrc="/marketing/tutor-landing/tour-2-poster.jpg"
  alt="Превью: Конструктор ДЗ"
  caption="Смотреть как собрать ДЗ за 5 минут — 25 сек"
  ariaLabel="Воспроизвести видео: Конструктор ДЗ"
/>
```

Иначе будет parallel `Tour2Video.tsx` — тоже OK для V1, рефакторить в reusable можно потом.
