import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";

interface OnboardingModalProps {
  open: boolean;
  userId: string | null;
  onComplete: () => void;
}

const grades = [
  { value: 9, label: "9 класс", emoji: "📚" },
  { value: 10, label: "10 класс", emoji: "📖" },
  { value: 11, label: "11 класс", emoji: "🎓" },
];

const subjects = [
  { value: "math", label: "Математика", emoji: "📐" },
  { value: "physics", label: "Физика", emoji: "⚛️" },
  { value: "cs", label: "Информатика", emoji: "💻" },
  { value: "chemistry", label: "Химия", emoji: "🧪" },
  { value: "russian", label: "Русский язык", emoji: "📝" },
  { value: "history", label: "История", emoji: "📜" },
  { value: "biology", label: "Биология", emoji: "🧬" },
  { value: "other", label: "Другой предмет", emoji: "📖" },
];

const goals = [
  { value: "ege", label: "ЕГЭ", emoji: "🎯" },
  { value: "oge", label: "ОГЭ", emoji: "📝" },
  { value: "school", label: "Школьная программа", emoji: "📚" },
  { value: "olympiad", label: "Олимпиада", emoji: "🏆" },
];

const OnboardingModal = ({ open, userId, onComplete }: OnboardingModalProps) => {
  const [step, setStep] = useState(1);
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startedAt] = useState(new Date().toISOString());

  const handleGradeSelect = (grade: number) => {
    setSelectedGrade(grade);
    setTimeout(() => setStep(2), 300);
  };

  const handleSubjectSelect = (subject: string) => {
    setSelectedSubject(subject);
    setTimeout(() => setStep(3), 300);
  };

  const handleGoalSelect = async (goal: string) => {
    setSelectedGoal(goal);
    setIsSubmitting(true);

    if (!userId) return;

    try {
      // Update profile
      await supabase
        .from("profiles")
        .update({
          grade: selectedGrade,
          difficult_subject: selectedSubject,
          learning_goal: goal,
          onboarding_completed: true,
        })
        .eq("id", userId);

      // Record analytics
      await supabase.from("onboarding_analytics").insert({
        user_id: userId,
        source: "web",
        grade: selectedGrade,
        subject: selectedSubject,
        goal: goal,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      });

      onComplete();
    } catch (error) {
      console.error("Error saving onboarding:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const OptionCard = ({
    emoji,
    label,
    selected,
    onClick,
  }: {
    emoji: string;
    label: string;
    selected: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 p-4 rounded-xl border-2 transition-colors w-full text-left",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-primary/50 hover:bg-accent"
      )}
    >
      <span className="text-2xl">{emoji}</span>
      <span className="font-medium text-foreground">{label}</span>
    </button>
  );

  const ProgressDots = () => (
    <div className="flex gap-2 justify-center mb-6">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "w-2 h-2 rounded-full transition-all",
            i === step
              ? "bg-primary w-6"
              : i < step
              ? "bg-primary"
              : "bg-muted"
          )}
        />
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <ProgressDots />

          {step === 1 && (
            <div
              key="step1"
              className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200"
            >
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-foreground">
                  В каком ты классе?
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Это поможет подобрать подходящие задачи
                </p>
              </div>

              <div className="space-y-3">
                {grades.map((grade) => (
                  <OptionCard
                    key={grade.value}
                    emoji={grade.emoji}
                    label={grade.label}
                    selected={selectedGrade === grade.value}
                    onClick={() => handleGradeSelect(grade.value)}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div
              key="step2"
              className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200"
            >
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-foreground">
                  С каким предметом нужна помощь?
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Выбери основной предмет
                </p>
              </div>

              <div className="space-y-3">
                {subjects.map((subject) => (
                  <OptionCard
                    key={subject.value}
                    emoji={subject.emoji}
                    label={subject.label}
                    selected={selectedSubject === subject.value}
                    onClick={() => handleSubjectSelect(subject.value)}
                  />
                ))}
              </div>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => setStep(1)}
              >
                ← Назад
              </Button>
            </div>
          )}

          {step === 3 && (
            <div
              key="step3"
              className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200"
            >
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-foreground">
                  Для чего готовишься?
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Подберём материалы под твою цель
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {goals.map((goal) => (
                  <OptionCard
                    key={goal.value}
                    emoji={goal.emoji}
                    label={goal.label}
                    selected={selectedGoal === goal.value}
                    onClick={() => handleGoalSelect(goal.value)}
                  />
                ))}
              </div>

              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => setStep(2)}
                disabled={isSubmitting}
              >
                ← Назад
              </Button>
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingModal;
