import { memo, useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ListChecks, Lightbulb } from 'lucide-react';
import { MathText } from '@/components/kb/ui/MathText';
import type { Variable } from '@/lib/formulaEngine/types';

interface DisclosureProps {
  label: string;
  icon: ReactNode;
  children: ReactNode;
}

/**
 * Single collapsible row. Button + useState + aria-expanded — NOT native
 * <details>/<summary> (iOS Safari marker/toggle quirks, rule 80). Tap target
 * ≥44px, touch-action: manipulation against the 300ms tap delay.
 */
function Disclosure({ label, icon, children }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        style={{ touchAction: 'manipulation', minHeight: '44px' }}
      >
        <span className="flex items-center gap-2">
          <span className="text-slate-400" aria-hidden="true">
            {icon}
          </span>
          {label}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          className="px-3 pb-3 animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface FormulaHintPanelProps {
  /** From formula.variables — список величин (symbol — name (unit)). */
  variables: Variable[];
  /**
   * formula.physicalMeaning — блок «Как рассуждать». Передавать ТОЛЬКО там, где
   * это не спойлит ответ: BuildFormula (формула уже известна) — да; TrueOrFalse
   * (раскрыл бы верную связь) — нет (не передавать пропс).
   */
  reasoning?: string | null;
}

/**
 * Опциональные подсказки, раскрываемые учеником ВО ВРЕМЯ вопроса (req 5 + req 7):
 * «Что значат величины» (всегда) и «Как рассуждать» (только где не спойлер).
 * Оба свёрнуты по умолчанию.
 */
export const FormulaHintPanel = memo(function FormulaHintPanel({
  variables,
  reasoning,
}: FormulaHintPanelProps) {
  const hasVariables = variables.length > 0;
  const hasReasoning = typeof reasoning === 'string' && reasoning.trim().length > 0;

  if (!hasVariables && !hasReasoning) {
    return null;
  }

  return (
    <div className="space-y-2">
      {hasVariables && (
        <Disclosure label="Что значат величины" icon={<ListChecks className="h-4 w-4" />}>
          <ul className="space-y-1.5">
            {variables.map((variable) => (
              <li
                key={variable.symbol}
                className="flex items-baseline gap-2 text-sm text-slate-700"
              >
                <MathText
                  text={`$${variable.symbol}$`}
                  as="span"
                  className="font-medium"
                />
                <span>
                  — {variable.name}
                  {variable.unit ? ` (${variable.unit})` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {hasReasoning && (
        <Disclosure label="Как рассуждать" icon={<Lightbulb className="h-4 w-4" />}>
          <MathText
            text={reasoning as string}
            as="p"
            className="text-sm leading-6 text-slate-700"
          />
        </Disclosure>
      )}
    </div>
  );
});
