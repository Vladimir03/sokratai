import { Link } from "react-router-dom";

export default function AudienceRibbon() {
  return (
    <div
      role="complementary"
      aria-label="Переключатель аудитории"
      style={{
        backgroundColor: "var(--sokrat-green-50)",
        borderBottom: "1px solid var(--sokrat-green-100)",
      }}
    >
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2.5 text-[12px] leading-snug sm:text-[13px] md:px-8">
        <span style={{ color: "var(--sokrat-fg2)" }}>
          Вы ученик или родитель?
        </span>
        <Link
          to="/students"
          className="inline-flex items-center gap-1 font-semibold transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 rounded-sm"
          style={{ color: "var(--sokrat-green-800)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--sokrat-green-700)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--sokrat-green-800)";
          }}
        >
          Перейти на страницу для школьников →
        </Link>
      </div>
    </div>
  );
}
