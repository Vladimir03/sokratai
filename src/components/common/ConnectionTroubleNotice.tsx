import { RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import type { ConnectionVerdict } from '@/lib/connectionProbe';

/**
 * Подсказка «похоже, включён VPN» при зависшей или упавшей загрузке.
 *
 * ЗАЧЕМ (инцидент 2026-07-27): ученик Ирины сидел под VPN на Android. ДЗ
 * открылось, а фото условий висели в «Загрузка фото условия...» бесконечно —
 * и, поскольку условия задач были только картинками, ученик не видел задания
 * вообще. Выключил VPN — заработало. Такую подсказку показывают РЕШУ ЕГЭ и
 * Яндекс, и она экономит вечер и ученику, и репетитору.
 *
 * ⚠️ Осознанное исключение из «не винить сеть пользователя» (rule 95). Тот
 * запрет — про ЛОЖНЫЕ «VPN»-алярмы в кабинете репетитора, где причиной был наш
 * собственный кросс-граничный хоп. Здесь причина подтверждена экспериментом, а
 * текст всегда даёт вторую версию («если VPN нет — проверь интернет»), поэтому
 * ошибочный совет не заводит в тупик.
 *
 * Формулировка зависит от вердикта `connectionProbe`, но подсказка появляется
 * НЕ ДОЖИДАЯСЬ его: `unknown` — валидное стартовое состояние с нейтральным
 * текстом, который затем уточняется.
 */

type NoticeContext = 'photo' | 'login';

interface ConnectionTroubleNoticeProps {
  verdict: ConnectionVerdict;
  context: NoticeContext;
  onRetry?: () => void;
  isRetrying?: boolean;
  className?: string;
}

function resolveCopy(
  verdict: ConnectionVerdict,
  context: NoticeContext,
): { title: string; body: string; icon: 'vpn' | 'offline' } {
  const subject = context === 'photo' ? 'фото условия' : 'вход';

  if (verdict === 'server_unreachable') {
    return {
      icon: 'offline',
      title: 'Похоже, пропал интернет',
      body:
        context === 'photo'
          ? 'Сократ не отвечает. Проверь подключение и нажми «Повторить».'
          : 'Сократ не отвечает. Проверь подключение и попробуй войти ещё раз.',
    };
  }

  if (verdict === 'server_ok') {
    // Сервер отвечает, а контент не доходит — характерная картина VPN/DPI.
    return {
      icon: 'vpn',
      title: 'Похоже, включён VPN',
      body:
        context === 'photo'
          ? 'Сократ работает с российских серверов, и через VPN фото не проходит. Выключи VPN и нажми «Повторить».'
          : 'Сократ работает с российских серверов, и через VPN вход часто не проходит. Выключи VPN и попробуй ещё раз.',
    };
  }

  return {
    icon: 'vpn',
    title: `Не удалось загрузить ${subject}`,
    body:
      context === 'photo'
        ? 'Чаще всего мешает включённый VPN — выключи его и нажми «Повторить». Если VPN нет, проверь интернет.'
        : 'Чаще всего мешает включённый VPN — выключи его и попробуй ещё раз. Если VPN нет, проверь интернет.',
  };
}

export function ConnectionTroubleNotice({
  verdict,
  context,
  onRetry,
  isRetrying = false,
  className = '',
}: ConnectionTroubleNoticeProps) {
  const { title, body, icon } = resolveCopy(verdict, context);
  const Icon = icon === 'offline' ? WifiOff : ShieldAlert;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 ${className}`}
    >
      <div className="flex gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{title}</p>
          <p className="mt-1 text-sm leading-snug text-amber-800">{body}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {isRetrying ? 'Пробуем…' : 'Повторить'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
