import { Play } from "lucide-react";
import type { ReactNode } from "react";

type MiniCard = {
  title: string;
  body: ReactNode;
};

const CARDS: MiniCard[] = [
  {
    title: "Оплаты",
    body: (
      <>
        Отмечаете оплату из кабинета или командой{" "}
        <code
          style={{
            backgroundColor: "var(--sokrat-green-100)",
            color: "var(--sokrat-green-800)",
            padding: "2px 6px",
            borderRadius: 4,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12,
          }}
        >
          /pay
        </code>{" "}
        в Telegram. Все должники — в одном списке. Автоматические напоминания
        ученикам. Без Excel на коленке.
      </>
    ),
  },
  {
    title: "Расписание",
    body:
      "Недельная сетка, drag-and-drop переносы, повторяющиеся уроки. Ученик видит своё расписание в личном кабинете или в боте. Вы — всё своё в одном календаре.",
  },
  {
    title: "Профили учеников",
    body:
      "История всех занятий, оплат, ДЗ. Группы. Контакты ученика и родителей. Заметки для себя. Один источник данных — не пять.",
  },
];

export default function FreemiumBridge() {
  return (
    <section
      aria-labelledby="freemium-heading"
      className="py-14 md:py-24"
      style={{
        backgroundColor: "var(--sokrat-green-50)",
        borderTop: "1px solid var(--sokrat-green-100)",
        borderBottom: "1px solid var(--sokrat-green-100)",
      }}
    >
      {/*
        Scoped overrides for marketing-global h3/p (specificity 0,2,1).
        New `.sokrat.sokrat-marketing .freemium-*` wins at 0,3,0.
      */}
      <style>{`
        .sokrat.sokrat-marketing .freemium-card-title {
          font-size: 18px;
          line-height: 1.3;
          font-weight: 600;
          color: var(--sokrat-green-800);
        }
        .sokrat.sokrat-marketing .freemium-card-body {
          font-size: 14px;
          line-height: 1.55;
          color: var(--sokrat-fg2);
        }
        .sokrat.sokrat-marketing .freemium-closing {
          font-size: 15px;
          font-weight: 500;
          color: var(--sokrat-fg2);
        }
      `}</style>

      <div className="mx-auto max-w-[1120px] px-4 md:px-8">
        <span
          className="inline-block rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] mb-4"
          style={{
            backgroundColor: "var(--sokrat-ochre-100)",
            color: "var(--sokrat-ochre-700)",
          }}
        >
          Бесплатно навсегда
        </span>

        <h2 id="freemium-heading" className="mb-4">
          Оплаты и расписание — базовая платформа бесплатно
        </h2>

        <p className="lede mb-6 md:mb-12 max-w-[720px]">
          Учёт оплат, расписание уроков, карточки учеников с историей — всё
          бесплатно и навсегда, без скрытых платежей. AI-проверку ДЗ и
          сократовский диалог добавите позже, когда готовы — отдельной
          подпиской.
        </p>

        <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6 mb-7 md:mb-12">
          {CARDS.map((card) => (
            <li
              key={card.title}
              className="rounded-[14px] p-6 border"
              style={{
                backgroundColor: "var(--sokrat-card)",
                borderColor: "var(--sokrat-border)",
              }}
            >
              <h3 className="freemium-card-title mb-3">{card.title}</h3>
              <p className="freemium-card-body">{card.body}</p>
            </li>
          ))}
        </ul>

        <div className="mx-auto mb-6 max-w-[680px]">
          <FreemiumVideo />
        </div>

        <p className="freemium-closing text-center">
          AI-слой подключается опционально — от 200 ₽ в первый месяц. Без него
          базовая платформа остаётся.
        </p>
      </div>
    </section>
  );
}

function FreemiumVideo() {
  const frameStyle = {
    aspectRatio: "16 / 10",
    background:
      "linear-gradient(135deg, var(--sokrat-green-50) 0%, var(--sokrat-green-100) 100%)",
    borderRadius: "var(--sokrat-radius-xl)",
    boxShadow: "var(--sokrat-shadow-md)",
  } as const;

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
          Оплаты + расписание
        </div>
        <div className="mt-1 text-xs" style={{ color: "var(--sokrat-fg3)" }}>
          Видео 15 сек — добавится после записи
        </div>
      </div>
    </div>
  );
}
