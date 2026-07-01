import { memo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Clock,
  KeyRound,
  Bot,
  Mail,
  MessageCircle,
  ArchiveRestore,
  Tag,
  Link2,
} from 'lucide-react';
import type { TutorStudentWithProfile } from '@/types/tutor';
import {
  formatRelativeTime,
  calculateProgress,
  getPaymentStatus,
  getInitials,
  formatExamType,
  formatCurrency,
} from '@/lib/formatters';

interface StudentCardProps {
  student: TutorStudentWithProfile & { paid_until?: string | null; last_activity_at?: string | null };
  onClick: () => void;
  onCredentialsClick: () => void;
  isResettingCredentials?: boolean;
  groupLabel?: string | null;
  /** Метки ученика (доп. группы, is_primary=false) — чипы-хештеги (запрос Елены 2026-06-18). */
  tags?: { id: string; name: string; color?: string | null }[];
  /** Если задан — карточка архивная: показать «Вернуть из архива» (запрос Елены 2026-06-17). */
  onUnarchive?: () => void;
  isUnarchiving?: boolean;
  /** Онбординг v2 (T8): открыть гейт «Подключить» (QR/ссылка) для не подключённого ученика без канала. */
  onConnect?: () => void;
}

export const StudentCard = memo(function StudentCard({
  student,
  onClick,
  onCredentialsClick,
  isResettingCredentials = false,
  groupLabel,
  tags,
  onUnarchive,
  isUnarchiving = false,
  onConnect,
}: StudentCardProps) {
  const progress = calculateProgress(student.current_score, student.target_score);
  const paymentStatus = getPaymentStatus(student.paid_until ?? null);
  const lastActivity = formatRelativeTime(student.last_activity_at ?? null);
  // Долг — из ledger-баланса (единый источник, rule 60), НЕ legacy debt_amount
  // (tutor_payments): иначе чип расходится с балансом на карточке ученика.
  const balance = student.balance ?? 0;
  const debtAmount = balance < 0 ? -balance : 0;

  const displayName = student.profiles?.username || 'Без имени';
  const grade = student.profiles?.grade;
  const examType = formatExamType(student.exam_type);
  const subject = student.subject;
  const isAiConnected = Boolean(student.profiles?.telegram_user_id);

  // Phase 8.1 (2026-05-26): AI настройки (имя + пол) для visibility chip.
  // Amber-dot indicator показывается когда AI **реально** обратится нейтрально —
  // т.е. нет ни tutor-curated имени, ни fallback'ов на profile.full_name или
  // не-автогенерированный username. Mirror серверной priority chain
  // resolveStudentIdentity (homework-api/index.ts:5517-5567), иначе tooltip
  // будет лгать «AI без имени» когда AI на самом деле использует full_name
  // (ChatGPT-5.5 review #2, 2026-05-26).
  const hasCuratedName = Boolean(student.display_name?.trim());
  const fullNameFromProfile = student.profiles?.full_name?.trim() ?? '';
  const usernameFromProfile = student.profiles?.username?.trim() ?? '';
  const hasNonAutoUsername =
    usernameFromProfile.length > 0 && !/^(telegram_|user_)\d+$/i.test(usernameFromProfile);
  const hasAnyName = hasCuratedName || Boolean(fullNameFromProfile) || hasNonAutoUsername;
  const hasCuratedGender = student.gender === 'male' || student.gender === 'female';
  // Show nudge if AI **actually** lacks name OR gender. Если есть имя через
  // fallback (full_name) и только gender не выставлен — это всё ещё стоит
  // показать (нейтральный род = неточно), но tooltip даст точное объяснение.
  const showAiSetupNudge = !hasAnyName || !hasCuratedGender;
  // For tooltip copy: разделяем case «AI вообще не знает имя» от
  // «tutor не закрепил персональное AI-имя, но fallback работает».
  const aiUsesNameFallback = !hasCuratedName && hasAnyName;

  // Activation status
  const lastSignIn = student.last_sign_in_at ?? null;
  const isActivated = lastSignIn != null;

  // Channel flags
  const hasRealEmail = student.has_real_email ?? false;
  const loginEmail = student.login_email?.trim() ?? '';
  const hasTelegramBot = student.has_telegram_bot ?? false;
  const hasTelegramUsername = student.has_telegram_username ?? false;
  const telegramUsername = student.profiles?.telegram_username;

  // Build subtitle parts
  const subtitleParts = [
    grade ? `${grade} класс` : null,
    examType,
    subject,
  ].filter(Boolean);

  return (
    <Card
      className="p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <Avatar className="h-12 w-12 shrink-0">
          <AvatarImage src={undefined} alt={displayName} />
          <AvatarFallback className="bg-primary/10 text-primary font-medium">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Name row + activation badge */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-medium text-foreground truncate flex items-center gap-1.5">
                {displayName}
                {showAiSetupNudge && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="inline-flex h-2 w-2 rounded-full bg-amber-500 cursor-help"
                        aria-label="AI настройки не заполнены"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="text-xs max-w-[260px]">
                      {!hasAnyName && !hasCuratedGender
                        ? 'AI пишет нейтрально и без имени. Открой профиль и заполни «Как обращаться в AI-чате» + «Пол ученика».'
                        : !hasAnyName
                        ? 'AI не знает имя ученика. Открой профиль и заполни «Как обращаться в AI-чате».'
                        : !hasCuratedGender && aiUsesNameFallback
                        ? 'AI использует имя из профиля, но пишет в нейтральном роде. Закрепи персональное имя + выбери «Пол ученика».'
                        : !hasCuratedGender
                        ? 'AI пишет в нейтральном роде. Выбери «Пол ученика» для правильных глаголов.'
                        : 'Персональное AI-имя не закреплено. AI использует имя из профиля; закрепи свой вариант, если хочешь точнее.'}
                    </TooltipContent>
                  </Tooltip>
                )}
              </h3>
              {subtitleParts.length > 0 && (
                <p className="text-sm text-muted-foreground truncate">
                  {subtitleParts.join(' • ')}
                </p>
              )}
            </div>

            {/* Activation badge */}
            <div className="shrink-0 text-right">
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${
                  isActivated ? 'text-accent' : 'text-slate-400'
                }`}
                aria-label={isActivated ? 'Ученик активирован' : 'Ученик не входил в систему'}
              >
                {isActivated ? (
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {isActivated ? 'Активирован' : 'Не входил'}
              </span>
              {isActivated && lastSignIn && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatRelativeTime(lastSignIn)}
                </p>
              )}
            </div>
          </div>

          {/* Метки (доп. группы) — чипы-хештеги */}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
                >
                  <Tag className="h-3 w-3 text-slate-400" aria-hidden="true" />
                  {t.name}
                </span>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {student.target_score && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Прогресс</span>
                <span>{student.current_score || 0} → {student.target_score} баллов ({progress}%)</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {/* Channel indicators */}
          <div className="flex flex-col gap-1 text-sm">
            {/* Email channel */}
            <span
              className="inline-flex items-center gap-1.5"
              aria-label={hasRealEmail ? 'Email привязан' : 'Email не указан'}
            >
              <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {hasRealEmail ? (
                <>
                  <span className="text-slate-700 truncate">{loginEmail}</span>
                  <CheckCircle className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span className="text-slate-400">Email не указан</span>
                  <XCircle className="h-3.5 w-3.5 text-slate-300 shrink-0" aria-hidden="true" />
                </>
              )}
            </span>

            {/* Telegram channel */}
            <span
              className="inline-flex items-center gap-1.5"
              aria-label={
                hasTelegramBot
                  ? 'Telegram-бот привязан'
                  : hasTelegramUsername
                    ? 'Telegram username указан, бот не привязан'
                    : 'Telegram не указан'
              }
            >
              <MessageCircle className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {hasTelegramBot ? (
                <>
                  <span className="text-slate-700 truncate">
                    {telegramUsername ? `@${telegramUsername}` : 'Telegram'}
                  </span>
                  <CheckCircle className="h-3.5 w-3.5 text-accent shrink-0" aria-hidden="true" />
                </>
              ) : hasTelegramUsername ? (
                <>
                  <span className="text-slate-700 truncate">
                    @{telegramUsername}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <AlertTriangle
                        className="h-3.5 w-3.5 text-amber-500 shrink-0"
                        aria-hidden="true"
                      />
                    </TooltipTrigger>
                    <TooltipContent>Бот не привязан</TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <>
                  <span className="text-slate-400">Telegram не указан</span>
                  <XCircle className="h-3.5 w-3.5 text-slate-300 shrink-0" aria-hidden="true" />
                </>
              )}
            </span>
          </div>

          {/* Онбординг v2 (T8): nudge для не подключённого ученика без канала */}
          {!isActivated && !hasRealEmail && !hasTelegramBot && onConnect && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-xs leading-relaxed text-amber-800">
                Не подключился. Подключите ссылкой или QR — или добавьте email/Telegram, чтобы ученик мог входить с любого устройства.
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-2 w-full"
                onClick={(event) => {
                  event.stopPropagation();
                  onConnect();
                }}
                style={{ touchAction: 'manipulation' }}
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Подключить
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 touch-manipulation"
              onClick={(event) => {
                event.stopPropagation();
                onCredentialsClick();
              }}
              disabled={isResettingCredentials}
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {isResettingCredentials ? 'Сбрасываем...' : 'Данные для входа'}
            </Button>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-3 flex-wrap text-sm">
            {groupLabel && (
              <Badge variant="secondary" className="font-normal">
                Мини-группа: {groupLabel}
              </Badge>
            )}

            {/* AI connected status */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1">
                  <Bot className={`h-4 w-4 ${isAiConnected ? 'text-primary' : 'text-muted-foreground/50'}`} />
                  <span className={isAiConnected ? 'text-primary' : 'text-muted-foreground/50'}>
                    {isAiConnected ? 'AI' : 'Не подключен'}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {isAiConnected
                  ? 'Ученик подключен к AI-помощнику в Telegram'
                  : 'Ученик ещё не подключился к AI-помощнику'}
              </TooltipContent>
            </Tooltip>

            {/* Payment status / Debt */}
            <div className="flex items-center gap-1">
              {debtAmount > 0 ? (
                <>
                  <AlertCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
                  <span className="text-red-600 font-medium">Долг: {formatCurrency(debtAmount)}</span>
                </>
              ) : balance > 0 ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" aria-hidden="true" />
                  <span className="text-green-600">Предоплата: {formatCurrency(balance)}</span>
                </>
              ) : paymentStatus.isPaid ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" aria-hidden="true" />
                  <span className="text-green-600">{paymentStatus.label}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  <span className="text-amber-600">{paymentStatus.label}</span>
                </>
              )}
            </div>

            {/* Last activity */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-4 w-4" aria-hidden="true" />
              <span>{lastActivity}</span>
            </div>

            {/* Status badge */}
            {student.status !== 'active' && (
              <Badge variant={student.status === 'paused' ? 'secondary' : 'outline'}>
                {student.status === 'paused' ? 'Пауза' : 'Завершён'}
              </Badge>
            )}

            {/* Архив (запрос Елены 2026-06-17) */}
            {student.archived_at && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                Архив
              </Badge>
            )}
            {onUnarchive && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onUnarchive(); }}
                disabled={isUnarchiving}
                className="h-8"
                style={{ touchAction: 'manipulation' }}
              >
                <ArchiveRestore className="h-4 w-4 mr-1.5" />
                Вернуть
              </Button>
            )}

            {/* Hourly Rate */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <span className="font-medium">
                {student.hourly_rate_cents != null
                  ? `${student.hourly_rate_cents / 100} ₽/ч`
                  : 'Не указано'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
});
