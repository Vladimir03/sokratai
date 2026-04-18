import { memo, type SVGProps } from 'react';

function FlameIconComponent(props: SVGProps<SVGSVGElement>) {
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
      <path d="M16 2.5c.7 4.2 3 6.2 5 8.4 2.2 2.3 4.1 4.7 4.1 8.3a9.1 9.1 0 1 1-18.2 0c0-2.3.9-4 2.2-5.5.6-.7 1.7-.3 1.8.6.2 1.5.9 2.6 2 2.6 1.4 0 2.2-1 2.2-3 0-2.8-1-5.4-1-7.5 0-2 .9-3.4 1.9-3.9z" />
      <path
        d="M15.5 17c.6 2.5 2.3 3.6 2.3 5.7 0 1.8-1.2 3.2-3 3.2s-3.1-1.3-3.1-3.1c0-1.4.6-2.2 1.3-3 .3-.3.8-.1.9.3.1.6.5 1 .9 1 .6 0 .9-.4.9-1.2 0-1 .1-2 .4-2.7.2-.3.4-.4.4-.2z"
        fill="currentColor"
        fillOpacity={0.25}
      />
    </svg>
  );
}

export const FlameIcon = memo(FlameIconComponent);
