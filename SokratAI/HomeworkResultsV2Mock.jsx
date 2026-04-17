// HomeworkResultsV2Mock.jsx
// Мок целевого экрана TutorHomeworkResults v2 для пилота.
//
// Стек: React + Tailwind + lucide-react. Соответствует дизайн-системе Сократа
// (.claude/rules/90-design-system.md). Все цвета — из канонической палитры,
// прописаны как arbitrary values (bg-[#1B6B4A]), чтобы мок открывался и
// без подключения tailwind.config.ts. При интеграции в проект заменить на
// токены: bg-accent / text-accent / bg-socrat-surface и т.д.
//
// Состояние данных: A (см. брейнсторм). В БД сегодня лежит только CORRECT/INCORRECT,
// частичные баллы — целевая модель, в моке заведены как fake-данные.
// AI-комментарии к ошибкам — НЕ генерация на лету, а зашитые строки.

import React, { useState, useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Lightbulb,
  Send,
  PartyPopper,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
  Pencil,
  Clock,
  Users,
  TrendingUp,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────────
// Fake data
// ──────────────────────────────────────────────────────────────────────────────

const TASKS = [
  { id: "t1", order: 1, kim: 1,  max: 1, format: "short_answer",      title: "Равноускоренное движение, путь" },
  { id: "t2", order: 2, kim: 2,  max: 1, format: "short_answer",      title: "Второй закон Ньютона" },
  { id: "t3", order: 3, kim: 3,  max: 1, format: "short_answer",      title: "Импульс тела" },
  { id: "t4", order: 4, kim: 4,  max: 1, format: "short_answer",      title: "Работа силы тяжести" },
  { id: "t5", order: 5, kim: 5,  max: 1, format: "short_answer",      title: "Период колебаний пружинного маятника" },
  { id: "t6", order: 6, kim: 7,  max: 1, format: "short_answer",      title: "Закон сохранения энергии: тело на наклонной" },
  { id: "t7", order: 7, kim: 21, max: 2, format: "detailed_solution", title: "Качественная задача: торможение" },
  { id: "t8", order: 8, kim: 24, max: 3, format: "detailed_solution", title: "Расчётная задача: брусок и пружина" },
];
const TOTAL_MAX = TASKS.reduce((s, t) => s + t.max, 0); // 11

// score: число (баллы) | null (не приступал)
// hints: использовано подсказок | 0
// attempts: попыток
// comment: что сказал AI / репетитор (короткая строка). Для перфектных — null.
const STUDENTS = [
  {
    id: "s1",
    name: "Артём Иванов",
    submittedAt: null, // не сдавал
    timeMin: 0,
    tasks: {
      t1: { score: null, hints: 0, attempts: 0 },
      t2: { score: null, hints: 0, attempts: 0 },
      t3: { score: null, hints: 0, attempts: 0 },
      t4: { score: null, hints: 0, attempts: 0 },
      t5: { score: null, hints: 0, attempts: 0 },
      t6: { score: null, hints: 0, attempts: 0 },
      t7: { score: null, hints: 0, attempts: 0 },
      t8: { score: null, hints: 0, attempts: 0 },
    },
  },
  {
    id: "s2",
    name: "Маша Соколова",
    submittedAt: "вс, 21:14",
    timeMin: 64,
    tasks: {
      t1: { score: 1, hints: 0, attempts: 1 },
      t2: { score: 1, hints: 1, attempts: 2 },
      t3: { score: 1, hints: 0, attempts: 1 },
      t4: { score: 1, hints: 2, attempts: 2 },
      t5: { score: 1, hints: 1, attempts: 2 },
      t6: { score: 0, hints: 2, attempts: 3, comment: "Перепутала знак работы силы трения." },
      t7: { score: 2, hints: 1, attempts: 2 },
      t8: { score: 2, hints: 1, attempts: 2, comment: "Верный ход решения, потерян множитель ½ в кинетической энергии." },
    },
  },
  {
    id: "s3",
    name: "Костя Лебедев",
    submittedAt: "сб, 23:02",
    timeMin: 31,
    tasks: {
      t1: { score: 1, hints: 0, attempts: 1 },
      t2: { score: 1, hints: 0, attempts: 1 },
      t3: { score: 1, hints: 0, attempts: 1 },
      t4: { score: 1, hints: 0, attempts: 1 },
      t5: { score: 1, hints: 0, attempts: 1 },
      t6: { score: 1, hints: 0, attempts: 1 },
      t7: { score: 2, hints: 0, attempts: 1 },
      t8: { score: 3, hints: 0, attempts: 1 },
    },
  },
  {
    id: "s4",
    name: "Лена Морозова",
    submittedAt: "вс, 18:40",
    timeMin: 47,
    tasks: {
      t1: { score: 1, hints: 0, attempts: 1 },
      t2: { score: 1, hints: 0, attempts: 1 },
      t3: { score: 0, hints: 1, attempts: 2, comment: "Импульс посчитан без учёта направления." },
      t4: { score: 1, hints: 1, attempts: 2 },
      t5: { score: 1, hints: 0, attempts: 1 },
      t6: { score: 0, hints: 3, attempts: 3, comment: "Не хватило закона сохранения энергии." },
      t7: { score: 1, hints: 1, attempts: 2, comment: "Объяснение неполное: нет ссылки на 2-й закон Ньютона." },
      t8: { score: 2, hints: 2, attempts: 2 },
    },
  },
  {
    id: "s5",
    name: "Дима Орлов",
    submittedAt: "вс, 22:55",
    timeMin: 52,
    tasks: {
      t1: { score: 1, hints: 1, attempts: 2 },
      t2: { score: 0, hints: 2, attempts: 3, comment: "Сила трения учтена с неверным знаком." },
      t3: { score: 0, hints: 2, attempts: 3, comment: "Не учтено направление импульсов." },
      t4: { score: 1, hints: 1, attempts: 2 },
      t5: { score: 0, hints: 1, attempts: 2, comment: "Перепутана формула периода." },
      t6: { score: 0, hints: 3, attempts: 3, comment: "Энергетический подход не применён." },
      t7: { score: 1, hints: 2, attempts: 2 },
      t8: { score: 1, hints: 2, attempts: 2, comment: "Записаны только формулы, нет численного ответа." },
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const PALETTE = {
  accent:       "#1B6B4A", // bg-accent
  accentLight:  "#DCFCE7",
  warning:      "#F59E0B",
  warningLight: "#FEF3C7",
  danger:       "#EF4444",
  dangerLight:  "#FEE2E2",
  text1:        "#0F172A",
  text2:        "#64748B",
  border:       "#E2E8F0",
  surface:      "#FFFFFF",
  bg:           "#F8FAFC",
  warmHover:    "#F7F6F3",
  slate900:     "#0F172A",
};

function cellColor(score, max) {
  if (score === null) return { bg: "#F1F5F9", border: "#E2E8F0", text: "#94A3B8" }; // not started
  const ratio = score / max;
  if (ratio >= 0.8)  return { bg: "#DCFCE7", border: "#86EFAC", text: "#14532D" };
  if (ratio >= 0.3)  return { bg: "#FEF3C7", border: "#FCD34D", text: "#78350F" };
  return                  { bg: "#FEE2E2", border: "#FCA5A5", text: "#7F1D1D" };
}

function studentTotals(student) {
  const entries = TASKS.map((t) => student.tasks[t.id]);
  const score = entries.reduce((s, e) => s + (e.score ?? 0), 0);
  const hints = entries.reduce((s, e) => s + (e.hints ?? 0), 0);
  const submitted = entries.some((e) => e.score !== null);
  return { score, hints, submitted };
}

function taskTotals(task) {
  const submitted = STUDENTS.filter((s) => s.tasks[task.id].score !== null);
  if (submitted.length === 0) return { avg: 0, solvedCount: 0, total: 0 };
  const sumScore = submitted.reduce((s, st) => s + st.tasks[task.id].score, 0);
  const solvedCount = submitted.filter((st) => st.tasks[task.id].score / task.max >= 0.8).length;
  return {
    avg: sumScore / submitted.length,
    solvedCount,
    total: submitted.length,
  };
}

function formatScoreCell(score, max) {
  if (score === null) return "—";
  return `${score}/${max}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

export default function HomeworkResultsV2Mock() {
  const [expandedStudentId, setExpandedStudentId] = useState("s4"); // Лена раскрыта по умолчанию для демо

  const summary = useMemo(() => {
    const submittedStudents = STUDENTS.filter((s) => studentTotals(s).submitted);
    const totalScore = submittedStudents.reduce((s, st) => s + studentTotals(st).score, 0);
    const totalTime  = submittedStudents.reduce((s, st) => s + st.timeMin, 0);
    const totalHints = submittedStudents.reduce((s, st) => s + studentTotals(st).hints, 0);
    return {
      submitted: submittedStudents.length,
      total: STUDENTS.length,
      avgScore: submittedStudents.length ? totalScore / submittedStudents.length : 0,
      avgTime:  submittedStudents.length ? Math.round(totalTime / submittedStudents.length) : 0,
      avgHints: submittedStudents.length ? (totalHints / submittedStudents.length).toFixed(1) : "0",
      notStarted: STUDENTS.length - submittedStudents.length,
    };
  }, []);

  // Action items — детерминированно, не AI
  const actions = useMemo(() => {
    const items = [];

    // 1. Не приступали
    STUDENTS.forEach((s) => {
      if (!studentTotals(s).submitted) {
        items.push({ kind: "danger", text: `${s.name} — не приступал к ДЗ`, cta: "Напомнить в Telegram", icon: Send });
      }
    });

    // 2. Задачи, проваленные большинством
    TASKS.forEach((t) => {
      const tt = taskTotals(t);
      if (tt.total >= 3 && tt.solvedCount / tt.total <= 0.25) {
        items.push({
          kind: "warning",
          text: `Задача №${t.order} (КИМ ${t.kim}) — решили только ${tt.solvedCount} из ${tt.total}`,
          cta: "Разобрать на следующем занятии",
          icon: AlertTriangle,
        });
      }
    });

    // 3. Решил много, но с большим числом подсказок
    STUDENTS.forEach((s) => {
      const t = studentTotals(s);
      if (t.submitted && t.score / TOTAL_MAX >= 0.75 && t.hints >= 5) {
        items.push({
          kind: "warning",
          text: `${s.name} — ${t.score}/${TOTAL_MAX}, но ${t.hints} подсказок`,
          cta: "Открыть переписку",
          icon: MessageSquareText,
        });
      }
    });

    // 4. Идеально без подсказок
    STUDENTS.forEach((s) => {
      const t = studentTotals(s);
      if (t.submitted && t.score === TOTAL_MAX && t.hints === 0) {
        items.push({
          kind: "success",
          text: `${s.name} — ${TOTAL_MAX}/${TOTAL_MAX} без подсказок`,
          cta: "Похвалить в Telegram",
          icon: PartyPopper,
        });
      }
    });

    return items;
  }, []);

  return (
    <div
      className="min-h-screen bg-[#F8FAFC] p-4 md:p-8"
      style={{ fontFamily: "'Golos Text', system-ui, -apple-system, sans-serif" }}
    >
      <div className="max-w-6xl mx-auto">
        {/* Заголовок ДЗ */}
        <div className="mb-2 text-sm text-[#64748B]">
          <span className="cursor-pointer hover:text-[#0F172A]">Домашние задания</span>
          <span className="mx-1">/</span>
          <span>Кинематика, вариант 1</span>
        </div>
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-1">Кинематика, вариант 1</h1>
        <div className="text-sm text-[#64748B] mb-6">Физика · 8 задач · дедлайн: вс, 23:59 · группа из 5 учеников</div>

        {/* Блок 1: шапка-сводка */}
        <SummaryHeader summary={summary} />

        {/* Блок 3: требует внимания */}
        <ActionBlock actions={actions} />

        {/* Блок 2: хитмап */}
        <Heatmap
          expandedStudentId={expandedStudentId}
          setExpandedStudentId={setExpandedStudentId}
        />

        {/* Footer hint */}
        <div className="mt-6 text-xs text-[#94A3B8] text-center">
          Мок целевого UI · данные fake · дизайн-система Сократа
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Summary header (Блок 1)
// ──────────────────────────────────────────────────────────────────────────────

function SummaryHeader({ summary }) {
  const avgPct = Math.round((summary.avgScore / TOTAL_MAX) * 100);
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 md:p-5 mb-4">
      <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
        <Metric icon={Users} label="Сдали" value={`${summary.submitted} из ${summary.total}`} />
        <Metric
          icon={TrendingUp}
          label="Средний балл"
          value={`${summary.avgScore.toFixed(1)} / ${TOTAL_MAX}`}
          accent={`${avgPct}%`}
        />
        <Metric icon={Clock} label="Среднее время" value={`${summary.avgTime} мин`} />
        <Metric icon={Lightbulb} label="Подсказок на ученика" value={summary.avgHints} />
        {summary.notStarted > 0 && (
          <div className="flex items-center gap-2 text-[#7F1D1D] bg-[#FEE2E2] border border-[#FCA5A5] rounded-md px-3 py-1">
            <AlertTriangle className="w-4 h-4" />
            <span className="font-medium">{summary.notStarted} не приступал{summary.notStarted === 1 ? "" : "и"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-[#64748B]" />
      <span className="text-[#64748B]">{label}:</span>
      <span className="font-semibold text-[#0F172A]">{value}</span>
      {accent && <span className="text-[#1B6B4A] font-medium">({accent})</span>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Action block (Блок 3)
// ──────────────────────────────────────────────────────────────────────────────

function ActionBlock({ actions }) {
  if (!actions.length) return null;

  const styles = {
    danger:  { bg: "#FEE2E2", border: "#FCA5A5", text: "#7F1D1D", iconBg: "#FCA5A5" },
    warning: { bg: "#FEF3C7", border: "#FCD34D", text: "#78350F", iconBg: "#FCD34D" },
    success: { bg: "#DCFCE7", border: "#86EFAC", text: "#14532D", iconBg: "#86EFAC" },
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg p-4 md:p-5 mb-4">
      <div className="text-sm font-semibold text-[#0F172A] mb-3">Требует внимания</div>
      <div className="flex flex-col gap-2">
        {actions.map((a, i) => {
          const s = styles[a.kind];
          const Icon = a.icon;
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              style={{ background: s.bg, borderColor: s.border }}
            >
              <div className="flex items-center gap-2 text-sm" style={{ color: s.text }}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{a.text}</span>
              </div>
              <button
                className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border whitespace-nowrap hover:bg-[#F7F6F3] transition-colors"
                style={{ borderColor: s.border, color: s.text }}
              >
                {a.cta}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Heatmap (Блок 2 + drill-down Блок 4)
// ──────────────────────────────────────────────────────────────────────────────

function Heatmap({ expandedStudentId, setExpandedStudentId }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E2E8F0] text-sm font-semibold text-[#0F172A]">
        Результаты по ученикам и задачам
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#F8FAFC] text-[#64748B]">
              <th className="text-left font-medium px-4 py-3 sticky left-0 bg-[#F8FAFC] z-10 min-w-[180px]">
                Ученик
              </th>
              {TASKS.map((t) => (
                <th key={t.id} className="font-medium px-2 py-3 text-center min-w-[56px]">
                  <div className="text-[#0F172A] font-semibold">№{t.order}</div>
                  <div className="text-[10px] text-[#64748B]">КИМ {t.kim}</div>
                </th>
              ))}
              <th className="font-medium px-3 py-3 text-right min-w-[80px]">Балл</th>
              <th className="font-medium px-3 py-3 text-right min-w-[60px]">
                <Lightbulb className="w-3.5 h-3.5 inline" />
              </th>
              <th className="font-medium px-3 py-3 text-right min-w-[70px]">Время</th>
            </tr>
          </thead>
          <tbody>
            {STUDENTS.map((student) => {
              const totals = studentTotals(student);
              const isExpanded = expandedStudentId === student.id;
              return (
                <React.Fragment key={student.id}>
                  <tr
                    className={`border-t border-[#E2E8F0] cursor-pointer transition-colors ${
                      isExpanded ? "bg-[#F7F6F3]" : "hover:bg-[#F7F6F3]"
                    }`}
                    onClick={() => setExpandedStudentId(isExpanded ? null : student.id)}
                  >
                    <td className="px-4 py-3 sticky left-0 bg-inherit z-10">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-[#64748B]" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-[#64748B]" />
                        )}
                        <div>
                          <div className="font-medium text-[#0F172A]">{student.name}</div>
                          <div className="text-[11px] text-[#64748B]">
                            {totals.submitted ? `Сдал ${student.submittedAt}` : "Не приступал"}
                          </div>
                        </div>
                      </div>
                    </td>
                    {TASKS.map((t) => {
                      const cell = student.tasks[t.id];
                      return (
                        <td key={t.id} className="px-1 py-2 text-center">
                          <ScoreCell score={cell.score} max={t.max} hints={cell.hints} />
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-right font-semibold text-[#0F172A]">
                      {totals.submitted ? `${totals.score}/${TOTAL_MAX}` : "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-[#64748B]">
                      {totals.submitted ? totals.hints : "—"}
                    </td>
                    <td className="px-3 py-3 text-right text-[#64748B]">
                      {totals.submitted ? `${student.timeMin} мин` : "—"}
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-[#F7F6F3] border-t border-[#E2E8F0]">
                      <td colSpan={TASKS.length + 4} className="px-4 py-4">
                        <StudentDrillDown student={student} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* Итог по задачам */}
            <tr className="border-t-2 border-[#E2E8F0] bg-[#F8FAFC] text-[11px] text-[#64748B]">
              <td className="px-4 py-3 sticky left-0 bg-[#F8FAFC] font-medium">Среднее по задаче</td>
              {TASKS.map((t) => {
                const tt = taskTotals(t);
                const ratio = tt.total ? tt.avg / t.max : 0;
                const danger = tt.total >= 3 && ratio < 0.4;
                return (
                  <td key={t.id} className="px-2 py-3 text-center">
                    <div className={`font-semibold ${danger ? "text-[#7F1D1D]" : "text-[#0F172A]"}`}>
                      {tt.avg.toFixed(1)}/{t.max}
                    </div>
                    <div className="text-[10px]">
                      {tt.solvedCount}/{tt.total}
                    </div>
                  </td>
                );
              })}
              <td colSpan={3}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScoreCell({ score, max, hints }) {
  const c = cellColor(score, max);
  const display = formatScoreCell(score, max);
  return (
    <div
      className="relative inline-flex items-center justify-center w-12 h-10 rounded-md border text-sm font-semibold"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}
      title={
        score === null
          ? "Не приступал"
          : `Балл: ${score}/${max}${hints ? ` · подсказок: ${hints}` : ""}`
      }
    >
      {display}
      {hints > 0 && (
        <span
          className="absolute top-0.5 right-0.5 flex items-center justify-center"
          title={`Подсказок: ${hints}`}
        >
          <Lightbulb className="w-2.5 h-2.5" style={{ color: "#B45309" }} fill="#F59E0B" />
          {hints >= 3 && (
            <span className="text-[8px] font-bold ml-px" style={{ color: "#B45309" }}>
              {hints}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Drill-down (Блок 4)
// ──────────────────────────────────────────────────────────────────────────────

function StudentDrillDown({ student }) {
  const [selectedTaskId, setSelectedTaskId] = useState(() => {
    // Дефолт: первая задача с проблемой, иначе первая задача
    const problem = TASKS.find((t) => {
      const c = student.tasks[t.id];
      return c.score !== null && c.score / t.max < 0.8;
    });
    return (problem ?? TASKS[0]).id;
  });

  if (!studentTotals(student).submitted) {
    return (
      <div className="flex items-center justify-between bg-white border border-[#FCA5A5] rounded-md px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[#7F1D1D]">
          <AlertTriangle className="w-4 h-4" />
          Ученик не приступал к ДЗ. Напомнить о дедлайне?
        </div>
        <button className="text-xs font-medium px-3 py-1.5 rounded-md bg-[#1B6B4A] text-white hover:bg-[#155539] transition-colors flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" />
          Напомнить в Telegram
        </button>
      </div>
    );
  }

  const selectedTask = TASKS.find((t) => t.id === selectedTaskId);
  const selectedCell = student.tasks[selectedTaskId];

  return (
    <div className="space-y-3">
      {/* Полоска мини-карточек задач */}
      <div>
        <div className="text-xs text-[#64748B] mb-2 px-1">Задачи · кликните, чтобы открыть переписку</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TASKS.map((t) => (
            <TaskMiniCard
              key={t.id}
              task={t}
              cell={student.tasks[t.id]}
              selected={t.id === selectedTaskId}
              onSelect={() => setSelectedTaskId(t.id)}
            />
          ))}
        </div>
      </div>

      {/* GuidedThreadViewer placeholder */}
      <ThreadViewerPlaceholder student={student} task={selectedTask} cell={selectedCell} />
    </div>
  );
}

function TaskMiniCard({ task, cell, selected, onSelect }) {
  const c = cellColor(cell.score, task.max);
  const ratio = cell.score === null ? 0 : cell.score / task.max;
  const StatusIcon =
    cell.score === null
      ? MinusCircle
      : ratio >= 0.8
      ? CheckCircle2
      : ratio >= 0.3
      ? AlertTriangle
      : XCircle;
  const statusColor =
    cell.score === null
      ? "#94A3B8"
      : ratio >= 0.8
      ? "#1B6B4A"
      : ratio >= 0.3
      ? "#B45309"
      : "#B91C1C";

  return (
    <button
      onClick={onSelect}
      className={`flex-shrink-0 text-left rounded-md border px-2.5 py-2 transition-all min-w-[110px] ${
        selected
          ? "ring-2 ring-[#1B6B4A] ring-offset-1 border-[#1B6B4A] bg-white"
          : "border-[#E2E8F0] bg-white hover:bg-[#F7F6F3]"
      }`}
      style={selected ? {} : { borderColor: c.border }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[#64748B] font-medium">
          №{task.order} · КИМ {task.kim}
        </span>
        <StatusIcon className="w-3.5 h-3.5" style={{ color: statusColor }} />
      </div>
      <div
        className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-bold mb-1"
        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      >
        {formatScoreCell(cell.score, task.max)}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
        {cell.hints > 0 && (
          <span className="flex items-center gap-0.5 text-[#B45309]">
            <Lightbulb className="w-2.5 h-2.5" /> {cell.hints}
          </span>
        )}
        {cell.attempts > 1 && <span>{cell.attempts} поп.</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            // open manual score edit modal
          }}
          className="ml-auto text-[#64748B] hover:text-[#1B6B4A] flex items-center gap-0.5"
          title="Изменить балл вручную"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
      </div>
    </button>
  );
}

function ThreadViewerPlaceholder({ student, task, cell }) {
  const c = cellColor(cell.score, task.max);
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-md overflow-hidden">
      {/* Header — task context (как в существующем GuidedThreadViewer после E8) */}
      <div className="px-4 py-3 border-b border-[#E2E8F0] bg-[#F8FAFC]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] text-[#64748B] font-medium">
                Задача №{task.order} · КИМ {task.kim}
              </span>
              <span
                className="text-[11px] px-2 py-0.5 rounded font-semibold"
                style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
              >
                {formatScoreCell(cell.score, task.max)}
              </span>
              {cell.hints > 0 && (
                <span className="text-[11px] text-[#B45309] flex items-center gap-0.5">
                  <Lightbulb className="w-3 h-3" /> {cell.hints} подсказок
                </span>
              )}
              {cell.attempts > 1 && (
                <span className="text-[11px] text-[#64748B]">· {cell.attempts} попытки</span>
              )}
            </div>
            <div className="text-sm text-[#0F172A] font-medium">{task.title}</div>
            {cell.comment && (
              <div className="text-xs text-[#64748B] mt-1 italic">AI: {cell.comment}</div>
            )}
          </div>
          <button className="text-[11px] px-2.5 py-1.5 rounded-md border border-[#1B6B4A] text-[#1B6B4A] hover:bg-[#DCFCE7] flex items-center gap-1 flex-shrink-0">
            <Pencil className="w-3 h-3" />
            Изменить балл
          </button>
        </div>
      </div>

      {/* Thread viewer placeholder */}
      <div className="px-4 py-8 text-center text-sm text-[#94A3B8] bg-[#F7F6F3] border-t border-dashed border-[#E2E8F0]">
        <MessageSquareText className="w-6 h-6 mx-auto mb-2 opacity-50" />
        <div className="font-medium text-[#64748B] mb-0.5">
          Здесь будет переписка guided-чата
        </div>
        <div className="text-[11px]">
          GuidedThreadViewer для {student.name}, отфильтрованный по задаче №{task.order}
        </div>
      </div>
    </div>
  );
}
