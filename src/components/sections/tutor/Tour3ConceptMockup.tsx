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
