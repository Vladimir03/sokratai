/**
 * unified-task-model F0 (2026-07-05): извлечено VERBATIM из
 * `homework-create/HWTaskCard.tsx` — структурный редактор критериев
 * (criteria-grading feature, 2026-06). Используют: конструктор ДЗ (HWTaskCard)
 * и КБ-модалки (F1). Тип GradingCriterion — type-only импорт из
 * homework-create/types (единый носитель формы критерия).
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { GradingCriterion } from '@/components/tutor/homework-create/types';
import { GRADING_CRITERIA_PRESETS, sumAiGradableCriteriaMax } from '@/lib/gradingCriteriaPresets';

interface CriterionRowProps {
  criterion: GradingCriterion;
  index: number;
  onUpdate: (patch: Partial<GradingCriterion>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

/** One editable criterion row. Local max-string state mirrors the task max_score
 *  pattern (lets the tutor type «12.» before «5» without losing keystrokes). */
const CriterionRow = memo(function CriterionRow({
  criterion,
  index,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: CriterionRowProps) {
  const [maxText, setMaxText] = useState<string>(() => String(criterion.max));
  useEffect(() => {
    setMaxText(String(criterion.max));
  }, [criterion.max]);
  const handleMaxBlur = useCallback(() => {
    const raw = maxText.replace(',', '.').trim();
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v < 0.5) {
      onUpdate({ max: 1 });
      setMaxText('1');
      return;
    }
    const snapped = Math.round(v * 2) / 2;
    onUpdate({ max: snapped });
    setMaxText(String(snapped));
  }, [maxText, onUpdate]);

  const [descOpen, setDescOpen] = useState<boolean>(Boolean(criterion.description));
  const isTutorOnly = criterion.kind === 'tutor_only';

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 p-2 space-y-1.5">
      <div className="flex items-start gap-1.5">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label="Выше"
            disabled={isFirst}
            onClick={onMoveUp}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            style={{ touchAction: 'manipulation' }}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Ниже"
            disabled={isLast}
            onClick={onMoveDown}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
            style={{ touchAction: 'manipulation' }}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <Input
          aria-label={`Критерий ${index + 1}`}
          value={criterion.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Название критерия (напр. К1: Позиция автора)"
          className="flex-1 text-base"
          style={{ fontSize: '16px' }}
        />
        <Input
          aria-label="Макс. балл критерия"
          inputMode="decimal"
          value={maxText}
          onChange={(e) => setMaxText(e.target.value)}
          onBlur={handleMaxBlur}
          className="w-16 text-base text-center"
          style={{ fontSize: '16px', touchAction: 'manipulation' }}
        />
        <button
          type="button"
          aria-label="Удалить критерий"
          onClick={onRemove}
          className="mt-2 text-muted-foreground hover:text-red-600"
          style={{ touchAction: 'manipulation' }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" style={{ touchAction: 'manipulation' }}>
          <input
            type="checkbox"
            checked={isTutorOnly}
            onChange={(e) => onUpdate({ kind: e.target.checked ? 'tutor_only' : 'ai' })}
            className="h-4 w-4 rounded border-slate-300"
          />
          оценивает репетитор
          {isTutorOnly ? <span className="text-[10px] text-muted-foreground">(вне AI-суммы)</span> : null}
        </label>
        <button
          type="button"
          onClick={() => setDescOpen((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground"
          style={{ touchAction: 'manipulation' }}
        >
          {descOpen ? '− описание баллов' : '+ описание баллов'}
        </button>
      </div>
      {descOpen ? (
        <textarea
          aria-label="Описание баллов критерия"
          value={criterion.description ?? ''}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Как начислять балл (напр. 3 — 2 примера с пояснением + смысловая связь)…"
          className="ml-6 flex w-[calc(100%-1.5rem)] rounded-md border border-input bg-background px-2 py-1.5 text-base resize-y min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ fontSize: '16px' }}
        />
      ) : null}
    </div>
  );
});

export interface CriteriaEditorProps {
  criteria: GradingCriterion[];
  taskMaxScore: number;
  /** Reconciles grading_criteria_json + max_score on the parent task. */
  onChange: (next: GradingCriterion[]) => void;
}

/**
 * Структурный редактор критериев (любой предмет). Кнопка пресета + список строк +
 * живой Σ-бейдж. Свободный текст рубрики остаётся ниже как доп. заметки.
 * Гейтится non-numeric задачами (criteriaEditorEnabled в HWTaskCard).
 */
export function CriteriaEditor({ criteria, taskMaxScore, onChange }: CriteriaEditorProps) {
  const [open, setOpen] = useState<boolean>(criteria.length > 0);
  // Σ = AI-gradable max (excl. tutor_only) — это и есть шкала, на которой AI
  // ставит балл (= taskMaxScore после авто-reconcile). tutor_only-критерии
  // показываются строками, но в Σ/max_score не входят (их ставит репетитор).
  const sumMax = useMemo(() => sumAiGradableCriteriaMax(criteria), [criteria]);
  const hasTutorOnly = useMemo(() => criteria.some((c) => c.kind === 'tutor_only'), [criteria]);
  const hasCriteria = criteria.length > 0;
  const mismatch = hasCriteria && Math.abs(sumMax - taskMaxScore) > 1e-9;

  const updateAt = useCallback(
    (idx: number, patch: Partial<GradingCriterion>) => {
      onChange(criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    },
    [criteria, onChange],
  );
  const removeAt = useCallback(
    (idx: number) => onChange(criteria.filter((_, i) => i !== idx)),
    [criteria, onChange],
  );
  const moveAt = useCallback(
    (idx: number, dir: -1 | 1) => {
      const j = idx + dir;
      if (j < 0 || j >= criteria.length) return;
      const next = [...criteria];
      [next[idx], next[j]] = [next[j], next[idx]];
      onChange(next);
    },
    [criteria, onChange],
  );
  const addCriterion = useCallback(
    () => onChange([...criteria, { label: '', max: 1 }]),
    [criteria, onChange],
  );
  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = GRADING_CRITERIA_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      onChange(preset.criteria.map((c) => ({ ...c })));
      setOpen(true);
      toast.success(`Критерии загружены: ${preset.label}`);
    },
    [onChange],
  );

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-accent transition-colors"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Критерии оценки (покритериальная проверка AI)
        {hasCriteria ? (
          <span
            className={cn(
              'ml-1 rounded-full px-2 py-0.5 text-[11px] tabular-nums',
              mismatch ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900',
            )}
          >
            Σ {sumMax} / {taskMaxScore}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            AI разложит балл по этим критериям и покажет ученику разбор. Можно загрузить готовый набор
            или задать свои (название + макс. балл).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Загрузить готовые критерии"
              value=""
              onChange={(e) => {
                if (e.target.value) loadPreset(e.target.value);
                e.currentTarget.selectedIndex = 0;
              }}
              className="rounded-md border border-input bg-background px-2 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ fontSize: '16px', touchAction: 'manipulation' }}
            >
              <option value="">Загрузить готовые критерии…</option>
              {GRADING_CRITERIA_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {hasCriteria ? (
            <div className="space-y-2">
              {criteria.map((c, i) => (
                <CriterionRow
                  key={i}
                  criterion={c}
                  index={i}
                  onUpdate={(patch) => updateAt(i, patch)}
                  onRemove={() => removeAt(i)}
                  onMoveUp={() => moveAt(i, -1)}
                  onMoveDown={() => moveAt(i, 1)}
                  isFirst={i === 0}
                  isLast={i === criteria.length - 1}
                />
              ))}
            </div>
          ) : null}

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addCriterion}>
            <Plus className="h-3.5 w-3.5" />
            Добавить критерий
          </Button>

          {hasTutorOnly ? (
            <p className="text-xs text-muted-foreground">
              Критерии «оценивает репетитор» не входят в балл AI ({sumMax}) — вы выставите их вручную при
              проверке. Макс. балл задачи равен сумме AI-критериев.
            </p>
          ) : null}

          {mismatch ? (
            <p className="text-xs text-amber-700">
              Сумма AI-критериев (Σ {sumMax}) не совпадает с макс. баллом задачи ({taskMaxScore}).
              Обычно макс. балл = сумме AI-критериев.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
