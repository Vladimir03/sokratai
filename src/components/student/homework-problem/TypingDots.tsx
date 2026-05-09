/**
 * Three pulsing dots used inside the AI bubble while Сократ "thinks".
 * Pure CSS animation (no framer-motion — banned per
 * `.claude/rules/performance.md` rule 2).
 *
 * Animation `homework-typing-dot`: defined in `tailwind.config.ts` —
 * 1.2s infinite ease-in-out, opacity 0.3↔1 with translateY -3px at peak.
 * Each dot offsets 0.2s — staggered wave effect. Matches design CSS
 * `.ch-typing` rules from `design_handoff_homework_chat/student-chat.css`.
 */
export function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 py-1"
      role="status"
      aria-label="Сократ думает"
    >
      <span className="block h-[7px] w-[7px] rounded-full bg-socrat-primary opacity-40 animate-homework-typing-dot" />
      <span className="block h-[7px] w-[7px] rounded-full bg-socrat-primary opacity-40 animate-homework-typing-dot [animation-delay:0.2s]" />
      <span className="block h-[7px] w-[7px] rounded-full bg-socrat-primary opacity-40 animate-homework-typing-dot [animation-delay:0.4s]" />
    </span>
  );
}
