import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";

type Tier = {
  id: string;
  label: string;
  price: ReactNode;
  priceCaption: string;
  perDay?: string;
  features: ReactNode[];
  cta: {
    label: string;
    href: string;
    external: boolean;
    variant: "primary" | "secondary";
    microcopy?: string;
  };
  highlighted?: {
    popularChip: string;
    oldPrice: string;
    savingsInline: string;
    savingsCaption: string;
  };
  /**
   * Price-stack: лестница 0 → 200 → 1000 для AI-старт.
   * Если задан — заменяет дефолтный рендер price-row + price + caption + perDay.
   */
  priceStack?: {
    trialLine: string;
    anchorOldPrice: string;
    anchorChip: string;
    bigPrice: ReactNode;
    bigPriceCaption: string;
    followupLine: string;
  };
};

const TIERS: Tier[] = [
  {
    id: "free",
    label: "Бесплатно",
    price: "0 ₽",
    priceCaption: "навсегда, без карты",
    features: [
      <>
        Оплаты учеников + команда{" "}
        <code className="sp-code">/pay</code> в Telegram
      </>,
      "Расписание + напоминания",
      "Профили учеников, группы, история",
      "Заметки для себя",
    ],
    cta: {
      label: "Начать бесплатно",
      href: "/signup?ref=tutor-landing&tier=free",
      external: false,
      variant: "secondary",
    },
  },
  {
    id: "ai-start",
    label: "AI-старт",
    price: "200 ₽",
    priceCaption:
      "первый месяц, любое число учеников · далее — по числу учеников",
    features: [
      "Всё из «Бесплатно»",
      "AI-проверка рукописных ДЗ",
      "Сократовский AI-диалог с учениками",
      "50 AI-сообщений в день для каждого ученика в ДЗ",
      "Конструктор ДЗ с привязкой к ФИПИ",
      "Отчёты родителям",
    ],
    cta: {
      label: "🎁 Начать пробный — без карты",
      href: "/signup?ref=tutor-landing&trial=7",
      external: false,
      variant: "primary",
      microcopy: "Через 7 дней спросим, продолжать ли. Не списываем сами.",
    },
    highlighted: {
      popularChip: "7 дней бесплатно",
      oldPrice: "1 000 ₽/мес",
      savingsInline: "−80%",
      savingsCaption: "Экономия 800 ₽ первый месяц",
    },
    priceStack: {
      trialLine: "Сегодня: 0 ₽ — 7 дней полного AI",
      anchorOldPrice: "1 000 ₽/мес",
      anchorChip: "−80%",
      bigPrice: "200 ₽",
      bigPriceCaption: "первый месяц после trial — экономия 800 ₽",
      followupLine: "Со 2-го месяца: от 1 000 ₽/мес по числу учеников",
    },
  },
  {
    id: "team",
    label: "AI-команда",
    price: (
      <>
        от 3 000 ₽<span className="sp-price-suffix">/мес</span>
      </>
    ),
    priceCaption: "для репетиторов 20+ учеников и онлайн-школ",
    perDay: "от 100 ₽ в день",
    features: [
      "Всё из «AI-старт»",
      "20+ учеников на AI-слое",
      "Группы и команды репетиторов в одном аккаунте",
      "White-label для онлайн-школ",
      "Персональный онбординг команды",
      "Приоритетная поддержка",
    ],
    cta: {
      label: "Связаться",
      href: "https://t.me/Analyst_Vladimir",
      external: true,
      variant: "secondary",
    },
  },
];

type ExtraTier = {
  id: string;
  emoji: string;
  body: ReactNode;
};

const EXTRA_TIERS: ExtraTier[] = [
  {
    id: "plus",
    emoji: "🔟",
    body: (
      <>
        До 10 учеников на AI? — <strong>1 000 ₽/мес</strong> со 2-го месяца
      </>
    ),
  },
  {
    id: "pro",
    emoji: "2️⃣0️⃣",
    body: (
      <>
        До 20 учеников на AI? — <strong>2 000 ₽/мес</strong> со 2-го месяца
      </>
    ),
  },
];

export default function Pricing() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="py-14 md:py-24"
      style={{ backgroundColor: "var(--sokrat-surface)" }}
    >
      {/* Scoped pricing styles (tokens only) */}
      <style>{`
        .sokrat.sokrat-marketing .pp-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          max-width: 1100px;
          margin: 0 auto 24px;
          padding: 0 32px;
        }
        .sokrat.sokrat-marketing .pp-card {
          position: relative;
          background: var(--sokrat-card);
          border: 1px solid var(--sokrat-border);
          border-radius: var(--sokrat-radius-lg);
          padding: 24px 20px;
          display: flex;
          flex-direction: column;
          transition: box-shadow 200ms;
        }
        .sokrat.sokrat-marketing .pp-card:hover { box-shadow: var(--sokrat-shadow-sm); }
        .sokrat.sokrat-marketing .pp-card--highlighted {
          border: 2px solid var(--sokrat-green-700);
          box-shadow: var(--sokrat-shadow-md);
          transform: scale(1.02);
        }

        .sokrat.sokrat-marketing .pp-popular-chip {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          padding: 4px 12px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          background: var(--sokrat-ochre-500);
          color: var(--sokrat-fg-on-dark);
          border-radius: var(--sokrat-radius-full);
          white-space: nowrap;
        }

        .sokrat.sokrat-marketing .pp-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--sokrat-fg3);
          margin-bottom: 12px;
        }
        .sokrat.sokrat-marketing .pp-card--highlighted .pp-label {
          color: var(--sokrat-green-700);
        }

        .sokrat.sokrat-marketing .pp-price {
          font-size: 28px;
          font-weight: 700;
          color: var(--sokrat-fg1);
          line-height: 1.1;
          margin-bottom: 4px;
        }
        .sokrat.sokrat-marketing .pp-price--ochre {
          color: var(--sokrat-ochre-700);
        }
        .sokrat.sokrat-marketing .sp-price-suffix {
          font-size: 14px;
          color: var(--sokrat-fg3);
          font-weight: 400;
        }

        .sokrat.sokrat-marketing .pp-caption {
          font-size: 12px;
          color: var(--sokrat-fg3);
          margin-bottom: 20px;
          line-height: 1.4;
          min-height: 32px;
        }

        .sokrat.sokrat-marketing .pp-price-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .sokrat.sokrat-marketing .pp-price-old {
          font-size: 15px;
          color: var(--sokrat-fg3);
          text-decoration: line-through;
          text-decoration-thickness: 2px;
          font-weight: 500;
          line-height: 1;
        }
        .sokrat.sokrat-marketing .pp-savings-inline {
          display: inline-block;
          padding: 3px 9px;
          background: var(--sokrat-ochre-500);
          color: var(--sokrat-fg-on-dark);
          border-radius: 6px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.02em;
          line-height: 1.2;
        }
        .sokrat.sokrat-marketing .pp-savings-caption {
          font-size: 13px;
          font-weight: 700;
          color: var(--sokrat-ochre-700);
          margin-top: 2px;
          margin-bottom: 8px;
        }
        .sokrat.sokrat-marketing .pp-per-day {
          font-size: 12px;
          color: var(--sokrat-ochre-700);
          font-weight: 700;
          margin-top: 6px;
          margin-bottom: 8px;
        }
        .sokrat.sokrat-marketing .pp-per-day::before { content: "≈ "; opacity: 0.7; }

        /* Price-stack — лестница 0 → 200 → 1000 для AI-старт */
        .sokrat.sokrat-marketing .pp-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 16px;
        }
        .sokrat.sokrat-marketing .pp-stack-trial {
          display: inline-flex;
          align-items: center;
          padding: 6px 10px;
          background: var(--sokrat-ochre-100, rgba(232, 145, 58, 0.12));
          color: var(--sokrat-ochre-700);
          border-radius: var(--sokrat-radius-sm);
          font-size: 13px;
          font-weight: 700;
          line-height: 1.3;
        }
        .sokrat.sokrat-marketing .pp-stack-anchor {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sokrat.sokrat-marketing .pp-stack-big {
          font-size: 28px;
          font-weight: 700;
          color: var(--sokrat-fg1);
          line-height: 1.1;
        }
        .sokrat.sokrat-marketing .pp-stack-big-caption {
          font-size: 12px;
          color: var(--sokrat-fg3);
          line-height: 1.4;
        }
        .sokrat.sokrat-marketing .pp-stack-followup {
          font-size: 12px;
          color: var(--sokrat-fg2);
          line-height: 1.4;
          padding-top: 8px;
          border-top: 1px dashed var(--sokrat-border);
        }

        .sokrat.sokrat-marketing .pp-features {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 24px;
          flex: 1;
          list-style: none;
          padding: 0;
        }
        .sokrat.sokrat-marketing .pp-feature {
          font-size: 13px;
          color: var(--sokrat-fg2);
          line-height: 1.45;
          padding-left: 20px;
          position: relative;
        }
        .sokrat.sokrat-marketing .pp-feature::before {
          content: "✓";
          position: absolute;
          left: 0;
          top: 0;
          color: var(--sokrat-green-700);
          font-weight: 700;
        }

        .sokrat.sokrat-marketing .sp-code {
          background: var(--sokrat-green-100);
          color: var(--sokrat-green-800);
          padding: 1px 5px;
          border-radius: 4px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
        }

        .sokrat.sokrat-marketing .pp-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 16px;
          min-height: 44px;
          font-size: 14px;
          font-weight: 600;
          border-radius: var(--sokrat-radius-sm);
          transition: background-color 150ms;
          text-align: center;
        }
        .sokrat.sokrat-marketing .pp-cta--primary {
          background: var(--sokrat-green-700);
          color: var(--sokrat-fg-on-dark);
        }
        .sokrat.sokrat-marketing .pp-cta--primary:hover { background: var(--sokrat-green-800); }
        .sokrat.sokrat-marketing .pp-cta--secondary {
          background: transparent;
          color: var(--sokrat-green-700);
          border: 1px solid var(--sokrat-green-200);
        }
        .sokrat.sokrat-marketing .pp-cta--secondary:hover { background: var(--sokrat-green-50); }
        .sokrat.sokrat-marketing .pp-cta-microcopy {
          font-size: 12px;
          color: var(--sokrat-fg3);
          line-height: 1.4;
          margin-top: 8px;
          text-align: center;
        }

        /* Extra-row: 2 компактных карточки под основным grid */
        .sokrat.sokrat-marketing .pricing-extra-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          max-width: 800px;
          margin: 0 auto 48px;
          padding: 0 32px;
        }
        .sokrat.sokrat-marketing .pricing-extra-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          background: var(--sokrat-card);
          border: 1px solid var(--sokrat-border);
          border-radius: var(--sokrat-radius-md);
          font-size: 14px;
          color: var(--sokrat-fg2);
          line-height: 1.45;
        }
        .sokrat.sokrat-marketing .pricing-extra-card strong {
          color: var(--sokrat-fg1);
          font-weight: 700;
        }
        .sokrat.sokrat-marketing .pricing-extra-emoji {
          font-size: 22px;
          flex-shrink: 0;
          line-height: 1;
        }

        .sokrat.sokrat-marketing .pp-roi-box {
          max-width: 800px;
          margin: 0 auto;
          padding: 32px 40px;
          background: var(--sokrat-green-50);
          border: 1px solid var(--sokrat-green-100);
          border-radius: var(--sokrat-radius-lg);
          box-shadow: var(--sokrat-shadow-elegant);
        }
        .sokrat.sokrat-marketing .pp-roi-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--sokrat-green-800);
          text-align: center;
          margin-bottom: 16px;
        }
        .sokrat.sokrat-marketing .pp-roi-lines {
          display: flex;
          flex-direction: column;
          gap: 12px;
          text-align: center;
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .sokrat.sokrat-marketing .pp-roi-line {
          font-size: 17px;
          color: var(--sokrat-fg1);
          line-height: 1.5;
          font-weight: 500;
        }
        .sokrat.sokrat-marketing .pp-roi-line::before {
          content: "✓ ";
          color: var(--sokrat-ochre-700);
          font-weight: 700;
          margin-right: 4px;
        }
        .sokrat.sokrat-marketing .pp-roi-line strong {
          color: var(--sokrat-green-800);
          font-weight: 700;
        }

        /* Media queries AFTER base rules so same-specificity overrides win */
        @media (max-width: 1024px) {
          .sokrat.sokrat-marketing .pp-grid {
            grid-template-columns: repeat(2, 1fr);
            padding: 0 24px;
          }
          .sokrat.sokrat-marketing .pp-card--highlighted {
            transform: none;
          }
        }
        @media (max-width: 640px) {
          .sokrat.sokrat-marketing .pp-grid {
            grid-template-columns: 1fr;
            padding: 0 16px;
            gap: 12px;
          }
          .sokrat.sokrat-marketing .pricing-extra-row {
            grid-template-columns: 1fr;
            padding: 0 16px;
          }
          .sokrat.sokrat-marketing .pp-roi-box {
            padding: 24px 20px;
            margin-left: 16px;
            margin-right: 16px;
          }
          .sokrat.sokrat-marketing .pp-roi-line {
            font-size: 15px;
          }
        }
      `}</style>

      <div className="mx-auto max-w-[1200px] px-4 md:px-8">
        <h2
          id="pricing-heading"
          className="text-center mb-7 md:mb-12"
          style={{ maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}
        >
          Начните бесплатно. Масштабируйтесь платно.
        </h2>
      </div>

      <div className="pp-grid">
        {TIERS.map((tier) => (
          <PricingCard key={tier.id} tier={tier} />
        ))}
      </div>

      <div className="pricing-extra-row">
        {EXTRA_TIERS.map((extra) => (
          <div key={extra.id} className="pricing-extra-card">
            <span className="pricing-extra-emoji" aria-hidden="true">
              {extra.emoji}
            </span>
            <span>{extra.body}</span>
          </div>
        ))}
      </div>

      <div className="pp-roi-box">
        <div className="pp-roi-title">Окупаемость первой неделей</div>
        <ul className="pp-roi-lines">
          <li className="pp-roi-line">
            Один час вашего времени — <strong>1,5–2 тысячи рублей</strong>
          </li>
          <li className="pp-roi-line">
            Экономия трёх часов в неделю —{" "}
            <strong>4,5–6 тысяч в месяц</strong>
          </li>
          <li className="pp-roi-line">
            Платформа окупается <strong>первой неделей</strong> использования
          </li>
        </ul>
      </div>
    </section>
  );
}

function PricingCard({ tier }: { tier: Tier }) {
  const cardClass = tier.highlighted ? "pp-card pp-card--highlighted" : "pp-card";
  const ctaClass =
    tier.cta.variant === "primary" ? "pp-cta pp-cta--primary" : "pp-cta pp-cta--secondary";
  const priceClass = tier.highlighted ? "pp-price pp-price--ochre" : "pp-price";

  return (
    <article className={cardClass}>
      {tier.highlighted && (
        <span className="pp-popular-chip">{tier.highlighted.popularChip}</span>
      )}

      <div className="pp-label">{tier.label}</div>

      {tier.priceStack ? (
        <div className="pp-stack">
          <span className="pp-stack-trial">{tier.priceStack.trialLine}</span>

          <div className="pp-stack-anchor">
            <span className="pp-price-old">{tier.priceStack.anchorOldPrice}</span>
            <span className="pp-savings-inline">{tier.priceStack.anchorChip}</span>
          </div>

          <div className="pp-stack-big">{tier.priceStack.bigPrice}</div>
          <div className="pp-stack-big-caption">
            {tier.priceStack.bigPriceCaption}
          </div>

          <div className="pp-stack-followup">{tier.priceStack.followupLine}</div>
        </div>
      ) : (
        <>
          {tier.highlighted && (
            <div className="pp-price-row">
              <span className="pp-price-old">{tier.highlighted.oldPrice}</span>
              <span className="pp-savings-inline">
                {tier.highlighted.savingsInline}
              </span>
            </div>
          )}

          <div className={priceClass}>{tier.price}</div>

          {tier.highlighted && (
            <div className="pp-savings-caption">
              {tier.highlighted.savingsCaption}
            </div>
          )}

          <div className="pp-caption">{tier.priceCaption}</div>

          {tier.perDay && <div className="pp-per-day">{tier.perDay}</div>}
        </>
      )}

      <ul className="pp-features">
        {tier.features.map((feat, i) => (
          <li key={i} className="pp-feature">
            {feat}
          </li>
        ))}
      </ul>

      {tier.cta.external ? (
        <a
          href={tier.cta.href}
          target="_blank"
          rel="noopener noreferrer"
          className={ctaClass}
        >
          {tier.cta.label}
        </a>
      ) : (
        <Link
          to={tier.cta.href}
          onClick={
            tier.id === "ai-start"
              ? () => trackTutorLandingGoal("tutor_landing_cta_trial_pricing")
              : undefined
          }
          className={ctaClass}
        >
          {tier.cta.label}
        </Link>
      )}

      {tier.cta.microcopy && (
        <div className="pp-cta-microcopy">{tier.cta.microcopy}</div>
      )}
    </article>
  );
}
