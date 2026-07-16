import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Gift, Link2, MessageSquareShare, UserPlus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { copyTextToClipboard } from '@/lib/copyToClipboard';
import {
  claimReferralCode,
  getReferrals,
  trackReferralCodeCopied,
  type ReferralInvitedStage,
  type ReferralsResponse,
} from '@/lib/tutorProgressApi';
import { pluralizeRu } from '@/lib/pluralizeRu';

/**
 * «Пригласить коллегу» — кабинет реферера на /tutor/profile (Stage 3
 * CEO-аналитики, rule 101). НЕ путать с «Пригласить ученика» (invite_code).
 *
 * v1 attribution-only: код + ссылка + готовая фраза + список приглашённых
 * (имя/этап/«платит» — решение владельца) + честное «готовим бонусы».
 * Если сам репетитор ещё не привязан — блок «Вас пригласил коллега?».
 */

const REFERRALS_QUERY_KEY = ['tutor', 'referrals'] as const;

const STAGE_CHIP: Record<ReferralInvitedStage, { label: string; className: string }> = {
  registered: { label: 'присматривается', className: 'bg-slate-100 text-slate-600' },
  working: { label: 'работает с учениками', className: 'bg-sky-100 text-sky-900' },
  value: { label: 'получает результат', className: 'bg-emerald-100 text-emerald-900' },
};

function buildShareMessage(link: string, code: string): string {
  return (
    'Я проверяю ДЗ учеников через СократAI — AI разбирает решения за меня, ' +
    'а ученики не списывают у ChatGPT. Попробуй, 7 дней бесплатно: ' +
    `${link}\nЕсли спросят код приглашения — ${code}`
  );
}

function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM yyyy', { locale: ru });
  } catch {
    return '';
  }
}

export function TutorReferralSection() {
  const queryClient = useQueryClient();
  const query = useQuery<ReferralsResponse>({
    queryKey: REFERRALS_QUERY_KEY,
    queryFn: getReferrals,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  const [claimInput, setClaimInput] = useState('');
  const [claiming, setClaiming] = useState(false);

  const data = query.data;

  const handleCopy = async (kind: 'link' | 'text') => {
    if (!data) return;
    const text = kind === 'link' ? data.link : buildShareMessage(data.link, data.code);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
      trackReferralCodeCopied(kind);
      toast.success(kind === 'link' ? 'Ссылка скопирована' : 'Сообщение скопировано');
    } else {
      toast.error('Не удалось скопировать — выделите и скопируйте вручную');
    }
  };

  const handleClaim = async () => {
    const code = claimInput.trim();
    if (!code) return;
    setClaiming(true);
    try {
      const res = await claimReferralCode(code);
      toast.success(
        res.referrer_name
          ? `Готово — вас пригласил(а) ${res.referrer_name}`
          : 'Код привязан',
      );
      setClaimInput('');
      queryClient.invalidateQueries({ queryKey: REFERRALS_QUERY_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось привязать код');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <section
      aria-label="Пригласить коллегу"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <UserPlus className="h-5 w-5 text-accent" aria-hidden="true" />
          Пригласить коллегу
        </h2>
        {data && data.invited_total > 0 && (
          <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900">
            {data.invited_total}{' '}
            {pluralizeRu(data.invited_total, ['коллега', 'коллеги', 'коллег'])}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Коллега-репетитор получит 7 дней полного AI бесплатно, а вы увидите здесь, как он
        осваивается. Приглашение учеников — на странице «Ученики».
      </p>

      {query.isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-9" />
        </div>
      ) : query.isError || !data ? (
        <div className="mt-4 text-sm text-muted-foreground">
          Не удалось загрузить данные.{' '}
          <button
            type="button"
            className="text-accent underline-offset-2 hover:underline"
            onClick={() => query.refetch()}
          >
            Обновить
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Код + ссылка */}
          <div className="rounded-lg border border-dashed border-slate-300 bg-socrat-surface p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Ваш код приглашения
            </div>
            <div className="mt-0.5 text-2xl font-bold tracking-widest text-slate-900 tabular-nums">
              {data.code}
            </div>
            <div className="mt-1 break-all text-xs text-muted-foreground">{data.link}</div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => handleCopy('link')}
              className="min-h-[44px] bg-accent text-white hover:bg-accent/90"
              style={{ touchAction: 'manipulation' }}
            >
              {copied === 'link' ? (
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Скопировать ссылку
            </Button>
            <Button
              variant="outline"
              onClick={() => handleCopy('text')}
              className="min-h-[44px]"
              style={{ touchAction: 'manipulation' }}
            >
              {copied === 'text' ? (
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
              ) : (
                <MessageSquareShare className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Скопировать сообщение
            </Button>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0 text-socrat-accent" aria-hidden="true" />
            Готовим бонусную программу для приглашающих — привязки уже засчитываются, бонусы
            начислим ретроактивно.
          </p>

          {/* Список приглашённых */}
          {data.invited.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-700">Ваши приглашённые</h3>
              <ul className="mt-2 divide-y divide-slate-100">
                {data.invited.map((row) => (
                  <li
                    key={`${row.name}-${row.registered_at}`}
                    className="flex flex-wrap items-center gap-2 py-2"
                  >
                    <span className="font-medium text-slate-900">{row.name}</span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${STAGE_CHIP[row.stage].className}`}
                    >
                      {STAGE_CHIP[row.stage].label}
                    </span>
                    {row.is_paying && (
                      <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                        платит
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {fmtDate(row.registered_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Кем приглашён сам / ввод кода позже */}
          {data.referred_by.attributed ? (
            data.referred_by.referrer_name && (
              <p className="text-xs text-muted-foreground">
                Вас пригласил(а): {data.referred_by.referrer_name}
              </p>
            )
          ) : (
            <div className="border-t border-slate-100 pt-3">
              <label
                htmlFor="referral-claim-input"
                className="text-sm font-medium text-slate-700"
              >
                Вас пригласил коллега? Введите его код
              </label>
              <div className="mt-2 flex gap-2">
                <Input
                  id="referral-claim-input"
                  value={claimInput}
                  onChange={(e) => setClaimInput(e.target.value)}
                  placeholder="Например: KLM4Q2WX"
                  disabled={claiming}
                  autoComplete="off"
                  className="max-w-[220px]"
                  style={{ fontSize: 16, touchAction: 'manipulation' }}
                />
                <Button
                  variant="outline"
                  onClick={handleClaim}
                  disabled={claiming || !claimInput.trim()}
                  className="min-h-[44px]"
                  style={{ touchAction: 'manipulation' }}
                >
                  {claiming ? 'Привязываем…' : 'Привязать'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
