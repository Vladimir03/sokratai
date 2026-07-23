import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { SUBJECTS } from "@/types/homework";

interface OnboardingModalProps {
  open: boolean;
  userId: string | null;
  onComplete: () => void;
}

/**
 * Контекст онбординга (RPC get_student_onboarding_context, SECURITY DEFINER —
 * ученик не читает свою tutor_students). Спрашиваем только недостающее; предмет
 * у приглашённых репетитором НЕ спрашиваем (его знает репетитор-предметник).
 */
interface OnboardingContext {
  grade: number | null;
  learner_type: "school" | "adult" | null;
  learning_goal: string | null;
  difficult_subject: string | null;
  onboarding_completed: boolean;
  has_tutor: boolean;
  tutor_exam_type: string | null;
}

type StepKind = "level" | "subject" | "goal";

// Классы 1–11 + взрослый. adult → grade=NULL, learner_type='adult'.
const SCHOOL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// Предметы — канонические id из SUBJECTS (единый словарь; раньше онбординг писал
// math/cs и не имел языков → ученики Эмилии жали «Другой»).
const SUBJECT_EMOJI: Record<string, string> = {
  maths: "📐", physics: "⚛️", informatics: "💻", russian: "📝", literature: "📚",
  history: "📜", social: "🏛️", english: "🇬🇧", french: "🇫🇷", spanish: "🇪🇸",
  chemistry: "🧪", biology: "🧬", geography: "🌍", other: "📖",
};

const SCHOOL_GOALS = [
  { value: "ege", label: "ЕГЭ", emoji: "🎯" },
  { value: "oge", label: "ОГЭ", emoji: "📝" },
  { value: "school", label: "Школьная программа", emoji: "📚" },
  { value: "olympiad", label: "Олимпиада", emoji: "🏆" },
];

// Цели взрослого — экзамены ЕГЭ/ОГЭ не предлагаем (запрос: «дальнейшие вопросы
// подстрой под первый ответ»). Кейс взрослых Эмилии: «в основном учат для себя».
const ADULT_GOALS = [
  { value: "self", label: "Для себя", emoji: "🌱" },
  { value: "exam_cert", label: "Экзамен / сертификат", emoji: "📜" },
  { value: "work_move", label: "Работа / переезд", emoji: "✈️" },
];

const OnboardingModal = ({ open, userId, onComplete }: OnboardingModalProps) => {
  const [ctx, setCtx] = useState<OnboardingContext | null>(null);
  const [ctxLoaded, setCtxLoaded] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [learnerType, setLearnerType] = useState<"school" | "adult" | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Гард от двойного тапа (P1 ревью 5.6): два тапа за 250 мс инкрементили stepIdx
  // дважды → пропуск шага / currentStep=undefined (модалка залипала). Пока идёт
  // переход — новые тапы игнорируются; сбрасывается на смене шага.
  const [advancing, setAdvancing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [startedAt] = useState(new Date().toISOString());

  // Загрузка контекста при открытии.
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setCtxLoaded(false);
    (async () => {
      try {
        const { data } = await supabase.rpc("get_student_onboarding_context" as never);
        if (!cancelled) setCtx((data as OnboardingContext | null) ?? null);
      } catch {
        if (!cancelled) setCtx(null); // fail-open: спросим всё (как раньше)
      } finally {
        if (!cancelled) setCtxLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, userId]);

  // Какие шаги реально нужны (спрашиваем только недостающее).
  const steps = useMemo<StepKind[]>(() => {
    const s: StepKind[] = [];
    const knownLevel = !!ctx && (ctx.grade != null || ctx.learner_type != null);
    const knownSubject = !!ctx && (ctx.has_tutor || ctx.difficult_subject != null);
    const knownGoal = !!ctx && (ctx.learning_goal != null || ctx.tutor_exam_type != null);
    if (!knownLevel) s.push("level");
    if (!knownSubject) s.push("subject"); // предмет НЕ спрашиваем у приглашённых
    if (!knownGoal) s.push("goal");
    return s;
  }, [ctx]);

  // Если спрашивать нечего — тихо помечаем онбординг завершённым и закрываем.
  useEffect(() => {
    if (!ctxLoaded || !userId || isSubmitting) return;
    if (steps.length === 0) {
      void finalize({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxLoaded, steps.length]);

  const isAdult = learnerType === "adult" || ctx?.learner_type === "adult";
  const goals = isAdult ? ADULT_GOALS : SCHOOL_GOALS;

  const finalize = async (patch: Record<string, unknown>) => {
    if (!userId) return;
    setIsSubmitting(true);
    setSaveError(null);

    // Supabase возвращает { error }, а НЕ бросает (P1 ревью 5.6: try/catch тут не
    // ловил). Сбой профильного апдейта → НЕ завершаем онбординг и НЕ пишем
    // аналитику (иначе deploy-skew/сеть/RLS → ответы потеряны, onboarding_completed
    // не проставлен, модалка вернётся). Аналитика — best-effort.
    const { error: updErr } = await supabase
      .from("profiles")
      .update({ ...patch, onboarding_completed: true } as never)
      .eq("id", userId);
    if (updErr) {
      console.error(JSON.stringify({ event: "onboarding_profile_update_failed", error: updErr.message }));
      setSaveError("Не удалось сохранить. Проверь интернет и попробуй ещё раз.");
      setIsSubmitting(false);
      setAdvancing(false);
      return;
    }

    // Ф7 (subject-personalization, 2026-07-23): dual-write предмета в массив
    // profiles.subjects — ОТДЕЛЬНЫМ best-effort апдейтом (deploy-skew: если
    // миграция 20260723140000 ещё не применена, сбой НЕ ломает онбординг).
    const pickedSubject =
      typeof patch.difficult_subject === "string" && patch.difficult_subject
        ? patch.difficult_subject
        : null;
    if (pickedSubject) {
      void supabase
        .from("profiles")
        .update({ subjects: [pickedSubject] } as never)
        .eq("id", userId)
        .then(({ error }) => {
          if (error) {
            console.warn(
              JSON.stringify({ event: "onboarding_subjects_array_write_failed", error: error.message }),
            );
          }
        });
    }

    const { error: aErr } = await supabase.from("onboarding_analytics").insert({
      user_id: userId,
      source: "web",
      grade: (patch.grade as number | null) ?? ctx?.grade ?? null,
      subject: (patch.difficult_subject as string | null) ?? ctx?.difficult_subject ?? null,
      goal: (patch.learning_goal as string | null) ?? ctx?.learning_goal ?? null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    } as never);
    if (aErr) console.warn(JSON.stringify({ event: "onboarding_analytics_failed", error: aErr.message }));

    onComplete();
    setIsSubmitting(false);
  };

  const isLast = stepIdx >= steps.length - 1;

  // Абсолютный переход на следующий шаг (НЕ инкремент — иначе двойной тап +2).
  const goToNextStep = () => {
    setAdvancing(true);
    const target = stepIdx + 1;
    setTimeout(() => {
      setStepIdx(target);
      setAdvancing(false);
    }, 250);
  };

  const handleLevelPick = (kind: "school" | "adult", grade?: number) => {
    if (advancing || isSubmitting) return;
    setLearnerType(kind);
    setSelectedGrade(kind === "school" ? (grade ?? null) : null);
    if (isLast) {
      setAdvancing(true);
      void finalize(buildPatchWith({ level: { kind, grade } }));
    } else {
      goToNextStep();
    }
  };

  const handleSubjectPick = (subject: string) => {
    if (advancing || isSubmitting) return;
    setSelectedSubject(subject);
    if (isLast) {
      setAdvancing(true);
      void finalize(buildPatchWith({ subject }));
    } else {
      goToNextStep();
    }
  };

  const handleGoalPick = (goal: string) => {
    if (advancing || isSubmitting) return;
    setAdvancing(true);
    setSelectedGoal(goal);
    void finalize(buildPatchWith({ goal }));
  };

  // Патч с учётом ТОЛЬКО что выбранного значения (state ещё не обновился в замыкании).
  const buildPatchWith = (just: {
    level?: { kind: "school" | "adult"; grade?: number };
    subject?: string;
    goal?: string;
  }): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    if (steps.includes("level")) {
      const lvl = just.level ?? (learnerType ? { kind: learnerType, grade: selectedGrade ?? undefined } : null);
      if (lvl?.kind === "adult") { patch.learner_type = "adult"; patch.grade = null; }
      else if (lvl?.kind === "school" && lvl.grade != null) { patch.learner_type = "school"; patch.grade = lvl.grade; }
    }
    if (steps.includes("subject")) {
      const subj = just.subject ?? selectedSubject;
      if (subj != null) patch.difficult_subject = subj;
    }
    if (steps.includes("goal")) {
      const g = just.goal ?? selectedGoal;
      if (g != null) patch.learning_goal = g;
    }
    return patch;
  };

  const OptionCard = ({ emoji, label, selected, onClick }: {
    emoji: string; label: string; selected: boolean; onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      disabled={isSubmitting || advancing}
      style={{ touchAction: "manipulation" }}
      className={cn(
        "flex items-center gap-3 p-4 rounded-xl border-2 transition-colors w-full text-left min-h-[44px]",
        selected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50 hover:bg-accent",
      )}
    >
      <span className="text-2xl">{emoji}</span>
      <span className="font-medium text-foreground">{label}</span>
    </button>
  );

  const ProgressDots = () => (
    <div className="flex gap-2 justify-center mb-6">
      {steps.map((_, i) => (
        <div key={i} className={cn(
          "w-2 h-2 rounded-full transition-all",
          i === stepIdx ? "bg-primary w-6" : i < stepIdx ? "bg-primary" : "bg-muted",
        )} />
      ))}
    </div>
  );

  const currentStep = steps[stepIdx];

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* Пока грузим контекст или нечего спрашивать — короткий лоадер (авто-закроется). */}
        {!ctxLoaded || steps.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Готовим Сократ под тебя…</span>
          </div>
        ) : (
          <>
            <ProgressDots />

            {saveError && (
              <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
                {saveError}
              </p>
            )}

            {currentStep === "level" && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                <div className="text-center mb-6">
                  <h2 className="text-xl font-semibold text-foreground">Расскажи о себе</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Это поможет подобрать подходящие материалы
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {SCHOOL_GRADES.map((g) => (
                    <button
                      key={g}
                      onClick={() => handleLevelPick("school", g)}
                      disabled={isSubmitting || advancing}
                      style={{ touchAction: "manipulation" }}
                      className={cn(
                        "flex items-center justify-center rounded-xl border-2 py-3 text-sm font-medium transition-colors min-h-[44px]",
                        selectedGrade === g ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                      )}
                    >
                      {g} класс
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => handleLevelPick("adult")}
                  disabled={isSubmitting || advancing}
                  style={{ touchAction: "manipulation" }}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border-2 py-3 w-full text-sm font-medium transition-colors min-h-[44px]",
                    learnerType === "adult" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                  )}
                >
                  <span className="text-xl">🎓</span> Взрослый / не школьник
                </button>
              </div>
            )}

            {currentStep === "subject" && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                <div className="text-center mb-6">
                  <h2 className="text-xl font-semibold text-foreground">С каким предметом нужна помощь?</h2>
                  <p className="text-sm text-muted-foreground mt-1">Выбери основной предмет</p>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
                  {SUBJECTS.map((s) => (
                    <OptionCard
                      key={s.id}
                      emoji={SUBJECT_EMOJI[s.id] ?? "📖"}
                      label={s.name}
                      selected={selectedSubject === s.id}
                      onClick={() => handleSubjectPick(s.id)}
                    />
                  ))}
                </div>
                {stepIdx > 0 && (
                  <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setStepIdx((i) => i - 1)} disabled={isSubmitting}>
                    ← Назад
                  </Button>
                )}
              </div>
            )}

            {currentStep === "goal" && (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                <div className="text-center mb-6">
                  <h2 className="text-xl font-semibold text-foreground">
                    {isAdult ? "Для чего занимаешься?" : "Для чего готовишься?"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">Подберём материалы под твою цель</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {goals.map((goal) => (
                    <OptionCard
                      key={goal.value}
                      emoji={goal.emoji}
                      label={goal.label}
                      selected={selectedGoal === goal.value}
                      onClick={() => handleGoalPick(goal.value)}
                    />
                  ))}
                </div>
                {stepIdx > 0 && (
                  <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setStepIdx((i) => i - 1)} disabled={isSubmitting}>
                    ← Назад
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingModal;
