/**
 * Мягкий выход из «не того аккаунта» (инцидент Никиты, 2026-08-05).
 *
 * Сценарий: ученик не смог войти по паролю и нажал «Войти через Яндекс» —
 * OAuth молча создал НОВЫЙ пустой аккаунт (яндекс-почта не совпала с почтой
 * аккаунта от репетитора). Ученик видит пустое расписание/ДЗ и решает, что
 * «всё пропало»; репетитор — что сломался продукт.
 *
 * Сам OAuth-флоу НЕ трогаем (rule 96: high-risk зона, 406-ФЗ) — вместо этого
 * заметный баннер на пустом пост-логин экране СВЕЖЕГО аккаунта с кнопкой
 * выхода. Для честно-нового ученика без занятий баннер безвреден: он начинается
 * с вопроса и ничего не ломает.
 *
 * Гейт: аккаунт создан < 48 ч назад (из ЛОКАЛЬНОЙ сессии — `getSession` не
 * ходит в сеть, performance.md) + родитель монтирует только при пустом списке.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRoundSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';

const FRESH_ACCOUNT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function WrongAccountNudge() {
  const navigate = useNavigate();
  const [isFreshAccount, setIsFreshAccount] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const createdAt = data.session?.user?.created_at;
      if (!createdAt) return;
      const ageMs = Date.now() - Date.parse(createdAt);
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < FRESH_ACCOUNT_MAX_AGE_MS) {
        setIsFreshAccount(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isFreshAccount) return null;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-700"
          aria-hidden="true"
        >
          <UserRoundSearch className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm leading-relaxed text-amber-900">
            Уже занимаешься с репетитором, а здесь пусто? Возможно, ты вошёл не в
            тот аккаунт — например, кнопкой Яндекса с другой почтой. Выйди и
            войди по данным от репетитора (почта и пароль) или по коду.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            className="min-h-[44px] border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
            style={{ touchAction: 'manipulation' }}
          >
            {isSigningOut ? 'Выходим…' : 'Выйти и войти заново'}
          </Button>
        </div>
      </div>
    </div>
  );
}
