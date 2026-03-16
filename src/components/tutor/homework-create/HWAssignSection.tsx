import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, Search, Check, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useTutorStudents } from '@/hooks/useTutor';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';

export interface HWAssignSectionProps {
  selectedIds: Set<string>;
  onChangeSelected: (s: Set<string>) => void;
  notifyEnabled: boolean;
  onNotifyChange: (v: boolean) => void;
  notifyTemplate: string;
  onTemplateChange: (v: string) => void;
  errors: Record<string, string>;
  assignMode: 'student' | 'group';
  onAssignModeChange: (mode: 'student' | 'group') => void;
  selectedGroupId: string;
  onGroupIdChange: (groupId: string) => void;
  groups: Array<{ id: string; name: string }>;
  inviteWebLink: string;
  studentLoginLink: string;
  studentSignupLink: string;
}

export function HWAssignSection({
  selectedIds,
  onChangeSelected,
  notifyEnabled,
  onNotifyChange,
  notifyTemplate,
  onTemplateChange,
  errors,
  assignMode,
  onAssignModeChange,
  selectedGroupId,
  onGroupIdChange,
  groups,
  inviteWebLink,
  studentLoginLink,
  studentSignupLink,
}: HWAssignSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const {
    students,
    loading,
    error,
    refetch,
    isFetching,
    isRecovering,
    failureCount,
  } = useTutorStudents();

  const handleToggle = useCallback(
    (studentId: string) => {
      const next = new Set(selectedIds);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      onChangeSelected(next);
    },
    [selectedIds, onChangeSelected],
  );

  const handleSelectAll = useCallback(() => {
    onChangeSelected(new Set(students.map((s) => s.student_id)));
  }, [students, onChangeSelected]);

  const handleDeselectAll = useCallback(() => {
    onChangeSelected(new Set());
  }, [onChangeSelected]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => {
      const name = (s.profiles?.username ?? '').toLowerCase();
      const tg = (s.profiles?.telegram_username ?? '').toLowerCase();
      return name.includes(q) || tg.includes(q);
    });
  }, [students, searchQuery]);

  const selectedWithoutTelegramStudents = useMemo(
    () =>
      students.filter(
        (s) => selectedIds.has(s.student_id) && !s.profiles?.telegram_user_id,
      ),
    [students, selectedIds],
  );

  const selectedWithoutTelegram = selectedWithoutTelegramStudents.length;

  const selectedWithoutTelegramPreview = useMemo(() => {
    if (selectedWithoutTelegramStudents.length === 0) return '';
    const names = selectedWithoutTelegramStudents
      .slice(0, 3)
      .map(
        (s) =>
          s.profiles?.username ||
          (s.profiles?.telegram_username ? `@${s.profiles.telegram_username}` : s.student_id),
      );
    const suffix = selectedWithoutTelegramStudents.length > 3 ? '...' : '';
    return `${names.join(', ')}${suffix}`;
  }, [selectedWithoutTelegramStudents]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteWebLink) return;
    try {
      await navigator.clipboard.writeText(inviteWebLink);
      setInviteCopied(true);
      toast.success('Ссылка приглашения скопирована');
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать ссылку приглашения');
    }
  }, [inviteWebLink]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button type="button" variant={assignMode === 'student' ? 'default' : 'outline'} size="sm" onClick={() => onAssignModeChange('student')}>Ученик</Button>
          <Button type="button" variant={assignMode === 'group' ? 'default' : 'outline'} size="sm" onClick={() => onAssignModeChange('group')}>Группа</Button>
        </div>
        {assignMode === 'group' && (
          <Select value={selectedGroupId || undefined} onValueChange={onGroupIdChange}>
            <SelectTrigger><SelectValue placeholder="Выберите группу" /></SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Student list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base">Ученики</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              Выбрать всех
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeselectAll}>
              Снять всех
            </Button>
          </div>
        </div>

        {errors._students && (
          <p className="text-sm text-destructive">{errors._students}</p>
        )}

        <TutorDataStatus
          error={error}
          isFetching={isFetching}
          isRecovering={isRecovering}
          failureCount={failureCount}
          onRetry={refetch}
        />

        {!loading && students.length > 0 && (
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени или @username"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-base"
            />
          </div>
        )}

        {loading && !students.length ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <Card className="bg-muted/30">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                У вас пока нет учеников.{' '}
                <Link to="/tutor/students" className="text-primary underline">
                  Добавить ученика
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : filteredStudents.length === 0 ? (
          <Card className="bg-muted/30">
            <CardContent className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                По запросу ничего не найдено.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1 max-h-[360px] overflow-y-auto rounded-md border p-1">
            {filteredStudents.map((s) => {
              const checked = selectedIds.has(s.student_id);
              const name = s.profiles?.username || 'Без имени';
              const isTelegramConnected = Boolean(s.profiles?.telegram_user_id);
              const statusLabel =
                s.status === 'active'
                  ? null
                  : s.status === 'paused'
                  ? 'На паузе'
                  : 'Завершён';
              return (
                <label
                  key={s.student_id}
                  className="flex items-center gap-3 p-2.5 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => handleToggle(s.student_id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{name}</p>
                    {s.profiles?.telegram_username && (
                      <p className="text-xs text-muted-foreground truncate">
                        @{s.profiles.telegram_username}
                      </p>
                    )}
                  </div>
                  <Badge variant={isTelegramConnected ? 'default' : 'secondary'} className="text-xs">
                    {isTelegramConnected ? 'Telegram подключен' : 'Telegram не подключен'}
                  </Badge>
                  {statusLabel && (
                    <Badge variant="secondary" className="text-xs">
                      {statusLabel}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Выбрано: {selectedIds.size} из {students.length}. Без Telegram: {selectedWithoutTelegram}
        </p>

        {selectedWithoutTelegram > 0 && (
          <Card className="border-amber-500/40 bg-amber-50/40">
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm">
                У {selectedWithoutTelegram} ученик(ов) нет Telegram-связки. ДЗ будет назначено в кабинет на сайте,
                но Telegram-уведомление не отправится.
              </p>
              {selectedWithoutTelegramPreview && (
                <p className="text-xs text-muted-foreground">
                  Без Telegram: {selectedWithoutTelegramPreview}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={studentLoginLink} target="_blank" rel="noreferrer">
                    Вход ученика
                    <ExternalLink className="h-3.5 w-3.5 ml-1" />
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={studentSignupLink} target="_blank" rel="noreferrer">
                    Регистрация ученика
                    <ExternalLink className="h-3.5 w-3.5 ml-1" />
                  </a>
                </Button>
                {inviteWebLink && (
                  <>
                    <Button size="sm" variant="outline" onClick={handleCopyInviteLink}>
                      {inviteCopied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                      {inviteCopied ? 'Скопировано' : 'Копировать инвайт'}
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={inviteWebLink} target="_blank" rel="noreferrer">
                        Страница приглашения
                        <ExternalLink className="h-3.5 w-3.5 ml-1" />
                      </a>
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Notify toggle */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="notify-toggle" className="text-base cursor-pointer">
            Отправить уведомления в Telegram
          </Label>
          <Switch
            id="notify-toggle"
            checked={notifyEnabled}
            onCheckedChange={onNotifyChange}
          />
        </div>
        {notifyEnabled && (
          <div className="space-y-2">
            <Label htmlFor="notify-template" className="text-sm text-muted-foreground">
              Текст сообщения (необязательно, по умолчанию стандартный)
            </Label>
            <textarea
              id="notify-template"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[60px] resize-y"
              placeholder="Новая домашка! Используй /homework чтобы начать."
              value={notifyTemplate}
              onChange={(e) => onTemplateChange(e.target.value)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
