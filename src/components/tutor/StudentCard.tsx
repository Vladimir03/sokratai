import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle, AlertCircle, Clock, Bot } from 'lucide-react';
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
  debtAmount?: number;
}

export function StudentCard({ student, onClick, debtAmount = 0 }: StudentCardProps) {
  const progress = calculateProgress(student.current_score, student.target_score);
  const paymentStatus = getPaymentStatus(student.paid_until ?? null);
  const lastActivity = formatRelativeTime(student.last_activity_at ?? null);
  
  const displayName = student.profiles?.username || 'Без имени';
  const grade = student.profiles?.grade;
  const examType = formatExamType(student.exam_type);
  const subject = student.subject;
  const isAiConnected = Boolean(student.profiles?.telegram_user_id);

  // Build subtitle parts
  const subtitleParts = [
    grade ? `${grade} класс` : null,
    examType,
    subject,
  ].filter(Boolean);

  return (
    <Card 
      className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
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
          {/* Name and subtitle */}
          <div>
            <h3 className="font-medium text-foreground truncate">{displayName}</h3>
            {subtitleParts.length > 0 && (
              <p className="text-sm text-muted-foreground truncate">
                {subtitleParts.join(' • ')}
              </p>
            )}
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

          {/* Status row */}
          <div className="flex items-center gap-3 flex-wrap text-sm">
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
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span className="text-red-600 font-medium">Долг: {formatCurrency(debtAmount)}</span>
                </>
              ) : paymentStatus.isPaid ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-green-600">{paymentStatus.label}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span className="text-amber-600">{paymentStatus.label}</span>
                </>
              )}
            </div>

            {/* Last activity */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-4 w-4" />
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
                  ? `💰 ${student.hourly_rate_cents / 100} ₽/ч` 
                  : '💰 Не указано'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
