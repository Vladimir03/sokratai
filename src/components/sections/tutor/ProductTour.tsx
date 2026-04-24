import { Link } from "react-router-dom";
import { Play } from "lucide-react";

import type { ProductTourProps } from "./tourData";

export default function ProductTour({
  id,
  badge,
  headline,
  lede,
  bullets,
  inlineCTA,
  videoPlaceholderText,
  videoPlaceholderCaption,
  videoSrc,
  zigzag,
  backgroundSurface,
}: ProductTourProps) {
  const textOrderClass =
    zigzag === "text-right" ? "md:order-2" : "md:order-1";
  const videoOrderClass =
    zigzag === "text-right" ? "md:order-1" : "md:order-2";

  return (
    <section
      id={id}
      className="py-14 md:py-20"
      style={{
        backgroundColor: backgroundSurface
          ? "var(--sokrat-surface)"
          : "var(--sokrat-card)",
      }}
    >
      {/*
        Scoped overrides to win over marketing-global
        `.sokrat:not([data-sokrat-mode]) h3/p` (0,2,1 specificity).
      */}
      <style>{`
        .sokrat.sokrat-marketing .tour-bullet-title {
          font-size: 16px;
          line-height: 1.35;
          font-weight: 600;
        }
        .sokrat.sokrat-marketing .tour-bullet-body {
          font-size: 15px;
          line-height: 1.55;
        }
        .sokrat.sokrat-marketing .tour-h2-before {
          color: var(--sokrat-fg3);
          font-weight: 600;
          white-space: nowrap;
        }
        .sokrat.sokrat-marketing .tour-h2-arrow {
          display: inline-block;
          margin: 0 4px;
          color: var(--sokrat-green-500);
          font-weight: 900;
        }
        .sokrat.sokrat-marketing .tour-h2-after {
          color: var(--sokrat-green-700);
          white-space: nowrap;
        }
        .sokrat.sokrat-marketing .tour-h2-transform-group {
          white-space: nowrap;
        }
        @media (max-width: 768px) {
          .sokrat.sokrat-marketing .tour-h2-transform-group {
            white-space: normal;
          }
        }
      `}</style>

      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-8 px-4 md:grid-cols-2 md:gap-20 md:px-8">
        {/* Text column */}
        <div className={textOrderClass}>
          {badge && <TourBadge badge={badge} />}

          <h2 className="mb-4">{headline}</h2>

          <p className="lede mb-6">{lede}</p>

          <ul className="mb-8 flex flex-col gap-4 md:gap-5">
            {bullets.map((bullet) => (
              <li key={bullet.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-[10px] h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: "var(--sokrat-ochre-500)" }}
                />
                <div className="flex-1">
                  <h3
                    className="tour-bullet-title mb-1"
                    style={{ color: "var(--sokrat-fg1)" }}
                  >
                    {bullet.title}
                  </h3>
                  <p
                    className="tour-bullet-body"
                    style={{ color: "var(--sokrat-fg2)" }}
                  >
                    {bullet.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {inlineCTA && (
            <Link
              to={inlineCTA.href}
              className="inline-flex items-center font-semibold border-b border-transparent transition-colors hover:border-b-[color:var(--sokrat-green-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--sokrat-green-700)]/60 focus-visible:ring-offset-2"
              style={{ color: "var(--sokrat-green-700)" }}
            >
              {inlineCTA.label}
            </Link>
          )}
        </div>

        {/* Video column */}
        <div className={videoOrderClass}>
          <TourVideo
            videoSrc={videoSrc}
            placeholderText={videoPlaceholderText}
            placeholderCaption={videoPlaceholderCaption}
          />
        </div>
      </div>
    </section>
  );
}

function TourBadge({ badge }: { badge: NonNullable<ProductTourProps["badge"]> }) {
  const { Icon, label } = badge;
  return (
    <span
      className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em]"
      style={{
        backgroundColor: "var(--sokrat-ochre-100)",
        color: "var(--sokrat-ochre-700)",
      }}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  );
}

function TourVideo({
  videoSrc,
  placeholderText,
  placeholderCaption,
}: {
  videoSrc?: string;
  placeholderText: string;
  placeholderCaption: string;
}) {
  const frameStyle = {
    aspectRatio: "16 / 10",
    background:
      "linear-gradient(135deg, var(--sokrat-green-50) 0%, var(--sokrat-green-100) 100%)",
    borderRadius: "var(--sokrat-radius-xl)",
    boxShadow: "var(--sokrat-shadow-md)",
  } as const;

  if (videoSrc) {
    return (
      <div
        className="relative overflow-hidden w-full"
        style={frameStyle}
      >
        <video
          src={videoSrc}
          autoPlay
          loop
          muted
          playsInline
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className="relative flex w-full items-center justify-center overflow-hidden"
      style={frameStyle}
    >
      <div className="p-6 text-center">
        <div
          className="mx-auto mb-3 inline-flex h-16 w-16 items-center justify-center rounded-full"
          style={{
            backgroundColor: "rgba(27, 107, 74, 0.12)",
            color: "var(--sokrat-green-700)",
          }}
        >
          <Play aria-hidden="true" className="h-7 w-7 fill-current" />
        </div>
        <div
          className="mx-auto max-w-[320px] text-sm font-medium"
          style={{ color: "var(--sokrat-fg2)" }}
        >
          {placeholderText}
        </div>
        <div
          className="mt-1 text-xs"
          style={{ color: "var(--sokrat-fg3)" }}
        >
          {placeholderCaption}
        </div>
      </div>
    </div>
  );
}
