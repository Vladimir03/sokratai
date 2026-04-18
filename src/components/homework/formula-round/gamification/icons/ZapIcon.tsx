import { memo, type SVGProps } from 'react';

function ZapIconComponent(props: SVGProps<SVGSVGElement>) {
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
      <path d="M18.3 2.5 6.5 17.2c-.6.7-.1 1.8.8 1.8h5.9l-3 9.7c-.3 1 1 1.7 1.6.9L24.6 15c.6-.7.1-1.8-.8-1.8h-5.9l2.9-9.8c.3-1-1-1.7-1.5-.9z" />
    </svg>
  );
}

export const ZapIcon = memo(ZapIconComponent);
