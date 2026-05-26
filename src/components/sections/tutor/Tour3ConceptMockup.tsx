import { Maximize2, X } from "lucide-react";
import { useEffect, useState } from "react";

const MOCKUP_SRC = "/marketing/tutor-landing/tour-3-concept.webp";

export default function Tour3ConceptMockup() {
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [zoomed]);

  return (
    <>
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
          onClick={() => setZoomed(true)}
          className="absolute inset-0 h-full w-full cursor-zoom-in object-cover"
        />

        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label="Увеличить макет отчёта родителю"
          className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2"
          style={{
            backgroundColor: "rgba(255,255,255,0.95)",
            color: "var(--sokrat-text-1)",
          }}
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          Увеличить
        </button>

        <div className="absolute bottom-4 left-4 rounded bg-slate-900/75 px-3.5 py-1.5 text-sm font-semibold text-white">
          Концепт. Узнай первым в канале Егора →
        </div>
      </div>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Концепт-макет отчёта родителю — увеличенный вид"
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Закрыть"
            className="absolute top-4 right-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-md hover:bg-white focus-visible:outline-none focus-visible:ring-2"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <img loading="lazy"
            src={MOCKUP_SRC}
            alt="Концепт-макет отчёта родителю — увеличенный вид"
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
