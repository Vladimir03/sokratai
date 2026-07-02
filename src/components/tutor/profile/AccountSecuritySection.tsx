import { SecuritySection } from '@/components/tutor/profile/SecuritySection';
import { LoginProvidersSection } from '@/components/tutor/profile/LoginProvidersSection';

/**
 * «Вход и безопасность» (2026-07-02) — объединяет прежние карточки
 * «Безопасность» (почта/пароль) и «Способы входа» в одну (запрос Vladimir:
 * меньше дробления). Обе секции рендерятся в `embedded`-режиме (без своей
 * карточки, с h3-подзаголовком); их auth-логика неизменна.
 */
export function AccountSecuritySection() {
  return (
    <section
      aria-labelledby="tutor-account-security-heading"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2
        id="tutor-account-security-heading"
        className="text-lg font-semibold text-slate-900"
      >
        Вход и безопасность
      </h2>

      <div className="mt-6 flex flex-col gap-6">
        <SecuritySection embedded />
        <div className="border-t border-border pt-6">
          <LoginProvidersSection embedded />
        </div>
      </div>
    </section>
  );
}

export default AccountSecuritySection;
