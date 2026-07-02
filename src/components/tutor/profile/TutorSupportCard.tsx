import { Send } from 'lucide-react';

import { TUTOR_SUPPORT_TELEGRAM_URL } from '@/lib/tutorPlanCopy';

/**
 * «Прямая связь с основателем» — контакт/поддержка в Telegram (решение Vladimir
 * 2026-07-02). После перевода оплаты на YooKassa Telegram-CTA остаётся как
 * канал ОТНОШЕНИЙ с репетиторами (вопросы, идеи, проблемы), а не платёжный путь.
 */
export function TutorSupportCard() {
  return (
    <section
      aria-label="Связь с командой"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">Прямая связь с основателем</h2>
      <p className="mt-1 text-sm text-slate-500">
        Любые вопросы по Сократу — пишите напрямую: поможем настроить, учтём ваши идеи, быстро
        разберёмся с проблемой.
      </p>

      <div className="mt-4">
        <a
          href={TUTOR_SUPPORT_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ touchAction: 'manipulation' }}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-socrat-telegram px-4 text-sm font-semibold text-white transition-colors hover:bg-socrat-telegram-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-telegram/40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Написать в Telegram
        </a>
      </div>
    </section>
  );
}
