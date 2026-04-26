import { BookOpen, GraduationCap, ShieldCheck, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Pill = {
  Icon: LucideIcon;
  value: string;
  caption: string;
};

const PILLS: Pill[] = [
  { Icon: GraduationCap, value: "10 лет", caption: "опыта Егора Блинова" },
  { Icon: Trophy, value: "2×100", caption: "баллов ЕГЭ лично у Егора" },
  { Icon: BookOpen, value: "ФИПИ", caption: "привязка ко всему кодификатору" },
  { Icon: ShieldCheck, value: "14 дней", caption: "отмена без объяснений" },
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
