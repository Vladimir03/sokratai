/**
 * W1 «скрин-стори второй взгляд» — вау-элемент hero (landing-v2, GATE A/B).
 *
 * Контент = РЕАЛЬНЫЙ кейс из живого демо Егора (слайд 16 презентации
 * репетиторам, июль 2026): ученик Всеволод, адиабатический процесс, ошибка
 * перевода ΔT в Кельвины (взял −373 вместо ΔT = 100 К) — Сократ поймал её
 * в чате ДЗ. Фото рукописи — тот же кадр со слайда (вырезан из экспорта,
 * `public/marketing/tutor-landing/hero-handwritten-solution.webp`, 30 КБ).
 * Текст ответа Сократа — сжатая цитата реального ответа из кабинета.
 *
 * Rule 80: без dvh/lookbehind/новых Web API; чистый CSS.
 */
const HANDWRITING_SRC = "/marketing/tutor-landing/hero-handwritten-solution.webp";

export default function HeroSecondLookStory() {
  return (
    <figure aria-label="Пример: Сократ нашёл ошибку в рукописном решении и объяснил её ученику в чате">
      <div className="relative">
        {/*
          Фото рукописного решения Всеволода — подложка, слегка повёрнута.
          Без loading="lazy": элемент above-the-fold, ленивая загрузка сдвинула
          бы отрисовку hero. width/height заданы — защита от CLS.
        */}
        <img
          src={HANDWRITING_SRC}
          alt="Рукописное решение ученика: адиабатический процесс, работа газа"
          width={940}
          height={556}
          decoding="async"
          className="block w-full h-auto rounded-[12px]"
          style={{
            border: "1px solid var(--sokrat-border)",
            boxShadow: "var(--sokrat-shadow-md)",
            transform: "rotate(-2deg)",
          }}
        />

        {/*
          Карточка проверки Сократа — поверх, со сдвигом. Перекрытие маленькое
          (-mt-4): у фото внизу ~10% пустой линованной бумаги, строку
          «Ответ: A₂ ≈ 13,9 кДж» закрывать нельзя — это тот самый неверный
          ответ, который поймал Сократ.
        */}
        <div
          className="relative -mt-4 ml-3 md:ml-6 rounded-[12px] p-4"
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
