import { Button } from "@/components/ui/button";
import { Flame, Target, Zap, Award } from "lucide-react";
import { ConfettiBurst } from "@/components/ConfettiBurst";
import { useEffect, useState } from "react";
import { haptics } from "@/utils/haptics";

interface GoalReachedModalProps {
  isOpen: boolean;
  onClose: () => void;
  stats: {
    streak: number;
    solved: number;
    xp: number;
  };
}

export const GoalReachedModal = ({ isOpen, onClose, stats }: GoalReachedModalProps) => {
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowConfetti(true);
      haptics.success();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
      />

      <ConfettiBurst active={showConfetti} onComplete={() => setShowConfetti(false)} />

      <div
        className="relative bg-card border-2 border-primary/20 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center overflow-hidden animate-in fade-in zoom-in-90 slide-in-from-bottom-4 duration-300"
      >
        {/* Фон с лучами */}
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent -z-10" />

        <div
          className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-accent shadow-lg shadow-accent/40 mb-6"
        >
          <Award className="w-12 h-12 text-white" />
        </div>

        <h2 className="text-2xl font-black mb-2 text-orange-600 uppercase tracking-tight">
          Цель достигнута!
        </h2>
        <p className="text-muted-foreground mb-8 font-medium">
          Ты сегодня просто машина! Поставлен новый рекорд.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="flex flex-col items-center">
            <div className="text-orange-500 mb-1"><Flame className="w-5 h-5" /></div>
            <span className="text-lg font-bold">{stats.streak}</span>
            <span className="text-xs text-muted-foreground uppercase font-bold">Дней</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="text-blue-500 mb-1"><Target className="w-5 h-5" /></div>
            <span className="text-lg font-bold">{stats.solved}</span>
            <span className="text-xs text-muted-foreground uppercase font-bold">Задач</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="text-amber-500 mb-1"><Zap className="w-5 h-5" /></div>
            <span className="text-lg font-bold">{stats.xp}</span>
            <span className="text-xs text-muted-foreground uppercase font-bold">Очков</span>
          </div>
        </div>

        <Button
          onClick={onClose}
          size="lg"
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl font-bold h-14 shadow-lg shadow-primary/20 transition-colors"
        >
          КРУТО, ПРОДОЛЖАЕМ!
        </Button>
      </div>
    </div>
  );
};
