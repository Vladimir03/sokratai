import { Play, Maximize2, MessageCircle, Send, Users, X } from "lucide-react";
import { useState, useEffect } from "react";

import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";
import {
  SOKRAT_COMMUNITY_TELEGRAM_URL,
  SOKRAT_COMMUNITY_VK_URL,
} from "@/lib/tutorPlanCopy";
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
        .sokrat.sokrat-marketing .sp-case-chip {
          display: inline-flex; align-items: center;
          font-size: 11px; line-height: 1.3; font-weight: 600;
          color: var(--sokrat-green-800);
          background-color: var(--sokrat-green-50);
          border: 1px solid var(--sokrat-green-200);
          border-radius: 999px;
          padding: 4px 10px;
          align-self: flex-start;
        }
        .sokrat.sokrat-marketing .sp-case-bullets {
          font-size: 13px; line-height: 1.5;
          color: var(--sokrat-fg2);
          padding-left: 18px; margin: 0;
        }
        .sokrat.sokrat-marketing .sp-case-bullets li {
          margin-bottom: 6px;
        }
        .sokrat.sokrat-marketing .sp-case-bullets li:last-child {
          margin-bottom: 0;
        }
        .sokrat.sokrat-marketing .sp-your-case-title {
          font-size: 18px; color: var(--sokrat-green-800);
          margin-bottom: 8px; font-weight: 600;
        }
        .sokrat.sokrat-marketing .sp-your-case-body {
          font-size: 14px; color: var(--sokrat-fg2); margin-bottom: 16px;
        }
        .sokrat.sokrat-marketing .sp-your-case-banner-body {
          font-size: 14px; color: var(--sokrat-fg2); margin: 0;
        }
        .sokrat.sokrat-marketing .sp-community-title {
          font-size: 18px; color: var(--sokrat-green-800);
          margin-bottom: 6px; font-weight: 600;
        }
        .sokrat.sokrat-marketing .sp-community-body {
          font-size: 14px; line-height: 1.5;
          color: var(--sokrat-fg2); margin: 0;
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

        {/*
          Регалии основателей — переехали сюда из hero (landing-v2 GATE B:
          hero несёт оффер, доверие живёт в social proof).
        */}
        <p
          className="sp-founder-credentials mt-5 md:mt-6 text-center mx-auto max-w-[720px]"
        >
          Сделали репетиторы — для репетиторов. Егор Блинов — преподаватель
          МФТИ, дважды 100-балльник ЕГЭ, основатель Razveday.ru. Владимир
          Камчаткин — МФТИ, Фоксфорд, Т-Образование.
        </p>

        {/* Subheader */}
        <h3 className="sp-subheader">Репетиторы используют Сократ AI</h3>

        {/*
          Cases. Order is deliberate: Елена first — её цитата «сравнивала с
          известными платформами и выбрала Сократ AI» режет скепсис холодного
          репетитора с первого взгляда. Мария вторая — видео-отзыв, authority.
          Егор третий — глубокий кейс для тех, кто уже зацепился.
        */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
          <CaseElenaCard />
          <CaseVideoCard videoSrc={TESTIMONIAL_VIDEO_SRC} />
          <CaseEgorCard />
        </div>

        {/*
          Сообщество — продолжение доказательства: сразу после живых кейсов
          показываем, где эти репетиторы общаются. Идёт ПЕРЕД «Ваш кейс?»,
          потому что тот баннер — уже просьба к читателю, а не proof.
        */}
        <CommunityBanner />

        {/* CTA для новых кейсов — отдельным slim-banner ниже сетки. */}
        <CaseYourCaseBanner />
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
            alt="Сообщение ученика Егору в Telegram: «А вы случайно не преподаёте математику подготовка к ЕГЭ? Просто мне очень нравится, как вы преподносите материал, какие плюшки в виде сайтов, ИИ вы делаете…»"
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
            aria-label="Увеличить сообщение ученика"
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
          Сообщение ученика Егору, май 2026
        </figcaption>
        {/*
          Inline fontSize — global `.sokrat:not([data-sokrat-mode]) p` rule
          has higher specificity than Tailwind `text-[13px]`/`sm:text-sm`
          and would force 16px otherwise. Inline style wins the cascade.
        */}
        <p
          className="mt-3 leading-[1.55]"
          style={{
            color: "var(--sokrat-fg2)",
            fontSize: "13px",
          }}
        >
          Раньше репетитор продавал час времени. Теперь Егор продаёт результат
          и AI-инструменты, которые ученики видят, обсуждают и рекомендуют
          друзьям. Один ученик с физики приходит за математикой, потом
          спрашивает про русский, потом приводит знакомых — потому что
          «у&nbsp;Егора есть плюшки». Сократ AI — это не инструмент проверки
          ДЗ. Это то, что превращает каждого твоего ученика в канал
          привлечения новых.
        </p>
      </figure>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Сообщение ученика Егору — увеличенный вид"
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
            src="/marketing/tutor-landing/egor-student-feedback.jpg"
            alt="Сообщение ученика Егору в Telegram — увеличенный вид"
            className="max-h-[90vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </article>
  );
}

function CaseElenaCard() {
  // Paid customer (AI-команда tariff, on platform since April 2026). Quote
  // chosen for cold-tutor appeal: «compared with known platforms and chose
  // Сократ» cuts skepticism faster than feature claims. Three bullets
  // paraphrase her own Telegram forward; emotional close keeps her voice
  // (mission framing: «польза и радость детям»).
  return (
    <article
      className="relative flex flex-col gap-3 rounded-[14px] p-5"
      style={{
        backgroundColor: "var(--sokrat-card)",
        border: "1px solid var(--sokrat-border)",
      }}
    >
      <img
        src="/marketing/tutor-landing/elena-portrait.jpg"
        alt="Елена Иванова — фото"
        width={88}
        height={88}
        loading="lazy"
        className="h-[88px] w-[88px] self-start rounded-[12px] object-cover"
        style={{
          backgroundColor: "var(--sokrat-green-100)",
          border: "1px solid var(--sokrat-border)",
        }}
      />

      <div className="sp-case-name">Елена Иванова</div>
      <div className="sp-case-regalia">
        Репетитор физики ОГЭ, ЕГЭ
      </div>
      <span className="sp-case-chip">
        ×2 учеников · Платит AI-команда · С&nbsp;апреля&nbsp;2026
      </span>

      <blockquote className="sp-case-quote">
        «Продаю групповые занятия благодаря Сократу: проверка ДЗ, пробники
        и&nbsp;самостоятельная работа — под контролем AI. Это моё УТП для
        родителей — и&nbsp;в&nbsp;2&nbsp;раза больше учеников без потери
        качества.»
      </blockquote>

      <ul className="sp-case-bullets">
        <li>Группы с Сократом как УТП — в 2 раза больше учеников.</li>
        <li>Сравнивала с известными платформами — выбрала Сократ AI.</li>
        <li>Команда добавляет функции под мои запросы.</li>
      </ul>

      <blockquote className="sp-case-quote">
        «Принести детям пользу и радость — что может быть лучше для
        преподавателя&nbsp;👍»
      </blockquote>

      <p className="sp-case-disclaimer">
        Отзыв в Telegram, май&nbsp;2026.
      </p>
    </article>
  );
}

/**
 * Community-CTA сообщества репетиторов (TG + VK).
 *
 * Визуально НАМЕРЕННО отличается от соседнего CaseYourCaseBanner: тот —
 * dashed-рамка на прозрачном фоне, этот — solid tinted. Два одинаковых
 * баннера подряд читались бы как дубль.
 *
 * Обе кнопки outline, filled запрещён (rule 90): primary-CTA лендинга —
 * «7 дней бесплатно» в Hero / Pricing / FinalCTA, сообщество с ним не
 * конкурирует. Ссылки — из констант, инлайн-хардкод запрещён: `t.me/sokrat_rep`
 * БЕЗ `/16` — это канал Егора (другая сущность, см. tutorPlanCopy.ts).
 */
function CommunityBanner() {
  return (
    <article
      className="mt-6 md:mt-8 flex flex-col gap-4 rounded-[14px] p-5 md:flex-row md:items-center md:justify-between md:p-6"
      style={{
        backgroundColor: "var(--sokrat-green-50)",
        border: "1px solid var(--sokrat-green-200)",
      }}
    >
      <div className="flex items-start gap-3 md:max-w-[58%]">
        <span
          className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full sm:flex"
          style={{
            backgroundColor: "var(--sokrat-green-100)",
            color: "var(--sokrat-green-700)",
          }}
          aria-hidden="true"
        >
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="sp-community-title">Репетиторы Сократа — рядом</h3>
          <p className="sp-community-body">
            Живой чат: обмен опытом, разбор сложных случаев и прямая линия с
            командой. Заглядывайте — здесь подскажут.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 md:shrink-0">
        <CommunityLink
          href={SOKRAT_COMMUNITY_TELEGRAM_URL}
          goal="tutor_landing_community_tg_click"
          icon={<Send className="h-4 w-4" aria-hidden="true" />}
          label="Чат в Telegram"
        />
        <CommunityLink
          href={SOKRAT_COMMUNITY_VK_URL}
          goal="tutor_landing_community_vk_click"
          icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
          label="Чат в VK"
        />
      </div>
    </article>
  );
}

function CommunityLink({
  href,
  goal,
  icon,
  label,
}: {
  href: string;
  goal: "tutor_landing_community_tg_click" | "tutor_landing_community_vk_click";
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackTutorLandingGoal(goal)}
      style={{
        color: "var(--sokrat-green-700)",
        borderColor: "var(--sokrat-green-700)",
        backgroundColor: "var(--sokrat-surface)",
        touchAction: "manipulation",
      }}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-md border-2 px-4 text-sm font-semibold transition-colors hover:bg-[color:var(--sokrat-green-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    >
      {icon}
      {label}
    </a>
  );
}

function CaseYourCaseBanner() {
  // Was a 3rd grid cell with dashed border. Promoted to a full-width banner
  // below the grid so 3 real testimonials get equal horizontal weight. Banner
  // stays dashed-green for visual continuity with the prior "Ваш кейс?" card.
  return (
    <article
      className="mt-6 md:mt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-[14px] p-5 md:p-6"
      style={{
        backgroundColor: "transparent",
        border: "2px dashed var(--sokrat-green-200)",
      }}
    >
      <div className="md:max-w-[60%]">
        <h3 className="sp-your-case-title">Ваш кейс?</h3>
        <p className="sp-your-case-banner-body">
          Расскажите, как Сократ AI поменял вашу работу. Разместим в этой секции.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 md:shrink-0">
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
