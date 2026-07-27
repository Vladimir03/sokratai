/**
 * Ленивая загрузка математических плагинов markdown (`remark-math` +
 * `rehype-katex` + CSS KaTeX) — ЕДИНАЯ точка на все поверхности рендера.
 *
 * ЗАЧЕМ: `rehype-katex` статически зависит от `katex`, поэтому статический
 * импорт плагина затаскивал 259 КБ raw / 76 КБ gzip в КАЖДЫЙ чанк, где он
 * упоминался. Замер 2026-07-27: 15 чанков — Chat, HomeworkProblem, Admin,
 * Practice, StudentMockExam, TutorHomeworkDetail и другие.
 *
 * Обманчивость исходного состояния: во всех пяти местах `ReactMarkdown` УЖЕ
 * грузился лениво (`lazy(() => import('react-markdown'))`), и код выглядел
 * оптимизированным. Но плагины оставались статическими — а тяжёлый там именно
 * плагин, а не сам react-markdown. Ленивость была половинчатой и потому
 * бесполезной для байтов. Ровно та же ловушка, что была в `MathText`.
 *
 * Инварианты:
 *  • `remarkGfmSafe` СЮДА НЕ ВХОДИТ и остаётся статическим импортом. Он —
 *    Safari-критичный (rule 80: обычный `remark-gfm` несёт lookbehind в
 *    autolink-literal и роняет экран на iOS ≤ 16.3). Делать его ленивым
 *    значит добавить режим отказа, при котором GFM МОЛЧА не применится —
 *    цена ошибки несопоставима с выигрышем: он не тянет katex.
 *  • До загрузки текст рендерится БЕЗ математики, а не прячется: markdown
 *    показывается сразу, формулы доезжают следом. Пустой экран ради «чистого»
 *    появления был бы хуже — это гарантированный CLS.
 *  • Один общий промис: N сообщений в чате дают ОДИН сетевой запрос.
 */
import { useEffect, useState } from 'react';

type RemarkMath = typeof import('remark-math')['default'];
type RehypeKatex = typeof import('rehype-katex')['default'];

export interface MathPlugins {
  remarkMath: RemarkMath;
  rehypeKatex: RehypeKatex;
}

let cached: MathPlugins | null = null;
let inflight: Promise<void> | null = null;

function loadMathPlugins(): Promise<void> {
  if (cached) return Promise.resolve();
  if (!inflight) {
    inflight = Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      // CSS в той же связке: формулы без стилей выглядят сломанными.
      import('katex/dist/katex.min.css'),
    ])
      .then(([math, katex]) => {
        cached = { remarkMath: math.default, rehypeKatex: katex.default };
      })
      .catch(() => {
        // Сбой (DPI-обрыв, стейл-чанк) не должен ронять сообщение: текст уже
        // отрендерен без математики. Промис сбрасываем — следующее сообщение
        // попробует снова, а не залипнет на отказе навсегда.
        inflight = null;
      });
  }
  return inflight;
}

/**
 * Возвращает плагины, когда они загружены, иначе `null`.
 *
 * @param enabled запускать загрузку только если в тексте реально есть
 *   математика. Сообщение без `$` не должно тянуть 76 КБ.
 */
export function useMathPlugins(enabled: boolean): MathPlugins | null {
  const [plugins, setPlugins] = useState<MathPlugins | null>(cached);

  useEffect(() => {
    if (!enabled || plugins) return;
    let cancelled = false;
    void loadMathPlugins().then(() => {
      // Проверяем именно `cached`, а не факт резолва: при сбое промис
      // резолвится (мы его перехватили), но плагинов всё ещё нет.
      if (!cancelled && cached) setPlugins(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, plugins]);

  return enabled ? plugins : null;
}
