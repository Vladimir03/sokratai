import { Play } from "lucide-react";

type Founder = {
  name: string;
  initials: string;
  credentials: string[];
  quote: string;
  photoSrc?: string;
  cta?: { label: string; href: string; external: boolean };
};

const FOUNDERS: Founder[] = [
  {
    name: "Егор Блинов",
    initials: "ЕБ",
    credentials: [
      "Преподаватель МФТИ",
      "Готовит к ЕГЭ по физике с 2016 (10 лет)",
      "Дважды 100 баллов ЕГЭ по физике — лично",
      "Основатель онлайн-школы Razveday.ru",
    ],
    quote:
      "«Я — репетитор в прошлом и в настоящем. Сократ AI мы строим так, чтобы он закрывал мои ночные проверки ДЗ — не мою методику. AI здесь не вместо меня, а со мной.»",
    photoSrc: undefined,
    cta: {
      label: "Канал Егора →",
      href: "https://t.me/sokrat_rep",
      external: true,
    },
  },
  {
    name: "Владимир Камчаткин",
    initials: "ВК",
    credentials: [
      "Основатель Сократ AI",
      "МФТИ",
      "Фоксфорд",
      "Т-Образование",
    ],
    quote:
      "«Я пять лет строил продукты для онлайн-школ и репетиторов. Главный урок: платформы, которые хотят заменить репетитора, проигрывают. Платформы, которые усиливают его, — выигрывают.»",
    photoSrc: undefined,
  },
];

const TESTIMONIAL_VIDEO_SRC: string | undefined = undefined;

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
          <CasePlaceholderCard />
          <CaseYourCaseCard />
        </div>
      </div>
    </section>
  );
}

function FounderPhoto({
  name,
  initials,
  photoSrc,
}: {
  name: string;
  initials: string;
  photoSrc?: string;
}) {
  const dimension = 120;
  if (photoSrc) {
    return (
      <img
        src={photoSrc}
        alt={`Фото: ${name}`}
        width={dimension}
        height={dimension}
        loading="lazy"
        className="h-[120px] w-[120px] object-cover rounded-[14px]"
      />
    );
  }
  return (
    <div
      aria-label={`Фото: ${name}`}
      className="flex h-[120px] w-[120px] items-center justify-center rounded-[14px] font-extrabold text-white"
      style={{
        background:
          "linear-gradient(135deg, var(--sokrat-green-200) 0%, var(--sokrat-green-500) 100%)",
        fontSize: 36,
      }}
    >
      {initials}
    </div>
  );
}

function FounderCard({ founder }: { founder: Founder }) {
  return (
    <article
      className="flex flex-col gap-4 rounded-[18px] p-6"
      style={{
        backgroundColor: "var(--sokrat-card)",
        border: "1px solid var(--sokrat-border)",
      }}
    >
      <FounderPhoto
        name={founder.name}
        initials={founder.initials}
        photoSrc={founder.photoSrc}
      />
      <div className="sp-founder-name">{founder.name}</div>
      <ul className="sp-founder-credentials flex flex-col gap-1 list-none p-0 m-0">
        {founder.credentials.map((line) => (
          <li key={line}>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <blockquote className="sp-founder-quote">{founder.quote}</blockquote>
      {founder.cta && (
        <a
          href={founder.cta.href}
          target={founder.cta.external ? "_blank" : undefined}
          rel={founder.cta.external ? "noopener noreferrer" : undefined}
          className="self-start inline-flex items-center gap-1 px-4 py-2 rounded-md border-2 text-sm font-semibold transition-colors hover:bg-[color:var(--sokrat-green-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            color: "var(--sokrat-green-700)",
            borderColor: "var(--sokrat-green-700)",
          }}
        >
          {founder.cta.label}
        </a>
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
            autoPlay
            loop
            muted
            playsInline
            poster="/marketing/tutor-landing/testimonial-poster.jpg"
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
      <div className="sp-case-regalia">
        Ученица Егора Блинова · Готовилась к ЕГЭ по физике · 2024
      </div>
      <p className="sp-case-disclaimer">
        Отзыв снят, когда Сократ AI работал как Telegram-бот. С 2025 платформа
        переехала на sokratai.ru.
      </p>
    </article>
  );
}

function CasePlaceholderCard() {
  return (
    <article
      className="flex flex-col gap-3 rounded-[14px] p-5"
      style={{
        backgroundColor: "var(--sokrat-card)",
        border: "1px solid var(--sokrat-border)",
      }}
    >
      <div
        aria-label="Фото: Михаил К."
        className="flex h-[72px] w-[72px] items-center justify-center self-start rounded-[10px] font-extrabold text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--sokrat-green-200) 0%, var(--sokrat-green-500) 100%)",
          fontSize: 24,
        }}
      >
        МК
      </div>
      <div className="sp-case-name">Михаил К.</div>
      <div className="sp-case-regalia">
        Репетитор математики ОГЭ и ЕГЭ · 5 лет опыта · Санкт-Петербург
      </div>
      <blockquote className="sp-case-quote">
        «Собираю ДЗ за 10 минут из базы + своих задач. AI-генерация похожих
        экономит минут 30 на подготовку каждого урока.»
      </blockquote>
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
