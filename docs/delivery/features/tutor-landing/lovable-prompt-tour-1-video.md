# Lovable Prompt — Insert Tour #1 video с lazy-load и attractive preview

**Для:** Lovable AI builder
**Action:** добавить видео-секцию в Tour #1 на `sokratai.ru/` (TutorLanding)
**Goal:** быстрая первая загрузка страницы (poster only, NOT video) + красивый preview, чтобы репетитор захотел кликнуть

---

## Copy-paste prompt для Lovable

```
Need to insert a video preview component into the Tour #1 section of the tutor landing page (sokratai.ru/, file src/pages/Index.tsx, component src/components/sections/tutor/ProductTour1.tsx or similar). Replace existing video placeholder.

ASSETS (already в public/marketing/tutor-landing/):
- tour-1-ai-check.mp4 — 32 sec, 1920×1030, 2.4 MB, H.264, muted (no audio track)
- tour-1-poster.jpg — 1920×1030, 141 KB, frame с handwritten physics work + green «И рукописные тоже» badge

PERFORMANCE REQUIREMENTS (critical):
1. On first page load, ONLY the 141 KB poster JPG should be downloaded — NOT the 2.4 MB video
2. Video file must NOT be requested by browser until user explicitly clicks Play button OR video container scrolls into viewport
3. Use click-to-play pattern: visitor sees poster → clicks Play → video loads and starts playing with autoplay+muted+playsInline+controls
4. Add `preload="none"` to <video> tag and only render <video> AFTER click (use React state)
5. Add `loading="lazy"` and `decoding="async"` to poster <img>
6. Wrap video container in CSS `aspect-ratio: 1920/1030` or fixed-aspect div to prevent layout shift (CLS) before image loads
7. Preconnect не нужен — assets static-served from same origin

DESIGN REQUIREMENTS:
- Use design system tokens: --sokrat-green-700 (#1B6B4A) for play button accent, white for play icon, --sokrat-shadow-md for video container shadow
- Container: rounded-xl (16px radius), shadow-md, overflow-hidden
- Poster <img> covers full container с object-cover
- Play button: 80px × 80px white circle, centered absolute, semi-transparent dark backdrop (rgba(0,0,0,0.3)) over poster
- Play icon: Lucide React `<Play>` icon, 32px, color --sokrat-green-700, slight ml-1 для visual centering (play triangle is asymmetric)
- Caption overlay (optional, bottom-left of poster): small dark badge с текстом «Смотреть как AI проверяет ДЗ — 32 сек», bg rgba(15, 23, 42, 0.75), white text, padding 8px 14px, rounded
- Hover state: play button scales 1.1×, backdrop darkens к rgba(0,0,0,0.4), 200ms transition
- Click: state change → unmount poster, mount <video> with autoplay+controls

ACCESSIBILITY:
- Poster <img> alt: "Превью: AI-проверка рукописных ДЗ за 40 минут"
- Play button: <button> element с aria-label="Воспроизвести видео: AI-проверка ДЗ"
- Focus-visible ring (--sokrat-focus-ring) on Play button
- Respect `prefers-reduced-motion` — disable hover scale animation if user prefers reduced motion
- Video has `controls` attribute when playing (visitor can pause/seek/fullscreen)

TARGET COMPONENT STRUCTURE (TypeScript React):

```tsx
import { useState, useRef, useEffect } from "react";
import { Play } from "lucide-react";

export default function Tour1Video() {
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isPlaying && videoRef.current) {
      videoRef.current.play().catch(() => {
        // autoplay blocked by browser — пользователь нажмёт нативный controls
      });
    }
  }, [isPlaying]);

  return (
    <div className="relative aspect-[1920/1030] rounded-xl overflow-hidden shadow-[var(--sokrat-shadow-md)] bg-slate-100">
      {!isPlaying ? (
        <button
          type="button"
          onClick={() => setIsPlaying(true)}
          aria-label="Воспроизвести видео: AI-проверка ДЗ"
          className="group absolute inset-0 w-full h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sokrat-green-700)] focus-visible:outline-offset-2"
        >
          <img
            src="/marketing/tutor-landing/tour-1-poster.jpg"
            alt="Превью: AI-проверка рукописных ДЗ за 40 минут"
            className="absolute inset-0 w-full h-full object-cover"
            width={1920}
            height={1030}
            loading="lazy"
            decoding="async"
          />
          <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors flex items-center justify-center motion-safe:transition-transform">
            <div className="w-20 h-20 rounded-full bg-white shadow-2xl flex items-center justify-center group-hover:motion-safe:scale-110 motion-safe:transition-transform duration-200">
              <Play className="w-8 h-8 text-[var(--sokrat-green-700)] fill-current ml-1" aria-hidden="true" />
            </div>
          </div>
          <div className="absolute bottom-4 left-4 bg-slate-900/75 text-white text-sm font-semibold px-3.5 py-1.5 rounded">
            Смотреть как AI проверяет ДЗ — 32 сек
          </div>
        </button>
      ) : (
        <video
          ref={videoRef}
          src="/marketing/tutor-landing/tour-1-ai-check.mp4"
          poster="/marketing/tutor-landing/tour-1-poster.jpg"
          controls
          autoPlay
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover bg-black"
        >
          Ваш браузер не поддерживает HTML5-видео. <a href="/marketing/tutor-landing/tour-1-ai-check.mp4">Скачать видео</a>.
        </video>
      )}
    </div>
  );
}
```

REPLACE: existing video placeholder в Tour #1 (component для AI-проверка ДЗ, в src/components/sections/tutor/ProductTour1.tsx или wrapper). Component должен использоваться внутри Tour #1's video slot.

DO NOT:
- Не используй framer-motion (не разрешён в проекте — см. .claude/rules/performance.md)
- Не добавляй autoplay-on-load или autoplay-on-scroll — strictly click-to-play (поскольку goal — fast first-load для всех визитёров включая mobile/3G)
- Не добавляй iframe-embed решения (Vimeo/YouTube) — self-hosted MP4 уже есть, оптимально для control + privacy + load speed
- Не используй background music или voice-over — video муtetd by design (decision из docs/delivery/features/tutor-landing/implementation-spec.md §8.1)
- Не меняй tour-1-ai-check.mp4 или tour-1-poster.jpg — assets зафиксированы

VALIDATION:
- npm run lint && npm run build — должны проходить
- Lighthouse Performance score не должен упасть от добавления компонента (poster lazy load + click-to-play защищает от регрессии)
- Network tab при first page load: запрашивается tour-1-poster.jpg (~141 KB), НЕ tour-1-ai-check.mp4 (2.4 MB)
- После клика: запрашивается MP4 + начинается playback в течение 1-2 сек

CONTEXT:
- Это tutor landing на sokratai.ru/, target audience: репетиторы физики/математики/информатики (premium professionals, 3-4K ₽/час)
- Tour #1 = flagship section про AI-проверку рукописных ДЗ — это main conversion driver
- Video показывает реальную работу Сократа: heatmap результатов → drill-down на ученицу → краткие ответы Q&A → handwritten reveal → AI находит ошибку → AI хвалит за исправление → возврат в heatmap
- 32 секунды покрывают полный value-arc

После реализации — проверь, что Network tab показывает только poster при первой загрузке и MP4 только после клика.
```

---

## Why this prompt works (rationale для Vladimir)

### Performance — почему 141 KB poster vs 2.4 MB video

| Метрика | Without optimization | With click-to-play (proposed) | Diff |
|---|---|---|---|
| Initial download (Tour #1 area) | 2.4 MB MP4 | 141 KB JPG | **−94%** |
| Time to interactive (3G mobile) | ~12-15 sec | ~1-2 sec | **10×** faster |
| Lighthouse Performance | risk drop on tour video page | stable | preserved |
| Bandwidth waste от non-engaging visitors | 2.4 MB всем кто scroll'нул | 141 KB только тем кто кликнул | **major saving** |

Когда репетитор зашёл и не интересен — он не качает 2.4 MB.
Когда репетитор заинтересован → клик → видео грузится за 1-2 сек на нормальном connection.

### Visual psychology — почему этот poster

Frame на 17-й секунде video показывает:
- **Handwritten physics solution** в browser viewer (тетрадный лист, формулы V=10кВ, F=ma, B=μV²/(qR))
- **Green badge «И рукописные тоже»** — value prop в bold

Это **maximum curiosity-trigger** для tutor:
- "AI читает handwritten physics?!" — instant intrigue
- Green badge сразу coммуницирует — да, это про рукопись
- Mathematics formulae — credibility (не fake demo, реальная работа ученика)

### Click-to-play vs autoplay-on-scroll

Я выбрал click-to-play потому что:
1. **Mobile users (40%+ traffic 2026)** часто на slow 3G/4G — autoplay загружает 2.4 MB без согласия
2. **Browser autoplay policies** (Chrome/Safari) often блокируют autoplay даже muted на mobile
3. **Premium audience** (репетитор с hourly rate 4K ₽) prefer agency over surprise — click feels respectful
4. **Engagement signal** — клик = интерес, vs autoplay = noise. Easier to track conversion.

### Alternative: Intersection Observer autoplay (V2 если хочешь)

Если хочешь autoplay-on-scroll в будущем (V2 polish), вот snippet:

```tsx
useEffect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        setIsPlaying(true);
        observer.disconnect();
      }
    },
    { threshold: 0.5 } // 50% of element visible
  );
  if (containerRef.current) observer.observe(containerRef.current);
  return () => observer.disconnect();
}, []);
```

Trade-off: autoplay-muted при скролле = 2.4 MB качается у всех scroll'ивших мимо. Я не рекомендую для V1.

---

## Альтернативный poster (если этот не нравится)

Если handwritten frame слишком "тёплый/неформальный", альтернатива:
- `tour-1-poster-alt.jpg` (frame sec 1.5) — **heatmap dashboard** с организованными зелёными квадратами и колонками учеников. Это про "control + organization" — appeal для репетиторов которым важен dashboard.

В Lovable prompt замени `/marketing/tutor-landing/tour-1-poster.jpg` на `tour-1-poster-alt.jpg`.

Я бы остался на handwritten — оно intriguing, "did I really see formulas being read by AI?" побеждает "ok, dashboard, normal".

---

## Test после deploy

1. Open `sokratai.ru/` в incognito Chrome
2. Open DevTools → Network → filter Media
3. Refresh page
4. **Должно:** только `tour-1-poster.jpg` в Network (~141 KB)
5. **Не должно:** `tour-1-ai-check.mp4` в Network (он не запрашивается)
6. Click Play button
7. **Должно:** MP4 запрашивается, начинается playback в течение 1-2 сек

Если test 5 fails — autoplay/preload где-то лишний; вернись к prompt и убери `preload` или `autoplay` из poster-state.
