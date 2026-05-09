import sokratChatIcon from '@/assets/sokrat-chat-icon.png';

interface SokratAvatarProps {
  size?: number;
  className?: string;
}

/**
 * Brand avatar for the AI persona ("Сократ AI") on the homework problem
 * screen. Round emerald container with the chat icon centered, plus a
 * tiny green "online" dot bottom-right (per design handoff). Used inside
 * `ProblemChatMessage` for AI bubbles.
 *
 * Single source of truth for the AI avatar's exact visual treatment on
 * the new student-side homework chat. NOT shared with `UserAvatar`
 * (which is a generic avatar used elsewhere) — this is brand-specific.
 */
export function SokratAvatar({ size = 32, className }: SokratAvatarProps) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full bg-socrat-primary text-white shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
      aria-label="Сократ AI"
    >
      <img
        src={sokratChatIcon}
        alt=""
        aria-hidden="true"
        className="object-contain"
        style={{ width: size * 0.62, height: size * 0.62 }}
      />
      {/* Online indicator — small green dot bottom-right (per design CSS
          .ch-avatar::after: 9×9, bg #22C55E, white border 2px). */}
      <span
        className="absolute bottom-0 right-0 block rounded-full bg-emerald-500 ring-2 ring-white"
        style={{ width: 9, height: 9, transform: 'translate(15%, 15%)' }}
        aria-hidden="true"
      />
    </span>
  );
}
