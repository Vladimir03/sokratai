import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  createTemplateFromAssignment,
  type CreateTemplateFromAssignmentPayload,
} from '@/lib/tutorHomeworkApi';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { getSubjectLabel } from '@/types/homework';
import { cn } from '@/lib/utils';

/**
 * Save-as-template post-factum dialog (homework-reuse-v1 TASK-6, AC-14).
 *
 * Independent of the `HWActionBar` «Сохранить как шаблон» checkbox (AC-16) —
 * both paths coexist and create separate template rows with different
 * timestamps. Recognition over Recall (doc 16 Принцип 3): tutor doesn't have
 * to foresee that a homework assignment will be reusable at create-time; they
 * can decide post-factum.
 *
 * Prefill:
 *   - title = `${assignment.title} — шаблон`
 *   - tags  = [subject-label, topic] (если задан topic)
 *
 * Three toggles, all default ON:
 *   - Включить рубрику — rubric_text / rubric_image_urls per task go into
 *     tasks_json snapshot (else nulled in snapshot, not deleted from DB).
 *   - Включить материалы — currently noop at schema level (templates don't
 *     own materials). Switch rendered **disabled** with explanatory hint
 *     instead of hidden, so the tutor knows the feature exists and is coming.
 *   - Включить настройки AI — check_format per task carries into snapshot
 *     (else omitted → default applied when template is used).
 *
 * Telemetry `homework_saved_as_template_post_factum` fires exactly once on
 * successful create, PII-free payload (assignmentId, templateId, toggle state).
 */

interface SaveAsTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  /** Current title of the assignment — used to prefill template title. */
  assignmentTitle: string;
  /** Subject id; used to prefill first tag via `getSubjectLabel`. */
  assignmentSubject: string;
  /** Topic string if set; used to prefill second tag. */
  assignmentTopic?: string | null;
}

const TEMPLATE_SUFFIX = ' — шаблон';

function buildPrefillTitle(title: string): string {
  const trimmed = (title ?? '').trim();
  if (!trimmed) return 'Шаблон ДЗ';
  // Avoid doubling the suffix if the existing title already ends with it.
  if (trimmed.toLowerCase().endsWith(TEMPLATE_SUFFIX.trim().toLowerCase())) {
    return trimmed;
  }
  return `${trimmed}${TEMPLATE_SUFFIX}`;
}

function buildPrefillTags(subject: string, topic?: string | null): string[] {
  const out: string[] = [];
  const subjectLabel = subject ? getSubjectLabel(subject) : null;
  if (subjectLabel) out.push(subjectLabel);
  const trimmedTopic = typeof topic === 'string' ? topic.trim() : '';
  if (trimmedTopic && !out.includes(trimmedTopic)) {
    out.push(trimmedTopic);
  }
  return out;
}

export function SaveAsTemplateDialog({
  open,
  onOpenChange,
  assignmentId,
  assignmentTitle,
  assignmentSubject,
  assignmentTopic,
}: SaveAsTemplateDialogProps) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [includeRubric, setIncludeRubric] = useState(true);
  const [includeAiSettings, setIncludeAiSettings] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Reset transient state when the dialog (re)opens so a previous session's
  // edits don't bleed across opens.
  useEffect(() => {
    if (open) {
      setTitle(buildPrefillTitle(assignmentTitle));
      setTags(buildPrefillTags(assignmentSubject, assignmentTopic));
      setTagDraft('');
      setIncludeRubric(true);
      setIncludeAiSettings(true);
      setSubmitting(false);
    }
  }, [open, assignmentTitle, assignmentSubject, assignmentTopic]);

  const addTagFromDraft = useCallback(() => {
    const value = tagDraft.trim();
    if (!value) return;
    setTags((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setTagDraft('');
  }, [tagDraft]);

  const removeTag = useCallback((target: string) => {
    setTags((prev) => prev.filter((t) => t !== target));
  }, []);

  const handleTagKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addTagFromDraft();
        return;
      }
      if (event.key === 'Backspace' && tagDraft.length === 0 && tags.length > 0) {
        // Classic multi-chip UX: backspace removes trailing tag when input is empty.
        event.preventDefault();
        setTags((prev) => prev.slice(0, -1));
      }
    },
    [addTagFromDraft, tagDraft, tags.length],
  );

  const isTitleValid = useMemo(() => title.trim().length > 0, [title]);

  const handleSubmit = useCallback(async () => {
    if (submitting || !isTitleValid) return;
    setSubmitting(true);

    // Fold any draft tag that the user typed but didn't press Enter on —
    // otherwise the tag is silently dropped and they wonder where it went.
    const committedTagDraft = tagDraft.trim();
    const finalTags = committedTagDraft && !tags.includes(committedTagDraft)
      ? [...tags, committedTagDraft]
      : tags;

    const payload: CreateTemplateFromAssignmentPayload = {
      title: title.trim(),
      tags: finalTags,
      include_rubric: includeRubric,
      // Currently noop at schema level — UI shows disabled switch with hint,
      // so we always send `false` here. Forward-compat once templates learn
      // to own materials (Sprint 2+).
      include_materials: false,
      include_ai_settings: includeAiSettings,
    };

    try {
      const template = await createTemplateFromAssignment(assignmentId, payload);
      trackGuidedHomeworkEvent('homework_saved_as_template_post_factum', {
        assignmentId,
        templateId: template.id,
        includeRubric,
        includeAiSettings,
      });
      toast.success('Шаблон сохранён');
      onOpenChange(false);
    } catch (err) {
      console.error('save_as_template_failed', err);
      toast.error('Не удалось сохранить шаблон');
    } finally {
      setSubmitting(false);
    }
  }, [
    assignmentId,
    includeAiSettings,
    includeRubric,
    isTitleValid,
    onOpenChange,
    submitting,
    tagDraft,
    tags,
    title,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-accent" aria-hidden="true" />
            Сохранить как шаблон
          </DialogTitle>
          <DialogDescription>
            Сохраните задачи этого ДЗ как шаблон, чтобы повторно использовать
            для других групп или параллелей.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="template-title" className="text-sm font-medium text-slate-900">
              Название
            </Label>
            <Input
              id="template-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
              placeholder="Например, «Кинематика 10 класс — шаблон»"
              className="text-base"
              aria-invalid={!isTitleValid}
            />
            {!isTitleValid ? (
              <p className="text-xs text-red-600">Название не может быть пустым.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-tags-input" className="text-sm font-medium text-slate-900">
              Теги
            </Label>
            <p className="text-xs text-slate-500">
              Enter или запятая — добавить тег. Backspace на пустом поле — удалить
              последний.
            </p>
            <div
              className={cn(
                'flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5',
                'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
                submitting && 'opacity-60',
              )}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    disabled={submitting}
                    aria-label={`Удалить тег ${tag}`}
                    className="text-slate-400 transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-full"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                id="template-tags-input"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTagFromDraft}
                disabled={submitting}
                placeholder={tags.length === 0 ? 'кинематика, 10 класс' : ''}
                /* text-base (16px) — iOS Safari auto-zoom prevention, per
                 * .claude/rules/80-cross-browser.md. */
                className="flex-1 min-w-[120px] bg-transparent text-base outline-none"
                aria-label="Добавить тег"
              />
            </div>
          </div>

          <section className="space-y-3" aria-labelledby="template-toggles-heading">
            <h3
              id="template-toggles-heading"
              className="text-sm font-semibold text-slate-900"
            >
              Что включить в шаблон
            </h3>

            <ToggleRow
              id="template-include-rubric"
              label="Включить рубрику"
              description="Проверочные критерии для AI (rubric_text, фото рубрики)"
              checked={includeRubric}
              onCheckedChange={setIncludeRubric}
              disabled={submitting}
            />
            <ToggleRow
              id="template-include-materials"
              label="Включить материалы"
              description="Прикреплённые PDF и ссылки — появится в следующей версии"
              checked={false}
              onCheckedChange={() => {
                /* Intentionally no-op — see description. AC-16 compliance. */
              }}
              disabled
              hint="Материалы ДЗ пока не сохраняются в шаблоне"
            />
            <ToggleRow
              id="template-include-ai-settings"
              label="Включить настройки AI"
              description="disable_ai_bootstrap, check_format per task"
              checked={includeAiSettings}
              onCheckedChange={setIncludeAiSettings}
              disabled={submitting}
            />
          </section>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !isTitleValid}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Сохраняем...
              </>
            ) : (
              'Сохранить шаблон'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  /** Secondary muted hint rendered below description when toggle is disabled. */
  hint?: string;
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  hint,
}: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label
          htmlFor={id}
          className={cn(
            'text-sm font-medium text-slate-900',
            disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
          )}
        >
          {label}
        </Label>
        {description ? (
          <p className="text-xs text-slate-500">{description}</p>
        ) : null}
        {hint ? <p className="text-xs text-amber-700">{hint}</p> : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
