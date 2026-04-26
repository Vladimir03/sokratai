import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface ProductTourBullet {
  title: string;
  body: string;
}

export interface ProductTourInlineCTA {
  label: string;
  href: string;
  onClick?: () => void;
}

export interface ProductTourBadge {
  Icon: LucideIcon;
  label: string;
}

export interface ProductTourProps {
  id: string;
  badge?: ProductTourBadge;
  headline: ReactNode;
  lede: string;
  bullets: ProductTourBullet[];
  inlineCTA?: ProductTourInlineCTA;
  videoPlaceholderText: string;
  videoPlaceholderCaption: string;
  videoSrc?: string;
  zigzag: "text-left" | "text-right";
  backgroundSurface?: boolean;
}
