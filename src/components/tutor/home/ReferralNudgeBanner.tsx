import { useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, X } from 'lucide-react';

/**
 * Надж «пригласи коллегу» после первой ценности (Stage 3 рефералки, rule 101).
 *
 * Показывается, когда у репетитора есть недавнее событие «ученик сдал/завершил»
 * (сигнал БЕЗ новых запросов — реюз home.recentDialogs, у событий уже есть kind).
 * Пик лояльности = лучший момент попросить рекомендацию. Dismiss — one-shot
 * навсегда (localStorage). Ветераны вне recent-окна покрыты TG-анонсом.
 */

const DISMISS_KEY = 'sokrat-referral-nudge-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function ReferralNudgeBanner({ hasValueSignal }: { hasValueSignal: boolean }) {
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!hasValueSignal || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Safari private mode — скроем хотя бы до перезагрузки
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm text-emerald-900">
        <UserPlus className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        <span>
          Ученики сдают ДЗ — СократAI работает. Есть коллега, которому тоже нужно?{' '}
          <Link
            to="/tutor/profile"
            className="font-medium underline underline-offset-2 hover:text-emerald-700"
          >
            Пригласить коллегу
          </Link>{' '}
          <span className="text-emerald-700/80">— готовим бонусы для приглашающих.</span>
        </span>
      </p>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Скрыть"
        title="Скрыть"
        className="rounded p-1 text-emerald-700/60 hover:bg-emerald-100 hover:text-emerald-900"
        style={{ touchAction: 'manipulation' }}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
