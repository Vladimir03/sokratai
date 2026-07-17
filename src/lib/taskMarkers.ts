/**
 * W4 (2026-07-16): счёт ОЖИДАЕМОГО числа задач по текстовому слою страниц PDF.
 *
 * Сборники (решуЕГЭ, stepenin и т.п.) нумеруют задачи «1.», «[1]», … сквозной
 * нумерацией — по текстовому слою цифрового PDF можно заранее знать, сколько
 * задач на страницах, и честно сравнить с результатом распознавания
 * («Найдено 68 из ~73», авто-повтор недобранного чанка).
 *
 * Осторожность против ложных маркеров (ревью 2026-07-16 P1 — переоценка даёт
 * ложные pro-повторы и янтарные баннеры, она ДОРОЖЕ недооценки):
 * - «N.» и «[N]» принимаются ТОЛЬКО от НАЧАЛА СТРОКИ (тексты приходят с `\n`
 *   по hasEOL из pdfToImages) — ссылки/номера в середине предложения отпадают.
 *   Проверено на реальных PDF: у решуЕГЭ и stepenin все маркеры задач в начале
 *   строк. «Задание N» — сам по себе специфичен, начала строки не требует.
 * - Внутризадачные списки вариантов «1)», «2)» не матчатся вовсе (нет точки).
 * - Принимается ТОЛЬКО монотонная цепочка: следующий принятый номер = prev+1
 *   (допуск: prev+2 — один пропущенный маркер кривой вёрстки не рвёт цепь).
 * - Цепочка короче 5 → это не сборник, ожидание неизвестно (все null):
 *   обычный нумерованный список «1. … 2. … 3. …» или ссылки [1]-[3] не
 *   становятся ложным ожиданием.
 *
 * Недооценка ожидания безопасна (меньше ложных «недоборов»); переоценка — нет.
 */

const DOT_MARKER_RE = /(?:^|\n)\s*(\d{1,3})\s*\.\s+[А-ЯЁA-Z]/gu;
const WORD_MARKER_RE = /Задани[ея]\s+№?\s*(\d{1,3})/gu;
const BRACKET_MARKER_RE = /(?:^|\n)\s*\[\s*(\d{1,3})\s*\]/gu;

/** Минимальная длина монотонной цепочки, чтобы считать нумерацию сборником. */
const MIN_CHAIN = 5;

/**
 * Максимальный номер, при котором сквозная нумерация «похожа на полный вариант
 * ЕГЭ/ОГЭ» (зеркало edge-normalize kim 1..40). Химия stepenin [1]..[34] = номера
 * КИМ (подсказка химиков 2026-07-16); решуЕГЭ-подборка 1..73 — НЕ КИМ (>40).
 */
const VARIANT_KIM_MAX = 40;

interface Marker {
  page: number;
  num: number;
  pos: number;
}

export interface TaskMarkerScan {
  /** Число принятых маркеров на страницу (null = нет текста/цепочка не найдена). */
  perPage: (number | null)[];
  /** ПРИНЯТЫЕ номера маркеров по страницам, в порядке документа (null — как выше). */
  numbersPerPage: (number[] | null)[];
  /**
   * Нумерация похожа на полный вариант (старт с 1, максимум ≤ VARIANT_KIM_MAX):
   * номера маркеров = № КИМ задач → можно детерминированно проставить kim_number.
   */
  isVariantNumbering: boolean;
}

/**
 * Скан маркеров нумерации по текстовому слою страниц. Тексты должны содержать
 * `\n`-переносы строк (pdfToImages hasEOL).
 */
export function scanTaskMarkers(pageTexts: (string | null)[]): TaskMarkerScan {
  // Собираем маркеры всех форм в документном порядке.
  const markers: Marker[] = [];
  pageTexts.forEach((text, page) => {
    if (!text) return;
    for (const re of [DOT_MARKER_RE, WORD_MARKER_RE, BRACKET_MARKER_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const num = parseInt(m[1], 10);
        if (Number.isFinite(num) && num >= 1) markers.push({ page, num, pos: m.index });
      }
    }
  });
  markers.sort((a, b) => (a.page - b.page) || (a.pos - b.pos));

  // Монотонная цепочка: старт с первого маркера (сборник может начинаться не с 1).
  const acceptedByPage = new Map<number, number[]>();
  let next: number | null = null;
  let firstNum: number | null = null;
  let maxNum = 0;
  let acceptedCount = 0;
  for (const mk of markers) {
    if (next === null || mk.num === next || mk.num === next + 1) {
      const list = acceptedByPage.get(mk.page) ?? [];
      list.push(mk.num);
      acceptedByPage.set(mk.page, list);
      if (firstNum === null) firstNum = mk.num;
      maxNum = mk.num;
      next = mk.num + 1;
      acceptedCount += 1;
    }
  }

  if (acceptedCount < MIN_CHAIN) {
    return {
      perPage: pageTexts.map(() => null),
      numbersPerPage: pageTexts.map(() => null),
      isVariantNumbering: false,
    };
  }
  return {
    perPage: pageTexts.map((text, page) => (text ? acceptedByPage.get(page)?.length ?? 0 : null)),
    numbersPerPage: pageTexts.map((text, page) => (text ? acceptedByPage.get(page) ?? [] : null)),
    isVariantNumbering: firstNum === 1 && maxNum <= VARIANT_KIM_MAX,
  };
}

/** Обратная совместимость: только счёт на страницу. */
export function countSequentialTaskMarkers(pageTexts: (string | null)[]): (number | null)[] {
  return scanTaskMarkers(pageTexts).perPage;
}
