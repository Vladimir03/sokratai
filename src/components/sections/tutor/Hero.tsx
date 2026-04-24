import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";

const TELEGRAM_CHANNEL_URL = "https://t.me/sokrat_rep";
const SIGNUP_URL = "/signup?ref=tutor-landing&tier=ai-start";

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
      `}</style>

      <div className="relative mx-auto max-w-[800px] px-6 md:px-8 py-[80px] pb-[56px] md:py-[120px] md:pb-[80px] text-left">
        <h1 id="tutor-hero-headline">
          Инструмент репетитора. От&nbsp;репетитора.
        </h1>

        <p
          className="lede mt-6"
          style={{ color: "var(--sokrat-fg1)" }}
        >
          AI проверяет рукописные ДЗ по физике, математике и информатике. Ведёт
          ученика сократовским диалогом вместо готового ответа. Собирает ДЗ из
          вашей базы за 5 минут.
        </p>

        <p
          className="mt-4 text-[15px] leading-[1.6]"
          style={{ color: "var(--sokrat-fg3)" }}
        >
          Создатели — Егор Блинов (преподаватель МФТИ, дважды 100-балльник ЕГЭ,
          основатель онлайн-школы Razveday.ru) и Владимир Камчаткин (МФТИ,
          Фоксфорд, Т-Образование).
        </p>

        <div className="mt-8 flex flex-col sm:flex-row flex-wrap gap-3">
          <Button
            asChild
            size="lg"
            className="min-h-[52px] rounded-lg px-6 text-base font-semibold text-white shadow-elegant transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 w-full sm:w-auto"
            style={{
              backgroundColor: "var(--sokrat-green-700)",
            }}
          >
            <Link to={SIGNUP_URL}>Попробовать за 200&nbsp;₽ в первый месяц</Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="lg"
            className="min-h-[52px] rounded-lg border-2 bg-transparent px-6 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 w-full sm:w-auto"
            style={{
              borderColor: "var(--sokrat-green-700)",
              color: "var(--sokrat-green-700)",
            }}
          >
            <a
              href={TELEGRAM_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Канал Егора →
            </a>
          </Button>
        </div>

        <ul
          className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[13px]"
          style={{ color: "var(--sokrat-fg3)" }}
        >
          <li className="flex items-center gap-1.5">
            <CheckMark />
            200&nbsp;₽ — первый месяц полного доступа
          </li>
          <li className="flex items-center gap-1.5">
            <CheckMark />
            Отмена в один клик
          </li>
          <li className="flex items-center gap-1.5">
            <CheckMark />
            Оплаты и расписание бесплатно навсегда
          </li>
        </ul>
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
