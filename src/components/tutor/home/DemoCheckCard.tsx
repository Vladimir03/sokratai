/**
 * Хук-карта «Посмотрите, как Сократ разбирает работу» на /tutor/home (v2.1 W1).
 * Сдвиг aha влево: репетитор видит ценность проверки за 30 секунд — до
 * подключения учеников (сегодня проверку не увидеть без реального ученика +
 * сдачи). Открывает DemoCheckSheet.
 *
 * Не блокирует (P14), один primary-CTA (rule 90), Lucide без эмодзи.
 * Нейминг без бан-словаря: «разбор Сократа», не «AI-проверка».
 */
import { lazy, Suspense, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { logDemoCheckViewed } from "@/lib/demoCheckApi";
import { markDemoSeen } from "@/lib/demoSeen";

const DemoCheckSheet = lazy(() =>
  import("@/components/tutor/demo-check/DemoCheckSheet").then((m) => ({
    default: m.DemoCheckSheet,
  })),
);

interface DemoCheckCardProps {
  /** Предмет репетитора → выбор образца (fallback физика). */
  subject?: string | null;
}

export function DemoCheckCard({ subject }: DemoCheckCardProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    logDemoCheckViewed(); // funnel: tutor_demo_check_viewed (fire-and-forget)
    markDemoSeen(); // «вау» состоялось → открываем community-CTA (CommunityJoinCard)
    setOpen(true);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
            aria-hidden="true"
          >
            <ClipboardCheck className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">
              Посмотрите, как Сократ AI разбирает работу
            </span>
            <span className="block text-sm text-slate-600">
              Реальный разбор за 30 секунд — ещё до подключения учеников
            </span>
          </span>
        </div>
        {/* Secondary (outline) — один filled primary на экране = шаг чеклиста
            (rule 90). Демо-карта остаётся заметной за счёт accent-фона/иконки. */}
        <button
          type="button"
          onClick={handleOpen}
          style={{ touchAction: "manipulation" }}
          className="min-h-[36px] shrink-0 rounded-lg border border-accent bg-white px-3.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Посмотреть разбор
        </button>
      </div>

      {open && (
        <Suspense fallback={null}>
          <DemoCheckSheet open={open} onOpenChange={setOpen} subject={subject} />
        </Suspense>
      )}
    </>
  );
}

export default DemoCheckCard;
