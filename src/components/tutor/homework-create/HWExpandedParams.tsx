import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { HomeworkSubject } from '@/lib/tutorHomeworkApi';
import { type MetaState, SUBJECTS } from './types';

export interface HWExpandedParamsProps {
  meta: MetaState;
  onChange: (m: MetaState) => void;
  errors: Record<string, string>;
  /** Auto-generated title shown as placeholder when manual title is empty */
  autoTitle?: string;
}

/**
 * L1 (collapsible) meta fields: title, subject, deadline, workflow mode.
 * Topic field is rendered separately in L0 by the container.
 */
export function HWExpandedParams({ meta, onChange, errors, autoTitle }: HWExpandedParamsProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="hw-title">Название</Label>
        <Input
          id="hw-title"
          placeholder={autoTitle || 'Квадратные уравнения'}
          value={meta.title}
          onChange={(e) => onChange({ ...meta, title: e.target.value })}
          className="text-base"
        />
        {!meta.title.trim() && autoTitle && (
          <p className="text-xs text-muted-foreground">
            Будет использовано: {autoTitle}
          </p>
        )}
        {errors.title && <p className="text-sm text-destructive">{errors.title}</p>}
      </div>

      <div className="space-y-2">
        <Label>Предмет *</Label>
        <Select
          value={meta.subject}
          onValueChange={(v) => onChange({ ...meta, subject: v as HomeworkSubject })}
        >
          <SelectTrigger className="text-base">
            <SelectValue placeholder="Выберите предмет" />
          </SelectTrigger>
          <SelectContent>
            {SUBJECTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.subject && <p className="text-sm text-destructive">{errors.subject}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="hw-deadline">Дедлайн (необязательно)</Label>
        <Input
          id="hw-deadline"
          type="datetime-local"
          value={meta.deadline}
          onChange={(e) => onChange({ ...meta, deadline: e.target.value })}
          className="text-base"
        />
      </div>

      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div>
          <Label htmlFor="workflow-mode" className="text-sm font-medium">
            Пошаговое решение с подсказками
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            Ученик решает задачи по одной, получая подсказки и проверку на каждом шаге
          </p>
        </div>
        <Switch
          id="workflow-mode"
          checked={meta.workflow_mode === 'guided_chat'}
          onCheckedChange={(checked) =>
            onChange({ ...meta, workflow_mode: checked ? 'guided_chat' : 'classic' })
          }
        />
      </div>
    </div>
  );
}
