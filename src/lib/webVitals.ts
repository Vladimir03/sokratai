/**
 * Полевые Core Web Vitals → edge `web-vitals-report` → `web_vitals_samples` →
 * /admin вкладка «Скорость».
 *
 * ЗАЧЕМ: до 2026-07-26 в репозитории не было НИ ОДНОЙ точки измерения скорости
 * — ни `web-vitals`, ни `PerformanceObserver`. Любая оптимизация была
 * угадыванием. Лаборатория (Lighthouse) тут тем более не помощник: наше узкое
 * место — РФ-DPI и кросс-граничный хоп до api.sokratai.ru, а его синтетика не
 * воспроизводит. Мерить надо на реальных устройствах учеников — старых iPhone
 * на мобильном интернете.
 *
 * Инварианты:
 *  • PII-free СТРОЖЕ, чем у крашей: ни user_id, ни свободного текста. По строке
 *    нельзя узнать, кто это был — только маршрут, устройство и роль.
 *  • Fire-and-forget: никогда не бросает и не блокирует рендер. Сбой телеметрии
 *    не имеет права стоить пользователю ни кадра.
 *  • Только прод/preview-хосты (PROD_HOSTS) — dev-шум не пишем.
 *  • Один батч на страницу, отправка на `hidden`. Отправлять по одному замеру
 *    нельзя: INP и CLS финализируются ТОЛЬКО при уходе со страницы, и
 *    поштучная отправка либо потеряла бы их, либо утроила бы число запросов.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { PROD_HOSTS } from '@/registerServiceWorker';
import { SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabaseClient';

const REPORT_URL = 'https://api.sokratai.ru/functions/v1/web-vitals-report';

/**
 * Доля сессий, которые шлют замеры. 1 = все.
 *
 * При нашем трафике (десятки репетиторов, сотни учеников) сэмплирование
 * навредило бы: p75 в разрезе маршрут×устройство считается по десяткам точек,
 * и половина выборки превратила бы метрику в шум. Ручка оставлена на случай
 * роста — снижать, когда объём станет заметен, а не «на всякий случай».
 */
const SAMPLE_RATE = 1;

/** Роль выводится из маршрута — это бесплатно и не требует ни сессии, ни PII. */
const TUTOR_ROOTS = ['/tutor', '/admin'];
const STUDENT_ROOTS = [
  '/student',
  '/chat',
  '/practice',
  '/diagnostic',
  '/homework',
  '/trainer',
  '/mock-exam',
];

type Sample = {
  metric: Metric['name'];
  value: number;
  rating: Metric['rating'];
  route: string;
  device: 'mobile' | 'desktop';
  role: 'tutor' | 'student' | 'anon';
  nav_type: string | null;
  app_version: string | null;
};

const buffer: Sample[] = [];

function startsWithAny(path: string, roots: string[]): boolean {
  for (const root of roots) {
    if (path === root || path.indexOf(root + '/') === 0) return true;
  }
  return false;
}

function detectRole(path: string): Sample['role'] {
  if (startsWithAny(path, TUTOR_ROOTS)) return 'tutor';
  if (startsWithAny(path, STUDENT_ROOTS)) return 'student';
  return 'anon';
}

/** Порог 768px зеркалит Tailwind `md:` — тот же рубеж, по которому свёрстан UI. */
function detectDevice(): Sample['device'] {
  return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

/**
 * Имя entry-чанка (`index-<hash>.js`) — связывает просадку скорости с
 * конкретным релизом. Без него «стало медленнее» невозможно привязать к деплою.
 */
function detectAppVersion(): string | null {
  try {
    const el = document.querySelector('script[src*="/assets/index-"]');
    const src = el ? el.getAttribute('src') || '' : '';
    const match = src.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Маршрут фиксируется ОДИН РАЗ, на загрузке страницы, и одинаково для всех пяти
 * метрик. Все они описывают один page load, поэтому смешивать базы атрибуции
 * (одни — по стартовому маршруту, другие — по текущему) значило бы делать
 * колонки в /admin несравнимыми между собой.
 *
 * Честное ограничение: если пользователь ушёл SPA-навигацией на другой экран,
 * INP его взаимодействий там всё равно припишется стартовому маршруту.
 * Глубокие экраны при этом видны: на них заходят по ссылке из push/Telegram,
 * а это полноценная загрузка страницы.
 */
const initialPath = typeof window !== 'undefined' ? window.location.pathname : '/';

/**
 * Отправка НЕ защёлкивается «один раз за страницу»: вкладку можно свернуть и
 * вернуть, и после возврата придут новые замеры (INP копится всю жизнь
 * страницы). Защёлка навсегда потеряла бы их. Вместо неё — дренаж буфера:
 * пустой буфер = отправлять нечего, поэтому лишних запросов не возникает.
 */
function send(): void {
  if (buffer.length === 0) return;

  const payload = JSON.stringify({ samples: buffer.splice(0, buffer.length) });
  try {
    void fetch(REPORT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: payload,
      // keepalive обязателен: запрос уходит в момент, когда страница уже
      // скрывается, и обычный fetch браузер имеет право отменить.
      keepalive: true,
    }).catch(() => {
      // Телеметрия скорости не ретраится: замер устарел бы, а повтор на
      // уходящей странице конкурировал бы за keepalive-бюджет с полезными
      // запросами (например, отправкой решения).
    });
  } catch {
    // ignore
  }
}

function collect(metric: Metric): void {
  try {
    if (buffer.length >= 20) return; // потолок батча зеркалит MAX_SAMPLES_PER_BATCH на edge
    buffer.push({
      metric: metric.name,
      value: metric.value,
      rating: metric.rating,
      route: initialPath,
      device: detectDevice(),
      role: detectRole(initialPath),
      nav_type: metric.navigationType ?? null,
      app_version: detectAppVersion(),
    });
  } catch {
    // ignore
  }
}

/**
 * Ставится один раз из `main.tsx`. Идемпотентна: повторный вызов ничего не
 * делает (React StrictMode в dev монтирует дважды).
 */
let installed = false;

export function installWebVitals(): void {
  try {
    if (installed) return;
    if (typeof window === 'undefined') return;
    if (!PROD_HOSTS.includes(window.location.hostname)) return;
    if (SAMPLE_RATE < 1 && Math.random() >= SAMPLE_RATE) return;
    installed = true;

    onLCP(collect);
    onINP(collect);
    onCLS(collect);
    onTTFB(collect);
    onFCP(collect);

    // `visibilitychange → hidden` — единственный надёжный момент отправки на
    // мобильных: `beforeunload`/`unload` на iOS часто не срабатывают вовсе
    // (свайп в фон, переключение приложения). `pagehide` — страховка для
    // случаев, когда страница уходит в bfcache минуя visibilitychange.
    //
    // ⚠️ БЕЗ `capture: true` — ЭТО НЕ КОСМЕТИКА. web-vitals сама слушает
    // `visibilitychange` (в фазе всплытия), и именно там финализирует LCP, CLS
    // и INP. Слушатель в фазе ПЕРЕХВАТА сработал бы РАНЬШЕ неё — то есть до
    // того, как метрики попадут в буфер, и мы стабильно отправляли бы пустоту.
    // Подписки on*() выше уже зарегистрированы, а в одной фазе слушатели
    // вызываются в порядке регистрации ⇒ наш обработчик гарантированно идёт
    // после библиотечного.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') send();
    });
    window.addEventListener('pagehide', send);
  } catch {
    // телеметрия никогда не ломает приложение
  }
}
