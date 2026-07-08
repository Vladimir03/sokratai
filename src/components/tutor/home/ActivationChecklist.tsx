/**
 * Гид первого запуска «Соберите первую домашку — 3 шага» на /tutor/home
 * (v2.1 W2). Ведёт нового репетитора к каноническому aha пилота (собрал+отправил
 * первое ДЗ, doc 18) + несёт демо-хук сверху (сдвиг aha влево, W1).
 *
 * Прогресс ДЕРИВИТСЯ из реальных данных (self-healing, cross-device):
 *   1. Заведите ученика   — students.length > 0
 *   2. Соберите домашку    — есть ≥1 assignment
 *   3. Отправьте ученику   — есть assignment с assigned_count > 0
 * Авто-скрывается когда все 3 сделаны. «Скрыть» — per-browser localStorage
 * (mirror SubjectsNudgeBanner; completion всё равно data-derived).
 *
 * P14: НЕ блокирует, dismissible, не 5-шаговый визард. Один primary-CTA (первый
 * незакрытый шаг). Lucide без эмодзи (rule 90).
 */
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useTutorHomeworkAssignments } from "@/hooks/useTutorHomework";
import { DemoCheckCard } from "@/components/tutor/home/DemoCheckCard";
import { supabase } from "@/lib/supabaseClient";

const DISMISS_KEY = "sokrat-activation-checklist-dismissed";

// ВРЕМЕННЫЙ тест-allowlist: для этих email чеклист+демо показываются ВСЕГДА
// (в обход dismiss/allDone), чтобы уже-активированные репетиторы/модераторы могли
// протестировать онбординг. Удалить после теста. (Запрос Vladimir 2026-07-08.)
const DEMO_TEST_EMAILS = new Set(
  [
    "volodyakamchatkin@gmail.com",
    "kamchatkinvova@gmail.com",
    "egor.o.blinov@gmail.com",
    "milada.met@yandex.ru",
  ].map((e) => e.toLowerCase()),
);

interface ActivationChecklistProps {
  hasStudents: boolean;
  /** Предмет репетитора → образец демо (fallback физика). */
  subject?: string | null;
  onAddStudent: () => void;
  onAssignHomework: () => void;
}

interface Step {
  done: boolean;
  title: string;
  sub: string;
  cta: string;
  action: () => void;
}

export function ActivationChecklist({
  hasStudents,
  subject,
  onAddStudent,
  onAssignHomework,
}: ActivationChecklistProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Тест-allowlist (временно): показываем онбординг даже активированным.
  const [forceShow, setForceShow] = useState(false);
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email?.toLowerCase();
      if (active && email && DEMO_TEST_EMAILS.has(email)) setForceShow(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Шаги 2–3 деривятся из списка ДЗ (общий кэш с /tutor/homework — дёшево).
  // ВНИМАНИЕ: хук возвращает { assignments, loading }, НЕ { data, isLoading }
  // (custom shape, как др. tutor-хуки). Иначе шаги 2/3 всегда false и чеклист
  // висит у активного репетитора (review P1 2026-07-08).
  const { assignments, loading: isLoading } = useTutorHomeworkAssignments({ filter: "all" });
  const hasHomework = assignments.length > 0;
  const hasSent = assignments.some((a) => (a.assigned_count ?? 0) > 0);

  const steps: Step[] = [
    {
      done: hasStudents,
      title: "Заведите ученика",
      sub: "По имени — контакт не обязателен",
      cta: "Добавить ученика",
      action: onAddStudent,
    },
    {
      done: hasHomework,
      title: "Соберите домашку",
      sub: "Из базы задач или по теме",
      cta: "Собрать ДЗ",
      action: onAssignHomework,
    },
    {
      done: hasSent,
      title: "Отправьте ученику",
      sub: "Ученик откроет её по ссылке",
      cta: "Собрать и отправить",
      action: onAssignHomework,
    },
  ];

  const allDone = steps.every((s) => s.done);
  const firstIncomplete = steps.findIndex((s) => !s.done);
  // Не мигать онбордингом у состоявшегося репетитора, пока грузится список ДЗ.
  const holdForData = hasStudents && isLoading;

  // Тест-allowlist в обход всех гейтов; иначе обычная логика.
  if (!forceShow && (dismissed || allDone || holdForData)) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  return (
    <>
      <DemoCheckCard subject={subject} />

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Соберите первую домашку — 3 шага
            </h2>
            <p className="text-sm text-slate-500">
              Ученик решает с подсказками, Сократ проверяет — вы экономите вечер.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Скрыть подсказку"
            title="Скрыть"
            style={{ touchAction: "manipulation" }}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <ol className="space-y-2.5">
          {steps.map((step, i) => {
            const isPrimary = i === firstIncomplete;
            return (
              <li key={step.title} className="flex items-center gap-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    step.done
                      ? "bg-emerald-100 text-emerald-700"
                      : "border border-slate-300 text-slate-500"
                  }`}
                  aria-hidden="true"
                >
                  {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${
                      step.done ? "text-slate-400 line-through" : "text-slate-900"
                    }`}
                  >
                    {step.title}
                  </span>
                  {!step.done ? (
                    <span className="block text-xs text-slate-500">{step.sub}</span>
                  ) : null}
                </span>
                {isPrimary ? (
                  <button
                    type="button"
                    onClick={step.action}
                    style={{ touchAction: "manipulation" }}
                    className="min-h-[36px] shrink-0 rounded-lg bg-accent px-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {step.cta}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

export default ActivationChecklist;
