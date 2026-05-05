type PainCard = {
  title: string;
  body: string;
};

const CARDS: PainCard[] = [
  {
    title: "23:00, ещё 12 работ в очереди",
    body:
      "Двадцать учеников отправили фото решений. Каждому нужно написать фидбек с учётом именно его ошибок. Три часа работы впереди — и завтра с утра урок.",
  },
  {
    title: "«Кто это вообще прислал?»",
    body:
      "Фото приходят в Telegram, WhatsApp, email. Без подписей, без номера задания. Логистика «собрать работы» занимает столько же времени, сколько сама проверка.",
  },
  {
    title: "Ученик застрял — пошёл в ChatGPT",
    body:
      "23:00. Ученик не справляется с задачей. Написать вам поздно. Открывает ChatGPT, получает готовое решение, списывает. Навыка не появилось — но «ДЗ сдано».",
  },
  {
    title: "«Как у него дела?» — спрашивает мама",
    body:
      "Нужно свести оценки, посещения, прогресс по темам. Данные в Excel, в переписках, в голове. На одного ученика — 15 минут. На тридцать — два вечера.",
  },
];

export default function Pain() {
  return (
    <section
      aria-labelledby="pain-heading"
      className="py-14 md:py-24"
      style={{ backgroundColor: "var(--sokrat-surface)" }}
    >
      {/*
        Scoped overrides — marketing-global rules .sokrat:not([data-sokrat-mode]) h3/p
        force 24 px / 16 px. Task spec wants 16 → 18 px (title) and 14 → 15 px (body).
      */}
      <style>{`
        .sokrat.sokrat-marketing .pain-card-title {
          font-size: 16px;
          line-height: 1.3;
        }
        .sokrat.sokrat-marketing .pain-card-body {
          font-size: 14px;
          line-height: 1.6;
        }
        @media (min-width: 768px) {
          .sokrat.sokrat-marketing .pain-card-title { font-size: 18px; }
          .sokrat.sokrat-marketing .pain-card-body { font-size: 15px; }
        }
      `}</style>

      <div className="mx-auto max-w-[960px] px-4 md:px-8">
        <h2
          id="pain-heading"
          className="text-center mb-7 md:mb-12"
        >
          Знакомая картина?
        </h2>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {CARDS.map((card) => (
            <li
              key={card.title}
              className="pain-card rounded-[14px] p-5 md:p-7 border border-[color:var(--sokrat-border)] bg-[color:var(--sokrat-card)] transition-[border-color,box-shadow] duration-200 hover:border-[color:var(--sokrat-green-200)] hover:shadow-sm"
            >
              <h3
                className="pain-card-title font-semibold mb-3"
                style={{ color: "var(--sokrat-fg1)" }}
              >
                {card.title}
              </h3>
              <p
                className="pain-card-body"
                style={{ color: "var(--sokrat-fg2)" }}
              >
                {card.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
