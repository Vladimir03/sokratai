import { useState, useRef, useEffect } from "react";
import { Play } from "lucide-react";

const POSTER_SRC = "/marketing/tutor-landing/tour-1-poster.jpg";
const VIDEO_SRC = "/marketing/tutor-landing/tour-1-ai-check.mp4";

export default function Tour1Video() {
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isPlaying && videoRef.current) {
      videoRef.current.play().catch(() => {
        // autoplay blocked — user can use native controls
      });
    }
  }, [isPlaying]);

  return (
    <div
      className="relative w-full overflow-hidden bg-slate-100"
      style={{
        aspectRatio: "1920 / 1030",
        borderRadius: "var(--sokrat-radius-xl)",
        boxShadow: "var(--sokrat-shadow-md)",
      }}
    >
      {!isPlaying ? (
        <button
          type="button"
          onClick={() => setIsPlaying(true)}
          aria-label="Воспроизвести видео: AI-проверка ДЗ"
          className="group absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sokrat-green-700)] focus-visible:ring-offset-2"
        >
          <img
            src={POSTER_SRC}
            alt="Превью: AI-проверка рукописных ДЗ за 40 минут"
            width={1920}
            height={1030}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-2xl motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-110">
              <Play
                className="ml-1 h-8 w-8 fill-current"
                style={{ color: "var(--sokrat-green-700)" }}
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="absolute bottom-4 left-4 rounded bg-slate-900/75 px-3.5 py-1.5 text-sm font-semibold text-white">
            Смотреть как AI проверяет ДЗ — 32 сек
          </div>
        </button>
      ) : (
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          poster={POSTER_SRC}
          controls
          autoPlay
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full bg-black object-cover"
        >
          Ваш браузер не поддерживает HTML5-видео.{" "}
          <a href={VIDEO_SRC}>Скачать видео</a>.
        </video>
      )}
    </div>
  );
}