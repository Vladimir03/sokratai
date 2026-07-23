/**
 * W1 «скрин-стори второй взгляд» — вау-элемент hero (landing-v2, GATE A).
 *
 * Стилизованная JSX-композиция «фото рукописного решения → разбор Сократа
 * с баллом 1 из 2» по кейсу Елены. Намеренно НЕ реальный скриншот:
 * (а) ноль PII, (б) шипится без ожидания ассетов. Когда владелец соберёт
 * реальные скрины — заменить внутренности на <img> по образцу
 * Tour3ConceptMockup.tsx, не меняя внешний контракт компонента.
 *
 * Rule 80: без dvh/lookbehind/новых Web API; чистый CSS.
 */
export default function HeroSecondLookStory() {
  return (
    <figure aria-label="Пример: Сократ нашёл ошибку, которую пропустил репетитор">
      <div className="relative">
        {/* «Фото» рукописного решения — подложка, слегка повёрнута */}
        <div
          aria-hidden="true"
          className="rounded-[12px] p-4 pb-10"
          style={{
            backgroundColor: "#fffdf5",
            border: "1px solid var(--sokrat-border)",
            boxShadow: "var(--sokrat-shadow-md)",
            transform: "rotate(-2deg)",
            backgroundImage:
              "repeating-linear-gradient(transparent, transparent 21px, rgba(100,116,139,0.18) 22px)",
          }}
        >
          <div
            className="text-[15px] leading-[22px]"
            style={{
              color: "#334155",
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: "italic",
            }}
          >
            Дано: m = 2 кг, v₀ = 3 м/с
            <br />
            E = mv²/2 = 2·3²/2 = 9 Дж
            <br />
            A = F·s = <span style={{ color: "#b91c1c" }}>18 Дж</span>
            <br />
            Ответ: 18 Дж
          </div>
        </div>

        {/* Карточка разбора Сократа — поверх, со сдвигом */}
        <div
          className="relative -mt-7 ml-4 md:ml-8 rounded-[12px] p-4"
          style={{
            backgroundColor: "var(--sokrat-card)",
            border: "1px solid var(--sokrat-border)",
            boxShadow: "var(--sokrat-shadow-md)",
          }}
        >
          <div
            className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.06em]"
            style={{ color: "var(--sokrat-fg3)" }}
          >
            Проверка Сократа · по критериям ФИПИ
          </div>

          <ul className="flex flex-col gap-1.5 text-[13px] leading-[1.45]">
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="font-bold" style={{ color: "var(--sokrat-green-700)" }}>
                ✓
              </span>
              <span style={{ color: "var(--sokrat-fg2)" }}>
                Физическая модель и формулы — верно
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="font-bold" style={{ color: "#b91c1c" }}>
                ✗
              </span>
              <span style={{ color: "var(--sokrat-fg2)" }}>
                Ошибка в вычислении работы — строка 3
              </span>
            </li>
          </ul>

          <div
            className="mt-3 flex items-center justify-between rounded-[8px] px-3 py-2"
            style={{ backgroundColor: "var(--sokrat-green-50)" }}
          >
            <span className="text-[12px] font-medium" style={{ color: "var(--sokrat-fg2)" }}>
              Балл
            </span>
            <span className="text-[15px] font-bold" style={{ color: "var(--sokrat-green-800)" }}>
              1 из 2
            </span>
          </div>
        </div>
      </div>

      <figcaption
        className="mt-4 text-[13px] leading-[1.55]"
        style={{ color: "var(--sokrat-fg2)" }}
      >
        <span style={{ fontStyle: "italic" }}>
          «Я проверила — вроде всё верно. Сократ поставил 1&nbsp;из&nbsp;2 —
          и&nbsp;оказался прав».
        </span>{" "}
        <span style={{ color: "var(--sokrat-fg3)" }}>
          — Елена, репетитор по&nbsp;физике
        </span>
      </figcaption>
    </figure>
  );
}
