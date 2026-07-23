import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";
import {
  SOKRAT_COMMUNITY_TELEGRAM_URL,
  SOKRAT_COMMUNITY_VK_URL,
} from "@/lib/tutorPlanCopy";

import HeroSecondLookStory from "./HeroSecondLookStory";

const SIGNUP_URL = "/signup?ref=tutor-landing&trial=7";
const TG_BLUE = "#229ED9";
const VK_BLUE = "#0077FF";

/**
 * Hero v2 (landing-v2, GATE B 2026-07-23): оффер V1 «×2 учеников» (кейс
 * Елены) + вау W1 (HeroSecondLookStory) + мультипредметная строка.
 * Регалии основателей переехали в SocialProof. Вторичные CTA — чаты
 * сообщества TG/VK (константы tutorPlanCopy, цели community_{tg,vk} уже
 * заведены в Метрике 2026-07-20 — новых целей не требуется, rule 101).
 */
export default function Hero() {
  return (
    <section
      id="hero"
      className="tutor-hero relative overflow-hidden"
      aria-labelledby="tutor-hero-headline"
    >
      {/*
        Animated background layers (marketing-only, scoped).
        Respects prefers-reduced-motion: reduce — keyframe disabled.
      */}
      <style>{`
        .tutor-hero {
          background:
            radial-gradient(ellipse at top left, var(--sokrat-green-50) 0%, transparent 60%),
            radial-gradient(ellipse at bottom right, var(--sokrat-green-100) 0%, transparent 60%),
            var(--sokrat-surface);
        }
        .tutor-hero::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            135deg,
            rgba(27, 107, 74, 0.04) 0%,
            rgba(27, 107, 74, 0.00) 40%,
            rgba(27, 107, 74, 0.06) 100%
          );
          animation: tutor-hero-shift 20s ease-in-out infinite alternate;
        }
        @keyframes tutor-hero-shift {
          from { background-position: 0% 0%; opacity: 1; }
          to   { background-position: 100% 100%; opacity: 0.6; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tutor-hero::before { animation: none; }
        }
        /* Глобальные marketing-правила p форсируют 16px — пруф-строкам нужен
           свой размер (тот же приём scoped-override, что в Pain/SocialProof). */
        .sokrat.sokrat-marketing .hero-proof-line {
          font-size: 14px;
          line-height: 1.5;
        }
        .sokrat.sokrat-marketing .hero-subjects {
          font-size: 13px;
          line-height: 1.5;
        }
      `}</style>

      <div className="relative mx-auto max-w-[1140px] px-6 md:px-8 pt-[48px] pb-[56px] md:pt-[72px] md:pb-[80px]">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-10 lg:gap-14 items-start">
          <div className="text-left">
            <span
              className="mb-6 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
              style={{
                backgroundColor: "var(--sokrat-green-100)",
                color: "var(--sokrat-green-800)",
              }}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: "var(--sokrat-green-700)" }}
              />
              🎁 7 дней пробного периода — без карты
            </span>

            <h1 id="tutor-hero-headline" className="mb-7">
              Ведите в&nbsp;2&nbsp;раза больше учеников&nbsp;— без ночной
              проверки&nbsp;ДЗ
            </h1>

            <p className="lede mb-4" style={{ color: "var(--sokrat-fg1)" }}>
              Сократ проверяет рукописные домашки по критериям ФИПИ и ведёт
              ученика к решению, пока вас нет рядом. Вы только подтверждаете
              балл и даёте итог — за минуты, а не за вечер.
            </p>

            <p className="hero-subjects mb-6" style={{ color: "var(--sokrat-fg3)" }}>
              Физика · Математика · Обществознание · Русский · Информатика ·
              Иностранные языки — ЕГЭ и&nbsp;ОГЭ
            </p>

            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="min-h-[52px] rounded-lg px-6 text-base font-semibold text-white shadow-elegant transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 w-full sm:w-auto"
                style={{
                  backgroundColor: "var(--sokrat-green-700)",
                }}
              >
                <Link
                  to={SIGNUP_URL}
                  onClick={() =>
                    trackTutorLandingGoal("tutor_landing_cta_trial_hero")
                  }
                >
                  🎁 Попробовать 7&nbsp;дней бесплатно
                </Link>
              </Button>
            </div>

            {/*
              Чаты сообщества (замена «Канала Егора» в hero — решение GATE B):
              outline, не спорят с primary (rule 90). Ссылки ТОЛЬКО из
              tutorPlanCopy — инлайн-хардкод запрещён (чат ≠ канал!).
            */}
            <div className="mt-3 flex flex-wrap gap-3">
              <a
                href={SOKRAT_COMMUNITY_TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackTutorLandingGoal("tutor_landing_community_tg_click")
                }
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 bg-transparent px-4 text-sm font-medium transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ borderColor: TG_BLUE, color: TG_BLUE, touchAction: "manipulation" }}
              >
                Чат репетиторов в Telegram →
              </a>
              <a
                href={SOKRAT_COMMUNITY_VK_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackTutorLandingGoal("tutor_landing_community_vk_click")
                }
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 bg-transparent px-4 text-sm font-medium transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ borderColor: VK_BLUE, color: VK_BLUE, touchAction: "manipulation" }}
              >
                Чат в VK →
              </a>
            </div>

            {/* Пруф-строки (вместо абзаца с регалиями — те в SocialProof) */}
            <div className="mt-7 flex flex-col gap-2.5">
              <p className="hero-proof-line" style={{ color: "var(--sokrat-fg2)" }}>
                <strong style={{ color: "var(--sokrat-fg1)" }}>
                  Елена, репетитор по&nbsp;физике:
                </strong>{" "}
                ведёт в&nbsp;2&nbsp;раза больше учеников — продаёт группы
                с&nbsp;Сократом как своё УТП: проверка ДЗ, пробники
                и&nbsp;самостоятельная работа под контролем AI.
              </p>
              <p className="hero-proof-line" style={{ color: "var(--sokrat-fg2)" }}>
                <strong style={{ color: "var(--sokrat-fg1)" }}>
                  Егор, преподаватель МФТИ:
                </strong>{" "}
                освободил ~10&nbsp;часов в&nbsp;неделю на проверке ДЗ, учёте
                оплат и&nbsp;отчётах родителям.
              </p>
            </div>

            <ul
              className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[13px]"
              style={{ color: "var(--sokrat-fg3)" }}
            >
              <li className="flex items-center gap-1.5">
                <CheckMark />
                Без карты
              </li>
              <li className="flex items-center gap-1.5">
                <CheckMark />
                Полный AI-доступ
              </li>
              <li className="flex items-center gap-1.5">
                <CheckMark />
                Потом 200&nbsp;₽ — первый месяц
              </li>
              <li className="flex items-center gap-1.5">
                <CheckMark />
                Отмена в один клик
              </li>
            </ul>
          </div>

          {/* W1 — скрин-стори «второй взгляд» (на мобиле — после текста) */}
          <div className="max-w-[420px] lg:max-w-none lg:pt-10">
            <HeroSecondLookStory />
          </div>
        </div>
      </div>
    </section>
  );
}

function CheckMark() {
  return (
    <span
      aria-hidden="true"
      className="font-bold"
      style={{ color: "var(--sokrat-green-700)" }}
    >
      ✓
    </span>
  );
}
