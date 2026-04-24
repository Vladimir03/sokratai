import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type Tier = {
  id: string;
  label: string;
  price: ReactNode;
  priceCaption: string;
  perDay?: string;
  features: ReactNode[];
  cta: { label: string; href: string; external: boolean; variant: "primary" | "secondary" };
  highlighted?: {
    popularChip: string;
    oldPrice: string;
    savingsInline: string;
    savingsCaption: string;
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
      "Конструктор ДЗ с привязкой к ФИПИ",
      "Отчёты родителям",
    ],
    cta: {
      label: "Попробовать за 200 ₽",
      href: "/signup?ref=tutor-landing&tier=ai-start",
      external: false,
      variant: "primary",
    },
    highlighted: {
      popularChip: "Популярно",
      oldPrice: "1 000 ₽/мес",
      savingsInline: "−80%",
      savingsCaption: "Экономия 800 ₽ первый месяц",
    },
  },
  {
    id: "plus",
    label: "AI-плюс",
    price: (
      <>
        1 000 ₽<span className="sp-price-suffix">/мес</span>
      </>
    ),
    priceCaption: "до 10 учеников на AI-слое",
    perDay: "33 ₽ в день",
    features: ["Всё из «AI-Старт»", "До 10 учеников на AI-слое"],
    cta: {
      label: "Выбрать",
      href: "/signup?ref=tutor-landing&tier=plus",
      external: false,
      variant: "secondary",
    },
  },
  {
    id: "pro",
    label: "AI-про",
    price: (
      <>
        2 000 ₽<span className="sp-price-suffix">/мес</span>
      </>
    ),
    priceCaption: "до 20 учеников на AI-слое",
    perDay: "67 ₽ в день",
    features: ["Всё из «AI-Плюс»", "До 20 учеников на AI-слое"],
    cta: {
      label: "Выбрать",
      href: "/signup?ref=tutor-landing&tier=pro",
      external: false,
      variant: "secondary",
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
      "Всё из «AI-Про»",
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
          grid-template-columns: repeat(5, 1fr);
          gap: 16px;
          max-width: 1200px;
          margin: 0 auto 48px;
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
          color: #fff;
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
          color: #fff;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.02em;
          line-height: 1.2;
          box-shadow: 0 2px 6px rgba(232, 145, 58, 0.35);
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
        }
        .sokrat.sokrat-marketing .pp-cta--primary {
          background: var(--sokrat-green-700);
          color: #fff;
        }
        .sokrat.sokrat-marketing .pp-cta--primary:hover { background: var(--sokrat-green-800); }
        .sokrat.sokrat-marketing .pp-cta--secondary {
          background: transparent;
          color: var(--sokrat-green-700);
          border: 1px solid var(--sokrat-green-200);
        }
        .sokrat.sokrat-marketing .pp-cta--secondary:hover { background: var(--sokrat-green-50); }

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
          font-weight: 800;
          margin-right: 4px;
        }
        .sokrat.sokrat-marketing .pp-roi-line strong {
          color: var(--sokrat-green-800);
          font-weight: 700;
        }

        /* Media queries AFTER base rules so same-specificity overrides win */
        @media (max-width: 1200px) {
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

      {tier.highlighted && (
        <div className="pp-price-row">
          <span className="pp-price-old">{tier.highlighted.oldPrice}</span>
          <span className="pp-savings-inline">{tier.highlighted.savingsInline}</span>
        </div>
      )}

      <div className={priceClass}>{tier.price}</div>

      {tier.highlighted && (
        <div className="pp-savings-caption">{tier.highlighted.savingsCaption}</div>
      )}

      <div className="pp-caption">{tier.priceCaption}</div>

      {tier.perDay && <div className="pp-per-day">{tier.perDay}</div>}

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
        <Link to={tier.cta.href} className={ctaClass}>
          {tier.cta.label}
        </Link>
      )}
    </article>
  );
}
