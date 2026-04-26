import { Link } from "react-router-dom";

import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";

export default function FinalCTA() {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className="py-14 md:py-24 text-center text-white"
      style={{ background: "var(--sokrat-gradient-hero-soft)" }}
    >
      {/* Scoped overrides — marketing-global h2 forces green-800, we need white */}
      <style>{`
        .sokrat.sokrat-marketing .final-cta-h2 {
          color: var(--sokrat-fg-on-dark);
        }
      `}</style>

      <div className="mx-auto max-w-[720px] px-4 md:px-8">
        <h2
          id="final-cta-heading"
          className="final-cta-h2 mb-4"
        >
          Готовы перестать проверять до полуночи?
        </h2>

        <p
          className="lede mx-auto mb-8 max-w-[640px]"
          style={{ color: "rgba(255, 255, 255, 0.9)" }}
        >
          Попробуйте Сократ AI за 200 ₽ в первый месяц. Отмена в один клик — в
          любой момент, без объяснений. Базовая платформа (оплаты, расписание)
          остаётся бесплатной в любом случае.
        </p>

        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <Link
            to="/signup?ref=tutor-landing&tier=ai-start"
            onClick={() => trackTutorLandingGoal("tutor_landing_cta_final")}
            className="inline-flex items-center justify-center rounded-lg px-6 text-base font-semibold transition-colors hover:bg-[color:var(--sokrat-green-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 w-full sm:w-auto"
            style={{
              backgroundColor: "var(--sokrat-fg-on-dark)",
              color: "var(--sokrat-green-800)",
              minHeight: 52,
            }}
          >
            Попробовать за 200&nbsp;₽
          </Link>

          <a
            href="https://t.me/sokrat_rep"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackTutorLandingGoal("tutor_landing_tg_channel_click")
            }
            className="inline-flex items-center justify-center rounded-lg px-6 text-base font-semibold border-2 bg-transparent transition-colors hover:bg-[rgba(255,255,255,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 w-full sm:w-auto"
            style={{
              color: "var(--sokrat-fg-on-dark)",
              // rgba — translucent border overlay (not a brand color); no token for white 40% opacity
              borderColor: "rgba(255, 255, 255, 0.4)",
              minHeight: 52,
            }}
          >
            Канал Егора →
          </a>
        </div>
      </div>
    </section>
  );
}
