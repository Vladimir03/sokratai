/**
 * W1 «скрин-стори второй взгляд» — вау-элемент hero (landing-v2, GATE A/B).
 *
 * Контент = РЕАЛЬНЫЙ кейс из живого демо Егора (презентация репетиторам,
 * июль 2026): ученик Всеволод, адиабатический процесс, ошибка перевода
 * ΔT в Кельвины (взял −373 вместо ΔT = −100 К) — Сократ поймал её в чате ДЗ.
 * Текст ответа Сократа — сжатая цитата реального ответа из кабинета.
 *
 * Рукопись пока стилизована JSX (файла фото в репо нет): когда владелец
 * положит скрин в public/marketing/tutor-landing/ — заменить верхнюю
 * карточку на <img> по образцу Tour3ConceptMockup.tsx, контракт не менять.
 *
 * Rule 80: без dvh/lookbehind/новых Web API; чистый CSS.
 */
export default function HeroSecondLookStory() {
  return (
    <figure aria-label="Пример: Сократ нашёл ошибку в рукописном решении и объяснил её ученику в чате">
      <div className="relative">
        {/* «Фото» рукописного решения Всеволода — подложка, слегка повёрнута */}
        <div
          aria-hidden="true"
          className="rounded-[12px] p-4 pb-12"
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
            className="text-[14px] leading-[22px]"
            style={{
              color: "#334155",
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: "italic",
            }}
          >
            Дано: ν = 3 моль, ΔT = −100 °C
            <br />
            Адиабатический процесс ⇒ Q = 0
            <br />
            ΔU = 3/2·νR·ΔT = 3/2·3·8,31·
            <span style={{ color: "#b91c1c" }}>(−373)</span>
            <br />
            A = −ΔU = 13 948 Дж ≈ 13,9 кДж
            <br />
            Ответ: A ≈ 13,9 кДж
          </div>
        </div>

        {/* Карточка проверки Сократа — поверх, со сдвигом */}
        <div
          className="relative -mt-8 ml-3 md:ml-6 rounded-[12px] p-4"
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
                Адиабатический процесс, первый закон — верно
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden="true" className="font-bold" style={{ color: "#b91c1c" }}>
                ✗
              </span>
              <span style={{ color: "var(--sokrat-fg2)" }}>
                Перевод ΔT в Кельвины — ошибка в расчёте
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

          {/* Ответ Сократа ученику в чате ДЗ (сжатая цитата реального ответа) */}
          <div
            className="mt-3 rounded-[10px] rounded-tl-[4px] px-3 py-2.5"
            style={{
              backgroundColor: "var(--sokrat-surface)",
              border: "1px solid var(--sokrat-border)",
            }}
          >
            <div
              className="mb-1 text-[10px] font-bold uppercase tracking-[0.06em]"
              style={{ color: "var(--sokrat-fg3)" }}
            >
              Сократ — ученику в чате ДЗ
            </div>
            <p
              className="text-[12.5px] leading-[1.5]"
              style={{ color: "var(--sokrat-fg2)", margin: 0 }}
            >
              Всеволод, процесс адиабатический — верно. Но при переводе ΔT
              в&nbsp;Кельвины ошибка: изменение температуры одинаково
              в&nbsp;обеих шкалах (ΔT&nbsp;=&nbsp;100&nbsp;К). Пересчитай,
              учитывая этот момент.
            </p>
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
