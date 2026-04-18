import { memo, type SVGProps } from 'react';

function TrophyIconComponent(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 4h14v2.5h3.5a2.5 2.5 0 0 1 2.5 2.5v2.2a5.5 5.5 0 0 1-5.5 5.5h-.4a8 8 0 0 1-5.1 5.1V24h3.5a1 1 0 0 1 1 1v2H9v-2a1 1 0 0 1 1-1h3.5v-2.2a8 8 0 0 1-5.1-5.1H8A5.5 5.5 0 0 1 2.5 11.2V9A2.5 2.5 0 0 1 5 6.5h4zm0 4.5H5V11a3 3 0 0 0 3 3h.6A8 8 0 0 1 9 12zm14 0V12a8 8 0 0 1-.4 2h.6a3 3 0 0 0 3-3V8.5z" />
    </svg>
  );
}

export const TrophyIcon = memo(TrophyIconComponent);
