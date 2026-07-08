/**
 * Демо-разбор «как Сократ проверяет работу» (v2.1 W1) — модалка сдвига aha
 * влево. Две вкладки:
 *   A. «Пример» — курированный реальный разбор (мгновенно, ноль AI-вызова).
 *   B. «Своя задача» — live-разбор ad-hoc задачи+ответа репетитора на его
 *      контенте (reuse ядра грейдинга через homework-api /tutor/demo-check).
 * Обе рендерят результат теми же production-компонентами
 * (`PhysicsFlowchartTrace` / `CriteriaBreakdownTable`) → демо честное.
 *
 * Нейминг (rule 90): «разбор Сократа», без бан-словаря. Инпуты ≥16px (rule 80),
 * один primary-CTA. Палитра статуса emerald/amber/rose — waiver rule 90.
 */
import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CriteriaBreakdownTable from "@/components/homework/CriteriaBreakdownTable";
import PhysicsFlowchartTrace from "@/components/homework/PhysicsFlowchartTrace";
import { SUBJECTS, getSubjectLabel } from "@/types/homework";
import type {
  HomeworkAiCriteriaItem,
  HomeworkFlowchartTrace,
} from "@/types/homework";
import { getDemoCheckSample } from "@/lib/demoCheck/samples";
import { runDemoCheck, DemoCheckError } from "@/lib/demoCheckApi";

const MathText = lazy(() =>
  import("@/components/kb/ui/MathText").then((m) => ({ default: m.MathText })),
);

const VERDICT_META: Record<string, { label: string; badge: string }> = {
  CORRECT: { label: "Верно", badge: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  ON_TRACK: { label: "Почти — снят балл", badge: "bg-amber-100 text-amber-900 border-amber-200" },
  INCORRECT: { label: "Есть ошибки", badge: "bg-rose-100 text-rose-900 border-rose-200" },
};
const VERDICT_FALLBACK = { label: "Разбор", badge: "bg-slate-100 text-slate-700 border-slate-200" };

function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(/\.0$/, "");
}

/** Общий рендер результата разбора (используют и пример, и live). */
function GradedResult({
  verdict,
  score,
  maxScore,
  feedback,
  flowchartTrace,
  criteriaBreakdown,
}: {
  verdict: string;
  score: number | null;
  maxScore: number;
  feedback: string;
  flowchartTrace?: HomeworkFlowchartTrace | null;
  criteriaBreakdown?: HomeworkAiCriteriaItem[] | null;
}) {
  const meta = VERDICT_META[verdict] ?? VERDICT_FALLBACK;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${meta.badge}`}>
          {meta.label}
        </span>
        {score != null ? (
          <span className="text-sm font-semibold tabular-nums text-slate-900">
            Балл: {formatScore(score)}/{formatScore(maxScore)}
          </span>
        ) : null}
      </div>

      {flowchartTrace ? (
        <PhysicsFlowchartTrace trace={flowchartTrace} />
      ) : criteriaBreakdown && criteriaBreakdown.length > 0 ? (
        <CriteriaBreakdownTable criteria={criteriaBreakdown} />
      ) : null}

      {feedback ? (
        <section className="rounded-lg border border-accent/30 bg-accent/5 p-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
            Разбор от Сократ AI
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
            {feedback}
          </p>
        </section>
      ) : null}
    </div>
  );
}

interface DemoCheckSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: string | null;
}

export function DemoCheckSheet({ open, onOpenChange, subject }: DemoCheckSheetProps) {
  const navigate = useNavigate();
  const sample = getDemoCheckSample(subject);
  const [view, setView] = useState<"example" | "own">("example");

  // Live-форма «Своя задача» — дефолт из реального предмета репетитора (не из
  // образца, который пока только физика).
  const [ownSubject, setOwnSubject] = useState<string>(
    subject && SUBJECTS.some((s) => s.id === subject) ? subject : sample.subject,
  );
  const [examType, setExamType] = useState<"ege" | "oge">("ege");
  const [checkFormat, setCheckFormat] = useState<"short_answer" | "detailed_solution">(
    "detailed_solution",
  );
  const [taskText, setTaskText] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [kimText, setKimText] = useState("");
  const [maxScoreText, setMaxScoreText] = useState("");
  const [running, setRunning] = useState(false);
  const [ownError, setOwnError] = useState<string | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [ownResult, setOwnResult] = useState<Awaited<ReturnType<typeof runDemoCheck>> | null>(null);

  const isPhysics = ownSubject === "physics";
  const canRun = taskText.trim().length > 0 && answerText.trim().length > 0 && !running;

  const handleRun = async () => {
    if (!canRun) return;

    // Валидация опц. полей ДО запуска — без тихой коэрсии (демо не должно врать
    // про шкалу баллов: 2.5 не округляем, 101 не подменяем на 3; review P2).
    let kimNum: number | null = null;
    if (kimText.trim()) {
      const k = Number(kimText);
      if (!Number.isInteger(k) || k < 1 || k > 40) {
        setOwnError("№ КИМ — целое число от 1 до 40 (или оставьте пустым).");
        return;
      }
      kimNum = k;
    }
    let maxNum: number | null = null;
    if (maxScoreText.trim()) {
      const m = Number(maxScoreText);
      if (!Number.isInteger(m) || m < 1 || m > 100) {
        setOwnError("Макс. балл — целое число от 1 до 100 (или оставьте пустым).");
        return;
      }
      maxNum = m;
    }

    setRunning(true);
    setOwnError(null);
    setCapReached(false);
    setOwnResult(null);
    try {
      const res = await runDemoCheck({
        subject: ownSubject,
        exam_type: examType,
        task_text: taskText.trim(),
        answer_text: answerText.trim(),
        kim_number: kimNum,
        max_score: maxNum,
        check_format: checkFormat,
      });
      setOwnResult(res);
    } catch (e) {
      if (e instanceof DemoCheckError && e.code === "DEMO_LIMIT_REACHED") {
        // Лимит демо-разборов на сегодня исчерпан → предлагаем реальный флоу.
        setCapReached(true);
        setOwnError(e.message);
      } else {
        setOwnError(
          e instanceof DemoCheckError ? e.message : "Не удалось разобрать работу. Попробуйте ещё раз.",
        );
      }
    } finally {
      setRunning(false);
    }
  };

  const goCreateHomework = () => {
    onOpenChange(false);
    navigate("/tutor/homework/create");
  };
  const goTariff = () => {
    onOpenChange(false);
    navigate("/tutor/profile");
  };

  const tabClass = (active: boolean) =>
    `min-h-[36px] rounded-lg px-3 text-sm font-medium transition-colors ${
      active ? "bg-accent text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Как Сократ AI разбирает работу</DialogTitle>
          <DialogDescription>
            Реальный разбор ответа ученика — ровно то, что увидите вы и ученик после сдачи.
          </DialogDescription>
        </DialogHeader>

        <div
          role="group"
          aria-label="Выбор режима демо"
          className="flex gap-2"
        >
          <button
            type="button"
            className={tabClass(view === "example")}
            aria-pressed={view === "example"}
            style={{ touchAction: "manipulation" }}
            onClick={() => setView("example")}
          >
            Пример
          </button>
          <button
            type="button"
            className={tabClass(view === "own")}
            aria-pressed={view === "own"}
            style={{ touchAction: "manipulation" }}
            onClick={() => setView("own")}
          >
            Своя задача
          </button>
        </div>

        {view === "example" ? (
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {getSubjectLabel(sample.subject)} · {sample.examLabel}
            </p>
            <section className="rounded-lg border border-slate-200 bg-white p-3">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Условие
              </h3>
              <div className="text-sm leading-relaxed text-slate-900">
                <Suspense fallback={<span>{sample.taskText}</span>}>
                  <MathText text={sample.taskText} />
                </Suspense>
              </div>
            </section>
            <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ответ ученика
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {sample.studentAnswer}
              </p>
            </section>
            <GradedResult
              verdict={sample.verdict}
              score={sample.score}
              maxScore={sample.maxScore}
              feedback={sample.feedback}
              flowchartTrace={sample.flowchartTrace}
              criteriaBreakdown={sample.criteriaBreakdown}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Предмет</span>
                <select
                  value={ownSubject}
                  onChange={(e) => setOwnSubject(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-base"
                  style={{ touchAction: "manipulation" }}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Экзамен</span>
                <select
                  value={examType}
                  onChange={(e) => setExamType(e.target.value === "oge" ? "oge" : "ege")}
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-base"
                  style={{ touchAction: "manipulation" }}
                >
                  <option value="ege">ЕГЭ</option>
                  <option value="oge">ОГЭ</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Формат проверки</span>
              <select
                value={checkFormat}
                onChange={(e) =>
                  setCheckFormat(
                    e.target.value === "short_answer" ? "short_answer" : "detailed_solution",
                  )
                }
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-base"
                style={{ touchAction: "manipulation" }}
              >
                <option value="detailed_solution">Развёрнутое решение (по критериям)</option>
                <option value="short_answer">Краткий ответ (лайт-проверка)</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Условие задачи</span>
              <textarea
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                rows={3}
                placeholder="Вставьте условие задачи…"
                className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-base leading-relaxed"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Ответ ученика</span>
              <textarea
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                rows={4}
                placeholder="Вставьте решение/ответ ученика…"
                className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-base leading-relaxed"
              />
            </label>

            {/* Опц. № КИМ (физика Часть 2 № 21-26 → блок-схема ФИПИ) + Макс. балл
                шкалы предмета (общество № 25 = 4 и т.п.; дефолт 3). */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  {isPhysics ? "№ КИМ (для блок-схемы ФИПИ)" : "№ КИМ (необяз.)"}
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={40}
                  step={1}
                  value={kimText}
                  onChange={(e) => setKimText(e.target.value)}
                  placeholder={isPhysics ? "напр. 24" : "—"}
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-base"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Макс. балл (необяз.)
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  step={1}
                  value={maxScoreText}
                  onChange={(e) => setMaxScoreText(e.target.value)}
                  placeholder="напр. 3"
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-base"
                />
              </label>
            </div>

            {capReached ? (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-sm text-amber-900">{ownError}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={goCreateHomework}
                    style={{ touchAction: "manipulation" }}
                    className="min-h-[36px] rounded-lg bg-accent px-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
                  >
                    Собрать домашку ученику
                  </button>
                  <button
                    type="button"
                    onClick={goTariff}
                    style={{ touchAction: "manipulation" }}
                    className="min-h-[36px] rounded-lg border border-amber-300 bg-white px-3.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100"
                  >
                    Узнать про тариф
                  </button>
                </div>
              </div>
            ) : ownError ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {ownError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={handleRun}
              disabled={!canRun || capReached}
              style={{ touchAction: "manipulation" }}
              className="min-h-[40px] w-full rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {running ? "Разбираю работу…" : "Проверить работу"}
            </button>

            {ownResult ? (
              <div className="pt-1">
                <GradedResult
                  verdict={ownResult.verdict}
                  score={ownResult.flowchart_trace?.score ?? ownResult.ai_score}
                  maxScore={ownResult.max_score}
                  feedback={ownResult.feedback}
                  flowchartTrace={ownResult.flowchart_trace}
                  criteriaBreakdown={ownResult.criteria_breakdown}
                />
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default DemoCheckSheet;
