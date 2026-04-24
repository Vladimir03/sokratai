import { ChevronRight } from "lucide-react";

type QA = { q: string; a: string };

const ITEMS: QA[] = [
  {
    q: "AI учит ученика списывать — я с этим сам борюсь. Как Сократ AI защищает?",
    a: "Сократ AI никогда не даёт готовых ответов — в него зашит сократовский метод. AI задаёт только наводящие вопросы («что сохраняется в этой задаче?», «какая величина остаётся постоянной?»). Конкретные принципы диалога вы настраиваете один раз на тему — AI запоминает и применяет ко всем ученикам. Списать невозможно: AI не знает конечного числового ответа — он ведёт ученика к нему.",
  },
  {
    q: "AI ошибается в проверке. Как я могу доверить ему оценку?",
    a: "Никаких автоотправок ученику. AI генерирует только черновик — вы финализируете одним кликом, меняете то, что считаете нужным. Точность распознавания рукописи сейчас 92%. Оставшиеся 8% AI сам помечает как «требует вашей проверки» — они попадают в отдельную очередь. Экономия 80% времени, контроль 100% остаётся у вас.",
  },
  {
    q: "У меня 40 учеников разного уровня. Как настраивать AI под каждого?",
    a: "Настройка — один раз на тему или блок. Сократ AI запоминает, каким подходом вы предпочитаете решать задачу (через энергию, через силы, через импульс) и применяет эту логику ко всем ученикам в этой теме. Для разных уровней внутри группы — дифференцированные ДЗ в один клик. Чем больше учеников, тем сильнее ROI одной настройки.",
  },
  {
    q: "Telegram заблокирован, многие ученики без VPN. Как ДЗ доходит?",
    a: "Сократ AI работает через web, email, push-уведомления и Telegram-бота — одновременно. Ученик получает ДЗ по любому доступному каналу. Даже если Telegram не открывается, откроется ссылка в браузере с тем же интерфейсом. Telegram у нас — один из каналов, не единственный.",
  },
  {
    q: "Сколько стоит и есть ли пробный период?",
    a: "Первый месяц — 200 ₽ за полный AI-доступ на любое число учеников. Дальше: 1 000 ₽/мес до 10 учеников, 2 000 ₽ до 20, 3 000 ₽ за 20+. Онлайн-школы — по договорённости. Базовая платформа (оплаты, расписание, профили) остаётся бесплатной всегда. Отмена — в один клик в любой момент. Для сравнения: один час вашего времени — 1,5–2 тысячи рублей. Экономия трёх часов в неделю — 4,5–6 тысяч в месяц. Платформа окупается первой неделей.",
  },
];

export default function FAQ() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="py-14 md:py-24"
      style={{ backgroundColor: "var(--sokrat-card)" }}
    >
      {/* Scoped overrides + <summary> marker reset */}
      <style>{`
        .sokrat.sokrat-marketing .faq-summary {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 20px 0;
          cursor: pointer;
          min-height: 60px;
          list-style: none;
          font-size: 16px;
          font-weight: 600;
          color: var(--sokrat-fg1);
          transition: color 150ms;
        }
        .sokrat.sokrat-marketing .faq-summary::-webkit-details-marker { display: none; }
        .sokrat.sokrat-marketing .faq-summary:hover { color: var(--sokrat-green-700); }
        .sokrat.sokrat-marketing .faq-summary:focus-visible {
          outline: 2px solid var(--sokrat-green-700);
          outline-offset: 4px;
          border-radius: 4px;
        }
        .sokrat.sokrat-marketing .faq-chevron {
          flex-shrink: 0;
          width: 24px; height: 24px;
          color: var(--sokrat-fg3);
          transition: transform 200ms ease;
        }
        .sokrat.sokrat-marketing details[open] .faq-chevron { transform: rotate(90deg); }
        .sokrat.sokrat-marketing .faq-answer {
          padding: 0 0 20px;
          font-size: 15px;
          color: var(--sokrat-fg2);
          line-height: 1.6;
        }
      `}</style>

      <div className="mx-auto max-w-[800px] px-4 md:px-8">
        <h2 id="faq-heading" className="text-center mb-7 md:mb-10">
          Частые вопросы
        </h2>

        <div>
          {ITEMS.map((item, idx) => (
            <details
              key={item.q}
              style={{
                borderBottom: "1px solid var(--sokrat-border)",
                borderTop:
                  idx === 0 ? "1px solid var(--sokrat-border)" : undefined,
              }}
            >
              <summary className="faq-summary">
                <span>{item.q}</span>
                <ChevronRight aria-hidden="true" className="faq-chevron" />
              </summary>
              <div className="faq-answer">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
