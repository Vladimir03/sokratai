import { Send } from "lucide-react";
import { Link } from "react-router-dom";

import sokratLogo from "@/assets/sokrat-logo.png";

type FooterLink = {
  label: string;
  href: string;
  kind: "internal" | "external" | "hash" | "mailto" | "placeholder";
};

const PRODUCT_LINKS: FooterLink[] = [
  { label: "Для репетиторов", href: "/tutors", kind: "internal" },
  { label: "Для учеников и родителей", href: "/students", kind: "internal" },
  { label: "Цены", href: "#pricing", kind: "hash" },
  { label: "Помощь", href: "https://t.me/sokrat_rep", kind: "external" },
];

const COMPANY_LINKS: FooterLink[] = [
  { label: "О Сократе", href: "#", kind: "placeholder" },
  { label: "Блог", href: "#", kind: "placeholder" },
  {
    label: "Канал Егора (@sokrat_rep)",
    href: "https://t.me/sokrat_rep",
    kind: "external",
  },
  {
    label: "Написать Владимиру в Telegram",
    href: "https://t.me/Analyst_Vladimir",
    kind: "external",
  },
  {
    label: "Написать Владимиру на email",
    href: "mailto:volodyakamchatkin@gmail.com",
    kind: "mailto",
  },
  {
    label: "Поддержка",
    href: "https://t.me/sokrat_rep",
    kind: "external",
  },
];

const LEGAL_LINKS: FooterLink[] = [
  {
    label: "Политика конфиденциальности",
    href: "mailto:volodyakamchatkin@gmail.com?subject=%D0%9F%D0%BE%D0%BB%D0%B8%D1%82%D0%B8%D0%BA%D0%B0%20%D0%BA%D0%BE%D0%BD%D1%84%D0%B8%D0%B4%D0%B5%D0%BD%D1%86%D0%B8%D0%B0%D0%BB%D1%8C%D0%BD%D0%BE%D1%81%D1%82%D0%B8%20%E2%80%94%20%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81",
    kind: "mailto",
  },
  {
    label: "Пользовательское соглашение",
    href: "mailto:volodyakamchatkin@gmail.com?subject=%D0%9F%D0%BE%D0%BB%D1%8C%D0%B7%D0%BE%D0%B2%D0%B0%D1%82%D0%B5%D0%BB%D1%8C%D1%81%D0%BA%D0%BE%D0%B5%20%D1%81%D0%BE%D0%B3%D0%BB%D0%B0%D1%88%D0%B5%D0%BD%D0%B8%D0%B5%20%E2%80%94%20%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81",
    kind: "mailto",
  },
  {
    label: "Оферта",
    href: "mailto:volodyakamchatkin@gmail.com?subject=%D0%9E%D1%84%D0%B5%D1%80%D1%82%D0%B0%20%E2%80%94%20%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81",
    kind: "mailto",
  },
];

const PAYMENT_BADGES = ["МИР", "Visa", "Mastercard", "СБП", "ЮMoney"];

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className =
    "text-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:underline";
  const style = { color: "var(--sokrat-fg-on-dark-dim)" } as const;

  if (link.kind === "internal") {
    return (
      <Link to={link.href} className={className} style={style}>
        {link.label}
      </Link>
    );
  }

  const extraProps =
    link.kind === "external"
      ? { target: "_blank" as const, rel: "noopener noreferrer" as const }
      : {};

  return (
    <a href={link.href} className={className} style={style} {...extraProps}>
      {link.label}
    </a>
  );
}

export default function Footer() {
  return (
    <footer
      className="pb-8 pt-16"
      style={{
        backgroundColor: "var(--sokrat-green-900)",
        color: "var(--sokrat-fg-on-dark-dim)",
      }}
    >
      <div className="mx-auto max-w-[1120px] px-4 md:px-8">
        {/* Top row */}
        <div className="mb-8 flex flex-col items-start gap-5 md:mb-10 md:flex-row md:items-center md:justify-between md:gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-white text-xl font-bold"
            aria-label="Сократ AI — на главную"
          >
            <img src={sokratLogo} alt="" width={28} height={28} />
            Сократ AI
          </Link>
          <div className="flex gap-3">
            <a
              href="https://t.me/sokrat_rep"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram-канал Егора"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-[rgba(255,255,255,0.2)]"
              style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
            >
              <Send aria-hidden="true" className="h-5 w-5" />
            </a>
          </div>
        </div>

        {/* 3 columns */}
        <div className="mb-10 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-12">
          <FooterColumn title="Продукт" links={PRODUCT_LINKS} />
          <FooterColumn title="Компания" links={COMPANY_LINKS} />
          <FooterColumn title="Правовая информация" links={LEGAL_LINKS} />
        </div>

        {/* Divider */}
        <div
          className="mb-6 h-px"
          style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
          role="presentation"
        />

        {/* Payment methods (text-only chips — no licensed logos) */}
        <div
          className="mb-5 flex flex-wrap items-center gap-3"
          aria-label="Принимаем к оплате"
        >
          {PAYMENT_BADGES.map((badge) => (
            <span
              key={badge}
              className="inline-block rounded-md px-3 py-1.5 text-[11px] font-bold tracking-[0.04em]"
              style={{
                backgroundColor: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.7)",
              }}
            >
              {badge}
            </span>
          ))}
        </div>

        <div
          className="text-xs"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          © 2026 Сократ AI. Все права защищены.
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: FooterLink[];
}) {
  return (
    <div>
      <div
        className="mb-4 text-[11px] font-bold uppercase tracking-[0.06em] text-white"
      >
        {title}
      </div>
      <ul className="flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <FooterLinkItem link={link} />
          </li>
        ))}
      </ul>
    </div>
  );
}
