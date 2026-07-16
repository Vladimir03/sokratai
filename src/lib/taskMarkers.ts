/**
 * W4 (2026-07-16): счёт ОЖИДАЕМОГО числа задач по текстовому слою страниц PDF.
 *
 * Сборники (решуЕГЭ и т.п.) нумеруют задачи «1.», «2.», … сквозной нумерацией —
 * по текстовому слою цифрового PDF можно заранее знать, сколько задач на
 * страницах, и честно сравнить с результатом распознавания («Найдено 68 из ~73»,
 * авто-повтор недобранного чанка).
 *
 * Осторожность против ложных маркеров:
 * - Только «N.» с точкой (внутризадачные списки вариантов — «1)», «2)» — не матчатся)
 *   + форма «Задание N» + «[N]» (формат stepenin.ru — варианты химии/биологии).
 * - Принимаем ТОЛЬКО монотонную цепочку: следующий принятый номер = prev+1
 *   (допуск: prev+2 — один пропущенный маркер из-за кривой вёрстки не рвёт цепь).
 * - Цепочка короче 3 → это не сборник, ожидание неизвестно (все null).
 *
 * Недооценка ожидания безопасна (меньше ложных «недоборов»); переоценка — нет.
 */

const DOT_MARKER_RE = /(?:^|[\s>])(\d{1,3})\s*\.\s+[А-ЯЁA-Z]/gu;
const WORD_MARKER_RE = /Задани[ея]\s+№?\s*(\d{1,3})/gu;
const BRACKET_MARKER_RE = /\[\s*(\d{1,3})\s*\]/gu;

interface Marker {
  page: number;
  num: number;
  pos: number;
}

/**
 * Число задач на каждой странице по текстовому слою. `null` = страница без
 * текста ИЛИ сквозная нумерация не обнаружена (ожидание неизвестно).
 */
export function countSequentialTaskMarkers(pageTexts: (string | null)[]): (number | null)[] {
  // Собираем маркеры обеих форм в документном порядке.
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
  const acceptedPerPage = new Map<number, number>();
  let next: number | null = null;
  let acceptedCount = 0;
  for (const mk of markers) {
    if (next === null || mk.num === next || mk.num === next + 1) {
      acceptedPerPage.set(mk.page, (acceptedPerPage.get(mk.page) ?? 0) + 1);
      next = mk.num + 1;
      acceptedCount += 1;
    }
  }

  if (acceptedCount < 3) return pageTexts.map(() => null);
  return pageTexts.map((text, page) => (text ? acceptedPerPage.get(page) ?? 0 : null));
}
