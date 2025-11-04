import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { OnboardingAnalytics } from "@/utils/onboardingAnalytics";
import { getDemoTask, subjectNames } from "@/data/onboardingTasks";
import { cn } from "@/lib/utils";

interface OnboardingProps {
  userId: string;
  onComplete: (grade: number, subject: string, goal: string, quickMessage?: string) => void;
}

export default function Onboarding({ userId, onComplete }: OnboardingProps) {
  // State
  const [step, setStep] = useState(1); // 1-5
  const [grade, setGrade] = useState<number | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  
  const [showCustomGrade, setShowCustomGrade] = useState(false);
  const [customGradeInput, setCustomGradeInput] = useState("");
  
  const [showCustomGoal, setShowCustomGoal] = useState(false);
  const [customGoalInput, setCustomGoalInput] = useState("");
  
  const [showHint2, setShowHint2] = useState(false);
  const [showAnswerInput, setShowAnswerInput] = useState(false);
  const [userAnswer, setUserAnswer] = useState("");
  const [answered, setAnswered] = useState(false);
  
  const { toast } = useToast();
  const [analytics] = useState(() => new OnboardingAnalytics());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hint2Ref = useRef<HTMLDivElement>(null);
  const answerInputRef = useRef<HTMLDivElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  // Initialize analytics
  useEffect(() => {
    analytics.start(userId);
  }, [userId, analytics]);

  // Get demo task based on selected grade and subject
  const demoTask = grade && subject ? getDemoTask(subject, grade) : null;

  // Universal scroll function
  const scrollToElement = (ref: React.RefObject<HTMLElement>, delay = 400) => {
    if (!ref.current) return;
    
    requestAnimationFrame(() => {
      setTimeout(() => {
        ref.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest' 
        });
      }, delay);
    });
  };

  // Auto-scroll when hint 2 is shown
  useEffect(() => {
    if (step === 4 && showHint2 && hint2Ref.current) {
      scrollToElement(hint2Ref);
    }
  }, [showHint2, step]);

  // Auto-scroll when answer input appears
  useEffect(() => {
    if (step === 4 && showAnswerInput && answerInputRef.current) {
      scrollToElement(answerInputRef);
    }
  }, [showAnswerInput, step]);

  // Auto-scroll when answer is submitted on step 4
  useEffect(() => {
    if (step === 4 && answered && continueButtonRef.current) {
      scrollToElement(continueButtonRef, 500);
    }
  }, [answered, step]);

  // Auto-scroll to top when entering step 5 (final step)
  useEffect(() => {
    if (step === 5 && scrollContainerRef.current) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          scrollContainerRef.current?.scrollTo({
            top: 0,
            behavior: 'smooth'
          });
        }, 100);
      });
    }
  }, [step]);

  // ============= HANDLERS =============

  const selectGrade = (selectedGrade: number) => {
    setGrade(selectedGrade);
    analytics.saveStepDuration(1, { grade: selectedGrade });
    analytics.moveToStep(2);
    setStep(2);
  };

  const handleCustomGrade = () => {
    const g = parseInt(customGradeInput);
    if (!g || g < 1 || g > 11) {
      toast({
        title: "Ошибка",
        description: "Введи класс от 1 до 11",
        variant: "destructive"
      });
      return;
    }
    selectGrade(g);
  };

  const selectSubject = (selectedSubject: string) => {
    setSubject(selectedSubject);
    analytics.saveStepDuration(2, { subject: selectedSubject });
    analytics.moveToStep(3);
    setStep(3);
  };

  const selectGoal = (selectedGoal: string) => {
    setGoal(selectedGoal);
    analytics.saveStepDuration(3, { goal: selectedGoal });
    
    // Check if demo task exists
    const taskExists = grade && subject && getDemoTask(subject, grade);
    
    if (taskExists) {
      analytics.moveToStep(4);
      setStep(4);
    } else {
      // Skip demo, go straight to step 5
      analytics.moveToStep(5);
      setStep(5);
    }
  };

  const handleCustomGoal = () => {
    if (!customGoalInput.trim()) {
      toast({
        title: "Ошибка",
        description: "Напиши свою цель",
        variant: "destructive"
      });
      return;
    }
    selectGoal(customGoalInput.trim());
  };

  const handleHint2 = () => {
    setShowHint2(true);
    analytics.trackDemoHintUsed();
  };

  const handleAnswerAttempt = () => {
    setShowAnswerInput(true);
    analytics.trackDemoAnswerAttempted();
  };

  const handleDemoAnswer = () => {
    setAnswered(true);
    analytics.saveStepDuration(4);
  };

  const moveToFinalStep = () => {
    analytics.moveToStep(5);
    setStep(5);
  };

  const completeOnboarding = async (quickMessage?: string) => {
    if (!grade || !subject || !goal) return;

    await analytics.complete(grade, subject, goal);
    analytics.saveStepDuration(5);
    
    onComplete(grade, subject, goal, quickMessage);
  };

  // ============= RENDER =============

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="relative bg-background w-full h-full sm:h-auto sm:max-w-md sm:rounded-lg flex flex-col sm:max-h-[85vh] overflow-hidden">
        
        {/* Compact sticky progress */}
        <div className="shrink-0 sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
          <div className="px-4 py-3">
            <div className="flex items-center justify-center gap-2 max-w-[200px] mx-auto">
              {[1, 2, 3, 4, 5].map((num) => (
                <div
                  key={num}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    num === step 
                      ? "flex-1 bg-accent" 
                      : num < step 
                      ? "w-1.5 bg-accent/50" 
                      : "w-1.5 bg-muted"
                  )}
                />
              ))}
            </div>
            <p className="text-[11px] text-center text-primary mt-2 font-medium">
              Шаг {step} из 5
            </p>
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto min-h-0 px-4"
          style={{
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
            paddingBottom: 'max(5rem, env(safe-area-inset-bottom) + 4rem)',
            WebkitOverflowScrolling: 'touch',
            scrollPaddingTop: '1rem',
            scrollPaddingBottom: '5rem'
          }}
        >
          <div className="w-full max-w-2xl mx-auto space-y-4">

        {/* STEP 1: Grade selection */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center space-y-2">
              <h2 className="text-2xl md:text-3xl font-bold">
                Привет! 👋 Я Сократ — твой ИИ-помощник.
              </h2>
              <p className="text-muted-foreground text-lg">
                Перед тем как начать, скажи: в каком ты классе?
              </p>
            </div>

            <div className="flex flex-wrap gap-2 justify-center">
              <Button
                className="h-12 md:h-[60px] text-sm md:text-base"
                onClick={() => selectGrade(9)}
              >
                9 класс
              </Button>
              <Button
                className="h-12 md:h-[60px] text-sm md:text-base"
                onClick={() => selectGrade(10)}
              >
                10 класс
              </Button>
              <Button
                className="h-12 md:h-[60px] text-sm md:text-base"
                onClick={() => selectGrade(11)}
              >
                11 класс
              </Button>
              <Button
                variant="outline"
                className="h-12 md:h-[60px] text-sm md:text-base"
                onClick={() => setShowCustomGrade(true)}
              >
                Другой класс
              </Button>
            </div>

            {showCustomGrade && (
              <div className="flex gap-2 justify-center items-center animate-fade-in">
                <Input
                  type="number"
                  min="1"
                  max="11"
                  placeholder="Введи свой класс (1-11)"
                  className="w-40 text-center"
                  value={customGradeInput}
                  onChange={(e) => setCustomGradeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomGrade();
                  }}
                  autoFocus
                />
                <Button size="sm" onClick={handleCustomGrade}>
                  →
                </Button>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Subject selection */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-center text-xl">
              Какой предмет тебе даётся сложнее всего?
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Button
                className="h-20 text-lg"
                onClick={() => selectSubject('math')}
              >
                📐 Математика
              </Button>
              <Button
                className="h-20 text-lg"
                onClick={() => selectSubject('physics')}
              >
                ⚛️ Физика
              </Button>
              <Button
                className="h-20 text-lg"
                onClick={() => selectSubject('cs')}
              >
                💻 Информатика
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Goal selection */}
        {step === 3 && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-center text-xl">
              Для чего готовишься?
            </p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Button
                className="h-14 text-base"
                onClick={() => selectGoal('ЕГЭ')}
              >
                🎯 ЕГЭ
              </Button>
              <Button
                className="h-14 text-base"
                onClick={() => selectGoal('ОГЭ')}
              >
                📝 ОГЭ
              </Button>
              <Button
                className="h-14 text-base"
                onClick={() => selectGoal('Школьная программа')}
              >
                <span className="md:hidden">📚 Школа</span>
                <span className="hidden md:inline">📚 Школьная программа</span>
              </Button>
              <Button
                className="h-14 text-base"
                onClick={() => selectGoal('Олимпиада')}
              >
                🏆 Олимпиада
              </Button>
              <Button
                variant="outline"
                className="h-14 text-base md:col-span-2"
                onClick={() => setShowCustomGoal(true)}
              >
                Другое
              </Button>
            </div>

            {showCustomGoal && (
              <div className="flex gap-2 animate-fade-in">
                <Input
                  placeholder="Напиши свою цель"
                  value={customGoalInput}
                  onChange={(e) => setCustomGoalInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomGoal();
                  }}
                  autoFocus
                />
                <Button size="sm" onClick={handleCustomGoal}>→</Button>
              </div>
            )}
          </div>
        )}

        {/* STEP 4: Interactive demo */}
        {step === 4 && demoTask && (
          <div className="space-y-4 animate-fade-in">
            <div className="text-center mb-4">
              <p className="text-lg text-muted-foreground">
                Смотри, как я помогаю разобраться в задачах:
              </p>
            </div>

            <div className="bg-accent/20 border-2 border-accent rounded-lg p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                Пример задачи:
              </p>
              <p className="text-lg font-medium">
                {demoTask.task}
              </p>

              {/* Hint 1 */}
              <div className="bg-background rounded-lg p-4">
                <p className="text-sm">💡 {demoTask.hint1}</p>
              </div>

              {/* Hint 2 */}
              {showHint2 && (
                <div ref={hint2Ref} className="bg-background rounded-lg p-4 animate-fade-in">
                  <p className="text-sm">💡 {demoTask.hint2}</p>
                </div>
              )}

              {/* Action buttons */}
              {!answered && (
                <div className="flex gap-2 flex-wrap">
                  {!showHint2 && (
                    <Button
                      variant="outline"
                      onClick={handleHint2}
                    >
                      Дай ещё подсказку
                    </Button>
                  )}
                  {!showAnswerInput && (
                    <Button onClick={handleAnswerAttempt}>
                      Попробовать ответить
                    </Button>
                  )}
                </div>
              )}

              {/* Answer input */}
              {showAnswerInput && !answered && (
                <div ref={answerInputRef} className="flex gap-2 animate-fade-in">
                  <Input
                    placeholder="Твой ответ..."
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleDemoAnswer();
                    }}
                    autoFocus
                  />
                  <Button size="sm" onClick={handleDemoAnswer}>
                    ✓
                  </Button>
                </div>
              )}

              {/* Success message */}
              {answered && (
                <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg animate-fade-in space-y-3">
                  <p className="font-semibold text-green-600">
                    🎉 Отлично! Видишь, как я помогаю разобраться?
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Правильный ответ: {demoTask.answer}
                  </p>
                <Button
                  ref={continueButtonRef}
                  onClick={moveToFinalStep}
                  className="w-full"
                >
                  Продолжить →
                </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 5: Call to action */}
        {step === 5 && (
          <div className="space-y-4 animate-fade-in text-center">
            <div className="space-y-3">
              <h2 className="text-2xl md:text-3xl font-bold">
                Теперь твоя очередь! 🚀
              </h2>
              <p className="text-muted-foreground text-lg">
                Напиши мне любую задачу по математике, физике или информатике.
              </p>
              <p className="text-muted-foreground text-lg">
                Или просто спроси: "Объясни мне квадратные уравнения"
              </p>
              <p className="text-accent font-medium text-lg mt-4">
                А можешь загрузить фото или скриншот с задачей! 📸
              </p>
            </div>

            {/* Example questions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-w-2xl mx-auto">
              <Button
                variant="outline"
                className="h-14 text-sm"
                onClick={() => completeOnboarding("Как решать системы уравнений?")}
              >
                Как решать системы уравнений?
              </Button>
              <Button
                variant="outline"
                className="h-14 text-sm"
                onClick={() => completeOnboarding("Объясни закон Ома")}
              >
                Объясни закон Ома
              </Button>
              <Button
                variant="outline"
                className="h-14 text-sm"
                onClick={() => completeOnboarding("Что такое циклы в Python?")}
              >
                Что такое циклы в Python?
              </Button>
              <Button
                variant="outline"
                className="h-14 text-sm md:col-span-2"
                onClick={() => completeOnboarding()}
              >
                📷 Помоги с задачей из учебника
              </Button>
            </div>

            {/* Skip button */}
            <Button
              variant="ghost"
              onClick={() => completeOnboarding()}
              className="text-muted-foreground"
            >
              Пропустить и начать общаться
            </Button>
          </div>
        )}
        </div>
        </div>

        {/* Scroll fade indicators */}
        <div className="absolute top-[52px] left-0 right-0 h-8 bg-gradient-to-b from-background via-background/80 to-transparent pointer-events-none z-[5]" />
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-[5]" />
      </div>
    </div>
  );
}
