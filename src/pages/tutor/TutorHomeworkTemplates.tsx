import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Trash2, BookOpen, Loader2, Copy, Landmark } from 'lucide-react';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorHomeworkTemplates } from '@/hooks/useTutorHomework';
import {
  deleteTutorHomeworkTemplate,
  forkTutorHomeworkTemplate,
  updateTutorHomeworkTemplate,
} from '@/lib/tutorHomeworkApi';
import type {
  HomeworkSubject,
  HomeworkTemplateListItem,
  ModernHomeworkSubject,
} from '@/lib/tutorHomeworkApi';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getSubjectLabel, SUBJECTS as MODERN_SUBJECTS } from '@/types/homework';
// unified-task-model F3 (2026-07-05): Банк ДЗ — публикация модераторами
// (mirror kb_mod_* каталога задач), fork «Своя копия» для всех.
import { useIsModerator } from '@/hooks/useIsModerator';
import { supabase } from '@/lib/supabaseClient';

// ─── Constants ───────────────────────────────────────────────────────────────

const SUBJECT_FILTERS: { value: ModernHomeworkSubject | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  ...MODERN_SUBJECTS.map((subject) => ({
    value: subject.id as ModernHomeworkSubject,
    label: subject.name,
  })),
];

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCardImpl({
  template,
  onDelete,
  /** unified-task-model F3: 'bank' = read-only карточка Банка (без rename/delete). */
  variant = 'mine',
  isModerator = false,
  onFork,
  onPublish,
  onUnpublish,
}: {
  template: HomeworkTemplateListItem;
  onDelete: (id: string) => void;
  variant?: 'mine' | 'bank';
  isModerator?: boolean;
  onFork?: (id: string) => void;
  onPublish?: (id: string) => void;
  onUnpublish?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const subjectLabel = getSubjectLabel(template.subject);

  // Inline rename — click по заголовку → <Input>, Enter сохраняет, Escape
  // отменяет, blur тоже сохраняет. API (`updateTutorHomeworkTemplate`) имеет
  // жёсткий whitelist `title/tags/topic` на backend'е, поэтому отправляем
  // ТОЛЬКО { title }. iOS Safari 16px rule — Input класс `text-base`.
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(template.title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // In-flight guard — защита от двойного PATCH при Enter+blur. При Enter
  // handler ставит saving=true → React перерисовывает Input с disabled=true →
  // браузер блюрит disabled-input → onBlur fires `commitRename` ещё раз. Без
  // ref-guard'а второй вызов пройдёт до commit'а state (`saving=true` не
  // закоммичен в тот же тик) и улетит второй PATCH. useRef читается
  // синхронно, useState — нет.
  const commitInFlightRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      setDraftTitle(template.title);
      // requestAnimationFrame — Input может быть не смонтирован на мгновение.
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isEditing, template.title]);

  const commitRename = useCallback(async () => {
    if (commitInFlightRef.current) return;
    const trimmed = draftTitle.trim();
    if (!trimmed || trimmed === template.title) {
      setIsEditing(false);
      setDraftTitle(template.title);
      return;
    }
    commitInFlightRef.current = true;
    setSaving(true);
    try {
      await updateTutorHomeworkTemplate(template.id, { title: trimmed });
      toast({ title: 'Название шаблона обновлено' });
      await queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
      setIsEditing(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить название';
      toast({ title: message, variant: 'destructive' });
      // Оставляем в edit-mode для retry — не сбрасываем draft.
    } finally {
      commitInFlightRef.current = false;
      setSaving(false);
    }
  }, [draftTitle, template.id, template.title, toast, queryClient]);

  const cancelRename = useCallback(() => {
    setDraftTitle(template.title);
    setIsEditing(false);
  }, [template.title]);

  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{subjectLabel}</span>
          <div className="flex items-center gap-1.5">
            {/* Банк: social proof + бейдж «В банке» на своих опубликованных. */}
            {variant === 'bank' && (template.usage_count ?? 0) > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                использовано {template.usage_count}
              </span>
            ) : null}
            {variant === 'mine' && template.visibility === 'shared' ? (
              <Badge variant="secondary" className="text-xs gap-1">
                <Landmark className="h-3 w-3" aria-hidden="true" />
                В банке
              </Badge>
            ) : null}
            <Badge variant="outline" className="text-xs">
              {template.task_count ?? 0} {(template.task_count ?? 0) === 1 ? 'задача' : 'задач'}
            </Badge>
          </div>
        </div>

        {variant === 'bank' ? (
          <h3 className="font-semibold text-base leading-tight line-clamp-2">{template.title}</h3>
        ) : isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              onBlur={commitRename}
              disabled={saving}
              maxLength={200}
              className="text-base min-h-[44px]"
              aria-label="Название шаблона"
            />
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : null}
          </div>
        ) : (
          <h3
            role="button"
            tabIndex={0}
            title="Нажмите, чтобы переименовать"
            onClick={() => setIsEditing(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsEditing(true);
              }
            }}
            className="font-semibold text-base leading-tight line-clamp-2 cursor-text rounded-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {template.title}
          </h3>
        )}

        {template.topic && (
          <p className="text-sm text-muted-foreground line-clamp-1">{template.topic}</p>
        )}

        {template.tags && template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {template.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => navigate(`/tutor/homework/create?template_id=${template.id}`)}
            disabled={saving}
          >
            {variant === 'bank' ? 'Выдать' : 'Использовать'}
          </Button>
          {variant === 'bank' ? (
            <>
              {onFork ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => onFork(template.id)}
                  title="Создать свою копию (правки не затронут шаблон Банка)"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Своя копия
                </Button>
              ) : null}
              {isModerator && onUnpublish ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => onUnpublish(template.id)}
                  title="Снять из Банка (модератор)"
                >
                  Снять
                </Button>
              ) : null}
            </>
          ) : (
            <>
              {isModerator && onPublish && template.visibility !== 'shared' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => onPublish(template.id)}
                  disabled={saving}
                  title="Опубликовать в общий Банк ДЗ (личные задачи автоопубликуются в каталог)"
                >
                  <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
                  В банк
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onDelete(template.id)}
                disabled={saving}
                aria-label="Удалить шаблон"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// List-item в grid шаблонов — per .claude/rules/performance.md обёрнут в
// React.memo, чтобы unrelated re-renders parent'а (например смена
// subjectFilter) не инвалидировали неизменные карточки. Локальное edit-state
// (isEditing/draftTitle/saving) живёт внутри — типинг в одной карточке не
// требует ре-рендера соседей в любом случае.
const TemplateCard = memo(TemplateCardImpl);

// ─── Main content ─────────────────────────────────────────────────────────────

function TutorHomeworkTemplatesContent() {
  // unified-task-model F3 (2026-07-05): вкладки «Мои шаблоны / Банк Сократа».
  const [scope, setScope] = useState<'mine' | 'shared'>('mine');
  const [subjectFilter, setSubjectFilter] = useState<ModernHomeworkSubject | 'all'>('all');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isModerator } = useIsModerator();

  const subject = subjectFilter === 'all' ? undefined : subjectFilter;
  const { templates, loading, error, isFetching, refetch } = useTutorHomeworkTemplates(subject, scope);

  const handleDelete = useCallback(
    async (templateId: string) => {
      if (!confirm('Удалить шаблон? Это действие нельзя отменить.')) return;
      try {
        await deleteTutorHomeworkTemplate(templateId);
        toast({ title: 'Шаблон удалён' });
        await queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
      } catch {
        toast({ title: 'Не удалось удалить шаблон', variant: 'destructive' });
      }
    },
    [toast, queryClient],
  );

  // unified-task-model F3: fork = копия строки + ССЫЛКИ на те же задачи.
  const handleFork = useCallback(
    async (templateId: string) => {
      try {
        await forkTutorHomeworkTemplate(templateId);
        toast({ title: 'Копия создана — она в «Моих шаблонах»' });
        await queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
        setScope('mine');
      } catch (err) {
        toast({
          title: err instanceof Error ? err.message : 'Не удалось создать копию',
          variant: 'destructive',
        });
      }
    },
    [toast, queryClient],
  );

  // Публикация в Банк — клиентская SECURITY DEFINER RPC (kb_require_moderator
  // проверяет auth.uid(); mirror kb_mod_*). `as never` — types.ts ещё без RPC
  // (регенерация Lovable), осознанный escape-hatch (rule 99 паттерн).
  const handlePublish = useCallback(
    async (templateId: string) => {
      if (!confirm('Опубликовать шаблон в общий Банк ДЗ? Его личные задачи автоматически опубликуются в каталог (вместе с решениями и критериями).')) return;
      const { error: rpcErr } = await supabase.rpc(
        'hw_mod_publish_template' as never,
        { p_template_id: templateId } as never,
      );
      if (rpcErr) {
        toast({
          title: /[а-яё]/i.test(rpcErr.message) ? rpcErr.message : 'Не удалось опубликовать шаблон',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Шаблон опубликован в Банк ДЗ' });
      await queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'kb'] });
    },
    [toast, queryClient],
  );

  const handleUnpublish = useCallback(
    async (templateId: string) => {
      if (!confirm('Снять шаблон из Банка? Уже созданные по нему ДЗ и копии не изменятся.')) return;
      const { error: rpcErr } = await supabase.rpc(
        'hw_mod_unpublish_template' as never,
        { p_template_id: templateId } as never,
      );
      if (rpcErr) {
        toast({
          title: /[а-яё]/i.test(rpcErr.message) ? rpcErr.message : 'Не удалось снять шаблон',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Шаблон снят из Банка' });
      await queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
    },
    [toast, queryClient],
  );

  const showSkeleton = loading && templates.length === 0 && !error;

  return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/tutor/homework">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <BookOpen className="h-6 w-6" />
                Шаблоны ДЗ
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Сохранённые задания для быстрого создания ДЗ
              </p>
            </div>
          </div>
        </div>

        <TutorDataStatus
          criticalError={error}
          isFetching={isFetching}
          onRetry={refetch}
        />

        {/* unified-task-model F3: Мои шаблоны / Банк Сократа */}
        <div role="group" aria-label="Источник шаблонов" className="flex gap-1">
          {([
            { value: 'mine', label: 'Мои шаблоны' },
            { value: 'shared', label: 'Банк Сократа' },
          ] as const).map((t) => (
            <button
              key={t.value}
              onClick={() => setScope(t.value)}
              aria-pressed={scope === t.value}
              style={{ touchAction: 'manipulation' }}
              className={`min-h-[44px] px-4 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                scope === t.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-muted-foreground/30 text-muted-foreground hover:border-primary/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Subject filter tabs */}
        <div className="flex gap-1 border-b overflow-x-auto">
          {SUBJECT_FILTERS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSubjectFilter(tab.value)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                subjectFilter === tab.value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {showSkeleton ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-8 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : templates.length === 0 && !error ? (
          <Card className="bg-muted/30">
            <CardContent className="pt-6">
              <div className="text-center space-y-4 py-8">
                <BookOpen className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
                <div>
                  <h3 className="font-medium mb-1 text-lg">
                    {scope === 'shared' ? 'В Банке пока пусто' : 'Нет шаблонов'}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {scope === 'shared'
                      ? 'Готовые ДЗ от Сократа появятся здесь — их можно будет выдать в пару кликов.'
                      : 'Создайте ДЗ и сохраните как шаблон — он появится здесь.'}
                  </p>
                </div>
                {scope === 'mine' ? (
                  <Button asChild>
                    <Link to="/tutor/homework/create">Создать ДЗ</Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onDelete={handleDelete}
                variant={scope === 'shared' ? 'bank' : 'mine'}
                isModerator={isModerator}
                onFork={scope === 'shared' ? handleFork : undefined}
                onPublish={scope === 'mine' && isModerator ? handlePublish : undefined}
                onUnpublish={scope === 'shared' && isModerator ? handleUnpublish : undefined}
              />
            ))}
          </div>
        )}
      </div>
  );
}

export default function TutorHomeworkTemplates() {
  return <TutorHomeworkTemplatesContent />;
}
