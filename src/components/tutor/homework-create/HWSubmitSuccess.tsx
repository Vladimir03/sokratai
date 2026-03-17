// Job: P0.1 — показать результат отправки ДЗ на той же странице (Phase 4)
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, AlertTriangle, Copy, Check, ExternalLink, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { SubmitSuccessResult, StudentDeliveryStatus } from './types';

// ─── Per-student delivery row ────────────────────────────────────────────────

interface StudentRowProps {
  student: StudentDeliveryStatus;
  inviteWebLink: string;
  studentLoginLink: string;
}

function StudentRow({ student, inviteWebLink, studentLoginLink }: StudentRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const link = inviteWebLink || studentLoginLink;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(`Ссылка для ${student.name} скопирована`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  }, [inviteWebLink, studentLoginLink, student.name]);

  if (student.hasTelegram) {
    // 3 states: notified ✅ / delivery failed ⚠️ / notifications disabled ✓
    if (student.notified) {
      return (
        <div className="flex items-center gap-2 py-1.5">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-sm flex-1 min-w-0 truncate">{student.name}</span>
          <Badge variant="default" className="text-xs shrink-0 bg-green-600 hover:bg-green-700">Уведомлен</Badge>
        </div>
      );
    }
    if (student.deliveryFailed) {
      return (
        <div className="flex items-center gap-2 py-1.5">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-sm flex-1 min-w-0 truncate">{student.name}</span>
          <Badge variant="secondary" className="text-xs shrink-0 text-amber-600">Ошибка доставки</Badge>
        </div>
      );
    }
    // Notifications were disabled or not attempted
    return (
      <div className="flex items-center gap-2 py-1.5">
        <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm flex-1 min-w-0 truncate">{student.name}</span>
        <Badge variant="secondary" className="text-xs shrink-0">ДЗ назначено</Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1.5">
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
      <span className="text-sm flex-1 min-w-0 truncate">{student.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">нет Telegram</span>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs shrink-0"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Скопировано' : 'Ссылка'}
      </Button>
    </div>
  );
}

// ─── Main success component ───────────────────────────────────────────────────

export interface HWSubmitSuccessProps {
  result: SubmitSuccessResult;
  onCreateAnother: () => void;
}

export function HWSubmitSuccess({ result, onCreateAnother }: HWSubmitSuccessProps) {
  const navigate = useNavigate();

  const notifiedCount = result.studentStatuses.filter((s) => s.notified).length;
  const noTelegramStudents = result.studentStatuses.filter((s) => !s.hasTelegram);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/tutor/homework')}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Домашки
        </Button>
      </div>

      {/* Success banner */}
      <Card animate={false} className="border-green-500/40 bg-green-50/40">
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-green-600 shrink-0" />
            <div>
              <h1 className="text-xl font-bold">ДЗ отправлено!</h1>
              <p className="text-sm text-muted-foreground truncate">{result.title}</p>
            </div>
          </div>

          {/* Meta pills */}
          <div className="flex flex-wrap gap-2">
            {result.topic && (
              <Badge variant="secondary">{result.topic}</Badge>
            )}
            {result.groupName ? (
              <Badge variant="secondary">{result.groupName}</Badge>
            ) : (
              <Badge variant="secondary">{result.assignedCount} ученик(ов)</Badge>
            )}
            <Badge variant="secondary">{result.taskCount} задач(и)</Badge>
            {notifiedCount > 0 && (
              <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                Telegram: {notifiedCount}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-student delivery status */}
      <section>
        <h2 className="text-base font-semibold mb-3">Статус доставки</h2>
        <Card animate={false}>
          <CardContent className="pt-4 divide-y">
            {result.studentStatuses.map((s) => (
              <StudentRow
                key={s.studentId}
                student={s}
                inviteWebLink={result.inviteWebLink}
                studentLoginLink={result.studentLoginLink}
              />
            ))}
          </CardContent>
        </Card>

        {noTelegramStudents.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            ⚠️ {noTelegramStudents.length} ученик(ов) без Telegram — ДЗ назначено в кабинет,
            уведомление не отправлено. Скопируйте ссылку и отправьте им вручную.
          </p>
        )}
        {result.inviteWebLink && noTelegramStudents.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 gap-2"
            asChild
          >
            <a href={result.inviteWebLink} target="_blank" rel="noreferrer">
              Страница приглашения
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </section>

      {/* Navigation actions */}
      <div className="flex flex-wrap gap-3 border-t pt-4">
        <Button
          onClick={() => navigate(`/tutor/homework/${result.assignmentId}`)}
          className="gap-2"
        >
          Открыть ДЗ
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          onClick={onCreateAnother}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Создать ещё
        </Button>
        <Button
          variant="ghost"
          onClick={() => navigate('/tutor/homework')}
        >
          ← Домашки
        </Button>
      </div>
    </div>
  );
}
