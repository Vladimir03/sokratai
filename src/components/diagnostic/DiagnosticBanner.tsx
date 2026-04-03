import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Target, ArrowRight, TrendingUp } from 'lucide-react';

interface DiagnosticBannerProps {
  onNavigate: () => void;
  lastScore?: number;
  hasCompletedDiagnostic: boolean;
}

export const DiagnosticBanner = ({ 
  onNavigate, 
  lastScore, 
  hasCompletedDiagnostic 
}: DiagnosticBannerProps) => {
  if (hasCompletedDiagnostic && lastScore !== undefined) {
    return (
      <Card className="mb-6 bg-primary/5 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-full">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Ваш прогнозируемый балл: ~{lastScore}</p>
                <p className="text-sm text-muted-foreground">
                  Пройдите диагностику снова, чтобы отследить прогресс
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onNavigate}>
              Пройти снова
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6 bg-amber-50 border-amber-500/20">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-full">
              <Target className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="font-medium">Пройдите диагностику</p>
              <p className="text-sm text-muted-foreground">
                Узнайте свой уровень и получите персональный план
              </p>
            </div>
          </div>
          <Button 
            size="sm" 
            onClick={onNavigate}
            className="bg-amber-500 hover:bg-amber-600"
          >
            Начать
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
