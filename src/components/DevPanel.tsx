import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw } from "lucide-react";

const DEV_USER_ID = "b30a0780-8988-4a0c-9e39-97c9ff53b0da";

interface DevPanelProps {
  userId: string;
  onReset: () => void;
}

export default function DevPanel({ userId, onReset }: DevPanelProps) {
  const { toast } = useToast();

  // Показываем только для dev user
  if (userId !== DEV_USER_ID) return null;

  const handleResetOnboarding = async () => {
    try {
      // Сбрасываем onboarding_completed в profiles
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          onboarding_completed: false,
          grade: null,
          difficult_subject: null,
          learning_goal: null
        })
        .eq('id', userId);

      if (profileError) throw profileError;

      // Удаляем записи из onboarding_analytics
      const { error: analyticsError } = await supabase
        .from('onboarding_analytics')
        .delete()
        .eq('user_id', userId);

      if (analyticsError) throw analyticsError;

      toast({
        title: "🔄 Онбординг сброшен",
        description: "Можно проходить заново"
      });

      // Перезагружаем страницу
      onReset();
    } catch (error) {
      console.error('Error resetting onboarding:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось сбросить онбординг",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Button
        onClick={handleResetOnboarding}
        variant="outline"
        size="sm"
        className="gap-2 bg-yellow-500/10 border-yellow-500/50 hover:bg-yellow-500/20"
      >
        <RotateCcw className="h-4 w-4" />
        Сбросить онбординг
      </Button>
    </div>
  );
}
