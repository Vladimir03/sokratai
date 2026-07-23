import { BookOpen, Clock, ShieldCheck, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Pill = {
  Icon: LucideIcon;
  value: string;
  caption: string;
};

// Пилюли синхронизированы с оффером V1 (landing-v2 GATE B):
// пруфы — Елена ×2 (группы с Сократом) и Егор ~10 ч/нед.
const PILLS: Pill[] = [
  { Icon: TrendingUp, value: "×2", caption: "учеников у Елены — за счёт групп с Сократом" },
  { Icon: Clock, value: "~10 ч", caption: "в неделю экономит Егор на проверке и учёте" },
  { Icon: BookOpen, value: "ФИПИ", caption: "проверка по критериям, весь кодификатор" },
  { Icon: ShieldCheck, value: "7 дней", caption: "бесплатно — карта не нужна" },
];

export default function TrustStrip() {
  return (
    <section
      aria-label="Доверительные признаки"
      className="py-10"
      style={{
        backgroundColor: "var(--sokrat-surface)",
        borderTop: "1px solid var(--sokrat-border-light)",
        borderBottom: "1px solid var(--sokrat-border-light)",
      }}
    >
      <ul className="mx-auto grid max-w-[1120px] grid-cols-2 items-center gap-x-3 gap-y-5 px-4 md:grid-cols-4 md:gap-8 md:px-8">
        {PILLS.map(({ Icon, value, caption }) => (
          <li key={value} className="flex items-center gap-3 md:gap-4 md:px-4">
            <Icon
              aria-hidden="true"
              className="shrink-0 h-5 w-5 md:h-6 md:w-6"
              style={{ color: "var(--sokrat-green-700)" }}
            />
            <div className="flex flex-col gap-[2px] leading-tight">
              <span
                className="text-base md:text-[20px] font-bold leading-[1.1]"
                style={{ color: "var(--sokrat-fg1)" }}
              >
                {value}
              </span>
              <span
                className="text-[12px] md:text-[13px] leading-[1.3]"
                style={{ color: "var(--sokrat-fg3)" }}
              >
                {caption}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
