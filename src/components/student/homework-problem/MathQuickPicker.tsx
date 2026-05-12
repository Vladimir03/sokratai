import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Math symbol picker — tablet/desktop Phase 3 (2026-05-12).
 *
 * Opens via «Σ Формула» chip in `ChatChipRow`; inserts a LaTeX/Unicode
 * snippet into the last-focused composer input or textarea **in the
 * right-column chat composer**. Focus tracking is implemented via
 * `onFocusCapture` on the right-column `<section>` in `HomeworkProblem`,
 * so inputs rendered through React portals (e.g. `SubmitSheet` Dialog)
 * are NOT tracked — by design for Phase 3, the picker trigger only lives
 * inside the chat chip-row and SubmitSheet has no math button. Adding
 * picker support inside SubmitSheet would require either lifting focus
 * tracking to the root or wiring a separate ref handler there.
 *
 * Design ref: `docs/design_handoff_homework_chat/README.md` §«Открывает
 * math-keyboard / KaTeX inline editor для вставки формулы в инпут».
 * Phase 3 scope decision (Round 3): basic popover with ~15 LaTeX/Unicode
 * templates — MathLive integration is out of scope (Open Question 1).
 */

interface MathQuickPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element that triggers the popover — must be a stable element. */
  trigger: React.ReactNode;
  /**
   * Insert a snippet at the current cursor position in the last-focused
   * textarea / input. Parent tracks the focused element ref through
   * `onFocus` and dispatches the actual `setRangeText` + `input` event
   * (Safari needs the manual dispatch to propagate to React state).
   */
  insertAtCursor: (snippet: string) => void;
}

interface MathTemplate {
  /** Label shown on the chip. Plain string — rendered without KaTeX
   *  inside the popover so the picker stays light (no MathText lazy load). */
  label: string;
  /** Snippet inserted at cursor. May be plain Unicode (α) or LaTeX
   *  (`\frac{a}{b}`). Caller's textarea consumers downstream render via
   *  KaTeX (chat bubble, SubmitSheet preview) — no double-encoding. */
  snippet: string;
}

const TEMPLATES: MathTemplate[] = [
  { label: 'x²', snippet: '^2' },
  { label: 'x³', snippet: '^3' },
  { label: 'xⁿ', snippet: '^{}' },
  { label: '√', snippet: '\\sqrt{}' },
  { label: '∛', snippet: '\\sqrt[3]{}' },
  { label: 'a/b', snippet: '\\frac{}{}' },
  { label: 'α', snippet: 'α' },
  { label: 'β', snippet: 'β' },
  { label: 'γ', snippet: 'γ' },
  { label: 'π', snippet: 'π' },
  { label: 'ω', snippet: 'ω' },
  { label: 'Δ', snippet: 'Δ' },
  { label: 'μ', snippet: 'μ' },
  { label: 'σ', snippet: 'σ' },
  { label: '±', snippet: '±' },
  { label: '≈', snippet: '≈' },
  { label: '→', snippet: '→' },
  { label: '≤', snippet: '≤' },
];

export function MathQuickPicker({
  open,
  onOpenChange,
  trigger,
  insertAtCursor,
}: MathQuickPickerProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-auto p-3"
        // Don't auto-focus into the popover — keep textarea focus so cursor
        // position stays. Without this Radix steals focus and the snippet
        // gets inserted at position 0 instead of cursor.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="grid grid-cols-6 gap-1.5" role="grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                insertAtCursor(t.snippet);
                onOpenChange(false);
              }}
              aria-label={`Вставить ${t.label}`}
              className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-socrat-border-light bg-white hover:bg-socrat-surface hover:border-socrat-border text-sm font-semibold text-slate-800 transition-colors touch-manipulation"
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500 leading-snug">
          Символ вставится в место курсора.
        </p>
      </PopoverContent>
    </Popover>
  );
}
