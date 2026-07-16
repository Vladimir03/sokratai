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

interface Marker {
  page: number;
  num: number;
  pos: number;
}

/**
 * Число задач на каждой странице по текстовому слою. `null` = страница без
 * текста ИЛИ сквозная нумерация не обнаружена (ожидание неизвестно).
 * Тексты должны содержать `\n`-переносы строк (pdfToImages hasEOL).
 */
export function countSequentialTaskMarkers(pageTexts: (string | null)[]): (number | null)[] {
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

  if (acceptedCount < MIN_CHAIN) return pageTexts.map(() => null);
  return pageTexts.map((text, page) => (text ? acceptedPerPage.get(page) ?? 0 : null));
}
