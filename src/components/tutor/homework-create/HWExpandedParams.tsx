import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MetaState } from './types';

export interface HWExpandedParamsProps {
  meta: MetaState;
  onChange: (m: MetaState) => void;
  errors: Record<string, string>;
  /** Auto-generated title shown as placeholder when manual title is empty */
  autoTitle?: string;
}

/**
 * L1 (collapsible) meta fields: title, deadline, workflow mode.
 * Topic + Subject are rendered in L0 by the container (always visible).
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

      {meta.workflow_mode === 'guided_chat' && (
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div>
            <Label htmlFor="ai-bootstrap" className="text-sm font-medium">
              AI-вступление к задачам
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              AI пишет стартовое сообщение при открытии каждой задачи
            </p>
          </div>
          <Switch
            id="ai-bootstrap"
            checked={!(meta.disable_ai_bootstrap ?? false)}
            onCheckedChange={(checked) =>
              onChange({ ...meta, disable_ai_bootstrap: !checked })
            }
          />
        </div>
      )}
    </div>
  );
}
