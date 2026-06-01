import type { SVGProps } from 'react';

export interface SokratBearIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number;
}

/**
 * Сократ-мишка — тёплый брендовый акцент для события «Нужна помощь» (kind='stuck')
 * в ленте «Последние действия учеников» на /tutor/home.
 *
 * Своя line-art иконка в стиле lucide (НЕ кадр из мультфильма — без копирайта;
 * НЕ эмодзи — consistent с rule 90, которое прописывает иконки вместо эмодзи).
 * `stroke="currentColor"` → наследует цвет чипа (янтарный `t-chip--warning`),
 * `size`-проп совместим с lucide, чтобы рендериться единообразно рядом с ними.
 *
 * Метафора: «застрял» = Винни застрял в норе. Цель — лёгкая тёплая улыбка
 * и привязка к Сократу, а не тревога (см. spec §8, round 3).
 */
export function SokratBearIcon({ size = 12, ...props }: SokratBearIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* ears */}
      <circle cx="6.5" cy="7" r="2.5" />
      <circle cx="17.5" cy="7" r="2.5" />
      {/* head */}
      <circle cx="12" cy="13.5" r="7" />
      {/* eyes (round dots via linecap) */}
      <path d="M10 12h.01" />
      <path d="M14 12h.01" />
      {/* nose */}
      <path d="M12 15h.01" />
    </svg>
  );
}
