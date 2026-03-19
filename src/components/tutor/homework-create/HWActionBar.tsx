import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, Send, Save } from 'lucide-react';
import type { SubmitPhase } from './types';

// ─── Submit phase tracker ────────────────────────────────────────────────────

interface SubmitPhaseTrackerProps {
  phase: SubmitPhase;
  notifyEnabled: boolean;
  hasMaterials: boolean;
}

function SubmitPhaseTracker({ phase, notifyEnabled, hasMaterials }: SubmitPhaseTrackerProps) {
  const phases: Array<{ key: Exclude<SubmitPhase, 'idle' | 'done'>; label: string }> = [
    { key: 'creating', label: 'Создание' },
    ...(hasMaterials ? [{ key: 'adding_materials' as const, label: 'Материалы' }] : []),
    { key: 'assigning', label: 'Назначение' },
    ...(notifyEnabled ? [{ key: 'notifying' as const, label: 'Уведомления' }] : []),
  ];

  const currentIdx = phases.findIndex((p) => p.key === phase);
  const doneByFinalState = phase === 'done';

  return (
    <div className="flex flex-wrap gap-2">
      {phases.map((p, idx) => {
        const isDone = doneByFinalState || (currentIdx > -1 && idx < currentIdx);
        const isCurrent = currentIdx === idx;
        return (
          <Badge
            key={p.key}
            variant={isDone ? 'default' : 'secondary'}
            className={isCurrent ? 'ring-1 ring-primary/50' : ''}
          >
            {p.label}
          </Badge>
        );
      })}
    </div>
  );
}

// ─── Action bar (single-page: submit only, no step navigation) ──────────────

export interface HWActionBarProps {
  onSubmit: () => void;
  isSubmitting: boolean;
  submitPhase: SubmitPhase;
  submitLabel: string;
  notifyEnabled: boolean;
  hasMaterials: boolean;
  saveAsTemplate: boolean;
  onSaveAsTemplateChange: (v: boolean) => void;
  isEditMode?: boolean;
}

export function HWActionBar({
  onSubmit,
  isSubmitting,
  submitPhase,
  submitLabel,
  notifyEnabled,
  hasMaterials,
  saveAsTemplate,
  onSaveAsTemplateChange,
  isEditMode,
}: HWActionBarProps) {
  const idleIcon = isEditMode
    ? <Save className="h-4 w-4" />
    : notifyEnabled
      ? <Send className="h-4 w-4" />
      : <Check className="h-4 w-4" />;

  return (
    <div className="border-t pt-4 sticky bottom-0 bg-background pb-4 md:pb-0 md:relative z-10 space-y-3">
      {!isEditMode && (
        <SubmitPhaseTracker
          phase={submitPhase}
          notifyEnabled={notifyEnabled}
          hasMaterials={hasMaterials}
        />
      )}
      {!isEditMode && submitPhase === 'idle' && (
        <div className="flex items-center gap-2">
          <Switch
            id="save-template-toggle"
            checked={saveAsTemplate}
            onCheckedChange={onSaveAsTemplateChange}
          />
          <Label htmlFor="save-template-toggle" className="text-sm cursor-pointer">
            Сохранить как шаблон
          </Label>
        </div>
      )}
      <div className="flex items-center justify-end">
        <Button
          onClick={onSubmit}
          disabled={isSubmitting}
          className="gap-2"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {!isSubmitting && idleIcon}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
