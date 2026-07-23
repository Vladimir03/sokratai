import { MessageSquareWarning, Bot, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Strike = {
  Icon: LucideIcon;
  title: string;
  body: string;
};

/**
 * Блок «Почему не по-старому» (landing-v2 GATE B) — расстрел текущего
 * способа (мессенджеры + ChatGPT + «Решу ЕГЭ»/архивы). Канон-компонент 5
 * активаторов выбора: без него посетитель не понимает, чем плох его
 * привычный бесплатный стек.
 */
const STRIKES: Strike[] = [
  {
    Icon: MessageSquareWarning,
    title: "Мессенджеры",
    body:
      "Фото без подписей в десяти ветках; собрать работы дольше, чем проверить.",
  },
  {
    Icon: Bot,
    title: "ChatGPT у ученика",
    body:
      "Выдаёт готовый ответ: «ДЗ сдано», навыка нет. Сократ ведёт вопросами — списать нечего.",
  },
  {
    Icon: Layers,
    title: "«Решу ЕГЭ» + свои архивы",
    body:
      "Банк есть, а проверки рукописного, ведения ученика и прогресса — нет. Склеивать это руками — и есть те самые 10 часов в неделю.",
  },
];

export default function WhyNotOldWay() {
  return (
    <section
      aria-labelledby="why-not-old-way-heading"
      className="py-14 md:py-20"
      style={{ backgroundColor: "var(--sokrat-surface)" }}
    >
      <style>{`
        .sokrat.sokrat-marketing .wnow-title {
          font-size: 16px;
          line-height: 1.3;
        }
        .sokrat.sokrat-marketing .wnow-body {
          font-size: 14px;
          line-height: 1.6;
        }
        @media (min-width: 768px) {
          .sokrat.sokrat-marketing .wnow-title { font-size: 18px; }
          .sokrat.sokrat-marketing .wnow-body { font-size: 15px; }
        }
      `}</style>

      <div className="mx-auto max-w-[960px] px-4 md:px-8">
        <h2 id="why-not-old-way-heading" className="text-center mb-7 md:mb-12">
          Бесплатные инструменты — а&nbsp;вечер всё равно ваш
        </h2>

        <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          {STRIKES.map(({ Icon, title, body }) => (
            <li
              key={title}
              className="rounded-[14px] p-5 md:p-6 border border-[color:var(--sokrat-border)] bg-[color:var(--sokrat-card)]"
            >
              <Icon
                aria-hidden="true"
                className="mb-3 h-6 w-6"
                style={{ color: "var(--sokrat-green-700)" }}
              />
              <h3
                className="wnow-title font-semibold mb-2"
                style={{ color: "var(--sokrat-fg1)" }}
              >
                {title}
              </h3>
              <p className="wnow-body" style={{ color: "var(--sokrat-fg2)" }}>
                {body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
