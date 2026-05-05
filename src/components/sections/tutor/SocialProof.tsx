import { Play, Maximize2, X } from "lucide-react";
import { useState, useEffect } from "react";

import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";
import founderEgorImg from "@/assets/founder-egor.webp";
import founderVladimirImg from "@/assets/founder-vladimir.webp";

type Founder = {
  name: string;
  imageSrc: string;
  cta?: { label: string; href: string; external: boolean };
};

const FOUNDERS: Founder[] = [
  {
    name: "Егор Блинов",
    imageSrc: founderEgorImg,
    cta: {
      label: "Канал Егора →",
      href: "https://t.me/sokrat_rep",
      external: true,
    },
  },
  {
    name: "Владимир Камчаткин",
    imageSrc: founderVladimirImg,
  },
];

const TESTIMONIAL_VIDEO_SRC: string | undefined =
  "/marketing/tutor-landing/testimonial-maria-knyazeva.mp4";

export default function SocialProof() {
  return (
    <section
      id="social-proof"
      aria-labelledby="social-proof-heading"
      className="py-14 md:py-24"
      style={{ backgroundColor: "var(--sokrat-surface)" }}
    >
      {/*
        Scoped overrides — marketing-global h3/p would force 24/16 px,
        we want founder/case tokens exactly.
      */}
      <style>{`
        .sokrat.sokrat-marketing .sp-founder-name {
          font-size: 20px; line-height: 1.2; font-weight: 700;
          color: var(--sokrat-fg1);
        }
        .sokrat.sokrat-marketing .sp-founder-credentials,
        .sokrat.sokrat-marketing .sp-founder-credentials span {
          font-size: 14px; line-height: 1.5; color: var(--sokrat-fg2);
        }
        .sokrat.sokrat-marketing .sp-founder-quote {
          font-size: 15px; line-height: 1.6; font-style: italic;
          color: var(--sokrat-fg1); padding-left: 12px;
          border-left: 3px solid var(--sokrat-green-200);
          margin: 0;
        }
        .sokrat.sokrat-marketing .sp-subheader {
          font-size: 18px; font-weight: 600; color: var(--sokrat-fg2);
          text-align: center; margin: 32px 0 24px;
        }
        @media (min-width: 768px) {
          .sokrat.sokrat-marketing .sp-subheader { margin: 48px 0 28px; }
        }
        .sokrat.sokrat-marketing .sp-case-name {
          font-size: 16px; font-weight: 600; color: var(--sokrat-fg1);
        }
        .sokrat.sokrat-marketing .sp-case-regalia {
          font-size: 13px; color: var(--sokrat-fg3); line-height: 1.4;
        }
        .sokrat.sokrat-marketing .sp-case-disclaimer {
          font-size: 11px; line-height: 1.4; color: var(--sokrat-fg3);
          padding-top: 4px; margin: 0;
          border-top: 1px solid var(--sokrat-border-light);
        }
        .sokrat.sokrat-marketing .sp-case-quote {
          font-size: 14px; line-height: 1.55; font-style: italic;
          color: var(--sokrat-fg1); margin: 0;
        }
        .sokrat.sokrat-marketing .sp-your-case-title {
          font-size: 18px; color: var(--sokrat-green-800);
          margin-bottom: 8px; font-weight: 600;
        }
        .sokrat.sokrat-marketing .sp-your-case-body {
          font-size: 14px; color: var(--sokrat-fg2); margin-bottom: 16px;
        }
      `}</style>

      <div className="mx-auto max-w-[960px] px-4 md:px-8">
        <h2 id="social-proof-heading" className="text-center mb-7 md:mb-12">
          Кто стоит за Сократом
        </h2>

        {/* Founders */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {FOUNDERS.map((founder) => (
            <FounderCard key={founder.name} founder={founder} />
          ))}
        </div>

        {/* Subheader */}
        <h3 className="sp-subheader">Репетиторы используют Сократ AI</h3>

        {/* Cases */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
          <CaseVideoCard videoSrc={TESTIMONIAL_VIDEO_SRC} />
          <CaseEgorCard />
          <CaseYourCaseCard />
        </div>
      </div>
    </section>
  );
}

function FounderCard({ founder }: { founder: Founder }) {
  return (
    <article
      className="flex flex-col gap-4 rounded-[18px] overflow-hidden"
      style={{
        backgroundColor: "var(--sokrat-card)",
        border: "1px solid var(--sokrat-border)",
      }}
    >
      <img
        src={founder.imageSrc}
        alt={`${founder.name} — Сократ AI`}
        loading="lazy"
        className="block w-full h-auto"
        style={{ aspectRatio: "1 / 1", objectFit: "cover" }}
      />
      {founder.cta && (
        <div className="px-6 pb-6">
          <a
            href={founder.cta.href}
            target={founder.cta.external ? "_blank" : undefined}
            rel={founder.cta.external ? "noopener noreferrer" : undefined}
            onClick={() =>
              trackTutorLandingGoal("tutor_landing_tg_channel_click")
            }
            className="self-start inline-flex items-center gap-1 px-4 py-2 rounded-md border-2 text-sm font-semibold transition-colors hover:bg-[color:var(--sokrat-green-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              color: "var(--sokrat-green-700)",
              borderColor: "var(--sokrat-green-700)",
            }}
          >
            {founder.cta.label}
          </a>
        </div>
      )}
    </article>
  );
}

function CaseVideoCard({ videoSrc }: { videoSrc?: string }) {
  return (
    <article
      className="flex flex-col gap-3 rounded-[14px] p-5"
      style={{
        backgroundColor: "var(--sokrat-card)",
        border: "1px solid var(--sokrat-border)",
      }}
    >
      <div
        className="relative overflow-hidden flex items-center justify-center rounded-lg"
        style={{
          aspectRatio: "3 / 4",
          background:
            "linear-gradient(160deg, var(--sokrat-green-100) 0%, var(--sokrat-green-200) 100%)",
        }}
      >
        {videoSrc ? (
          <video
            src={videoSrc}
            controls
            preload="metadata"
            playsInline
            className="h-full w-full object-cover"
          />
        ) : (
          <>
            <div
              aria-label="Видео-отзыв"
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{
                backgroundColor: "rgba(255,255,255,0.92)",
                color: "var(--sokrat-green-700)",
                boxShadow: "var(--sokrat-shadow-md)",
              }}
            >
              <Play aria-hidden="true" className="h-6 w-6 fill-current" />
            </div>
            <div
              className="absolute bottom-3 left-3 right-3 rounded-md text-center text-xs font-medium"
              style={{
                color: "var(--sokrat-fg3)",
                backgroundColor: "rgba(255,255,255,0.85)",
                padding: "6px 8px",
              }}
            >
              Видео-отзыв ждём от Егора
            </div>
          </>
        )}
      </div>
      <div className="sp-case-name">Мария Князева</div>
      <div className="sp-case-regalia">
        Руководитель онлайн-курса подготовки к ЕГЭ и ОГЭ по биологии
      </div>
      <p className="sp-case-disclaimer">
        Отзыв снят, когда Сократ AI работал как Telegram-бот. С 2025 платформа
        переехала на sokratai.ru.
      </p>
    </article>
  );
}

function CaseEgorCard() {
  // Real practitioner case: Егор Б. uses Сократ AI with his own physics
  // students. Companion student-feedback screenshot below the quote acts
  // as third-party social proof (the student noticed the AI tools Егор is
  // building — that's exactly Сократ AI). Two images live in
  // `public/marketing/tutor-landing/` so they ship as static assets.
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
    <article
      className="relative flex flex-col gap-3 rounded-[14px] p-5"
      style={{
        backgroundColor: "var(--sokrat-card)",
        border: "1px solid var(--sokrat-border)",
      }}
    >
      <span
        className="self-start inline-block rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{
          backgroundColor: "var(--sokrat-green-100)",
          color: "var(--sokrat-green-800)",
        }}
      >
        Реальный кейс
      </span>

      <img
        src="/marketing/tutor-landing/egor-portrait.jpg"
        alt="Егор Блинов — фото"
        width={88}
        height={88}
        loading="lazy"
        className="h-[88px] w-[88px] self-start rounded-[12px] object-cover"
        style={{
          backgroundColor: "var(--sokrat-green-100)",
          border: "1px solid var(--sokrat-border)",
        }}
      />

      <div className="sp-case-name">Егор Блинов</div>
      <div className="sp-case-regalia">
        Репетитор физики ОГЭ, ЕГЭ и&nbsp;олимпиады · 10&nbsp;лет опыта
      </div>
      <blockquote className="sp-case-quote">
        «Собираю ДЗ за 5&nbsp;минут из базы + своих задач. AI-проверка ДЗ
        экономит 2&nbsp;часа на группу школьников каждую неделю.»
      </blockquote>

      <figure className="mt-1 flex flex-col gap-2">
        <div className="relative">
          <img
            src="/marketing/tutor-landing/egor-student-feedback.jpg"
            alt="Сообщение ученицы Егору в Telegram: «А вы случайно не преподаёте математику подготовка к ЕГЭ? Просто мне очень нравится, как вы преподносите материал, какие плюшки в виде сайтов, ИИ вы делаете…»"
            loading="lazy"
            className="w-full rounded-[10px] cursor-zoom-in"
            style={{
              border: "1px solid var(--sokrat-border)",
              backgroundColor: "var(--sokrat-card)",
            }}
            onClick={() => setZoomed(true)}
          />
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label="Увеличить сообщение ученицы"
            className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2"
            style={{
              backgroundColor: "rgba(255,255,255,0.95)",
              color: "var(--sokrat-green-800)",
              border: "1px solid var(--sokrat-border)",
            }}
          >
            <Maximize2 className="h-3 w-3" aria-hidden="true" />
            Увеличить
          </button>
        </div>
        <figcaption
          className="text-[11px] leading-[1.4] text-center"
          style={{ color: "var(--sokrat-fg3)" }}
        >
          Сообщение ученицы Егору, май 2026
        </figcaption>
      </figure>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Сообщение ученицы Егору — увеличенный вид"
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
          <img
            src="/marketing/tutor-landing/egor-student-feedback.jpg"
            alt="Сообщение ученицы Егору в Telegram — увеличенный вид"
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </article>
  );
}

function CaseYourCaseCard() {
  return (
    <article
      className="flex flex-col items-center justify-center rounded-[14px] p-5 text-center"
      style={{
        backgroundColor: "transparent",
        border: "2px dashed var(--sokrat-green-200)",
      }}
    >
      <h3 className="sp-your-case-title">Ваш кейс?</h3>
      <p className="sp-your-case-body">
        Расскажите, как Сократ AI поменял вашу работу. Разместим в этой секции.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <a
          href="https://t.me/Analyst_Vladimir"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ backgroundColor: "var(--sokrat-green-700)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--sokrat-green-800)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--sokrat-green-700)";
          }}
        >
          Написать в Telegram →
        </a>
        <a
          href="mailto:volodyakamchatkin@gmail.com"
          className="inline-flex items-center rounded-md border-2 px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 hover:bg-[color:var(--sokrat-green-50)]"
          style={{
            color: "var(--sokrat-green-700)",
            borderColor: "var(--sokrat-green-700)",
          }}
        >
          Email
        </a>
      </div>
    </article>
  );
}
