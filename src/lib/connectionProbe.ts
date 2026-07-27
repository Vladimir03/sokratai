/**
 * Диагностика соединения для подсказки «похоже, включён VPN».
 *
 * ЗАЧЕМ (инцидент 2026-07-27, репорт Ирины): ученик на Android сидел под VPN.
 * API отвечал — ДЗ открылось, — а фото условий не грузились, и экран вечно
 * показывал «Загрузка фото условия...». Условия всех задач были КАРТИНКАМИ
 * (`task_text` = «[Задача на фото]»), поэтому ученик не видел задания вообще.
 * Выключил VPN — всё загрузилось.
 *
 * Пробник запускается ТОЛЬКО когда сбой уже случился (истёк таймаут ожидания
 * или запрос вернул ошибку). На здоровом пути не выполняется ни одного лишнего
 * запроса — скорость обычной работы не страдает.
 *
 * Вердикт уточняет ФОРМУЛИРОВКУ подсказки, но не задерживает её показ:
 * UI рисует нейтральный текст сразу, а `probeConnection` доезжает через
 * секунду-другую и делает совет точнее.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabaseClient';

export type ConnectionVerdict =
  /** Наш сервер ответил, а контент не дошёл → характерная картина VPN/DPI. */
  | 'server_ok'
  /** Сервер не ответил вовсе → скорее пропал интернет, чем VPN. */
  | 'server_unreachable'
  /** Ещё не проверяли или проверка не дала однозначного ответа. */
  | 'unknown';

/** Короткий таймаут: подсказка не должна ждать пробник дольше пары секунд. */
const PROBE_TIMEOUT_MS = 3000;
/** Один вердикт на 15 с — иначе 8 картинок разом дадут 8 запросов. */
const CACHE_TTL_MS = 15_000;

let cached: { verdict: ConnectionVerdict; at: number } | null = null;
let inFlight: Promise<ConnectionVerdict> | null = null;

async function runProbe(): Promise<ConnectionVerdict> {
  // `navigator.onLine === false` — единственный надёжный негативный сигнал
  // браузера; true о доступности сети НЕ говорит, поэтому доверяем только false.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'server_unreachable';
  }

  // AbortSignal.timeout() нельзя — Safari < 16 (rule 80). Только ручной таймер.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    // Любой HTTP-ответ (200/401/403) означает «сервер достижим» — нас интересует
    // ФАКТ ответа, а не его код, поэтому статус намеренно не проверяем.
    await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      signal: controller.signal,
      cache: 'no-store',
    });
    return 'server_ok';
  } catch {
    // Сюда попадают и обрыв, и таймаут (abort) — для пользователя это одно и то же.
    return 'server_unreachable';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Возвращает вердикт о доступности нашего сервера.
 * Никогда не бросает: вызывающий UI не должен падать из-за диагностики.
 */
export async function probeConnection(): Promise<ConnectionVerdict> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.verdict;
  if (inFlight) return inFlight;

  inFlight = runProbe()
    .then((verdict) => {
      cached = { verdict, at: Date.now() };
      return verdict;
    })
    .catch((): ConnectionVerdict => 'unknown')
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Сбрасывает кэш — нужен после ручного «Повторить», иначе вердикт залипнет. */
export function resetConnectionProbeCache(): void {
  cached = null;
}
