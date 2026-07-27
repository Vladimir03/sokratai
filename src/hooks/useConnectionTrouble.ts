import { useEffect, useState } from 'react';
import {
  probeConnection,
  resetConnectionProbeCache,
  type ConnectionVerdict,
} from '@/lib/connectionProbe';

/**
 * Сколько ждём, прежде чем признать загрузку зависшей.
 *
 * 8 секунд — решение владельца (2026-07-27): ученик не должен смотреть на
 * бесконечный спиннер, как в инциденте с VPN у ученика Ирины. Ложное
 * срабатывание на медленном мобильном интернете допустимо — текст подсказки
 * предлагает и «проверь интернет», а не только VPN.
 */
export const CONNECTION_TROUBLE_DELAY_MS = 8000;

/**
 * Следит за «зависшей» загрузкой и готовит вердикт для подсказки.
 *
 * @param active   идёт ли сейчас проблемное состояние (грузим или уже сбой)
 * @param delayMs  0 — сбой уже произошёл, показываем сразу; иначе ждём таймаут
 */
export function useConnectionTrouble(
  active: boolean,
  delayMs: number = CONNECTION_TROUBLE_DELAY_MS,
): { tripped: boolean; verdict: ConnectionVerdict } {
  const [tripped, setTripped] = useState(false);
  const [verdict, setVerdict] = useState<ConnectionVerdict>('unknown');

  useEffect(() => {
    if (!active) {
      setTripped(false);
      setVerdict('unknown');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      // Показываем подсказку СРАЗУ, не дожидаясь пробника: он лишь уточнит
      // формулировку, когда ответит (решение владельца — не задерживать текст).
      setTripped(true);
      void probeConnection().then((result) => {
        if (!cancelled) setVerdict(result);
      });
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, delayMs]);

  return { tripped, verdict };
}

/** Сброс перед ручным повтором — иначе 15-секундный кэш вернёт старый вердикт. */
export function resetConnectionVerdict(): void {
  resetConnectionProbeCache();
}
