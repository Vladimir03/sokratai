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
}

export const StudentCard = memo(function StudentCard({
  student,
  onClick,
  onCredentialsClick,
  isResettingCredentials = false,
  groupLabel,
}: StudentCardProps) {
  const progress = calculateProgress(student.current_score, student.target_score);
  const paymentStatus = getPaymentStatus(student.paid_until ?? null);
  const lastActivity = formatRelativeTime(student.last_activity_at ?? null);
  const debtAmount = student.debt_amount ?? 0;

  const displayName = student.profiles?.username || 'Без имени';
  const grade = student.profiles?.grade;
  const examType = formatExamType(student.exam_type);
  const subject = student.subject;
  const isAiConnected = Boolean(student.profiles?.telegram_user_id);

  // Activation status
  const lastSignIn = student.last_sign_in_at ?? null;
  const isActivated = lastSignIn != null;

  // Channel flags
  const hasRealEmail = student.has_real_email ?? false;
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
              <h3 className="font-medium text-foreground truncate">{displayName}</h3>
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
                  <span className="text-slate-700 truncate">Email</span>
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
