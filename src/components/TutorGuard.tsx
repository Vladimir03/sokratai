import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface TutorGuardProps {
  children: React.ReactNode;
}

const TutorGuard = ({ children }: TutorGuardProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkAccess = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/login");
        return;
      }

      // Retry logic with increasing delays for role propagation and unstable connections
      const delays = [0, 1000, 2000, 3000]; // First attempt immediate, then 1s, 2s, 3s
      let isTutor = false;
      let lastError = null;

      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) {
          await new Promise(r => setTimeout(r, delays[i]));
        }

        const { data, error } = await supabase.rpc("is_tutor", {
          _user_id: session.user.id
        });

        if (!error && data) {
          isTutor = true;
          lastError = null;
          break;
        }

        lastError = error;
        if (!error && !data && i < delays.length - 1) {
          console.log(`TutorGuard: is_tutor returned false, retrying (${i + 1}/${delays.length})...`);
        }
      }

      if (lastError) {
        console.error("Error checking tutor role after retries:", lastError);
        setError("Ошибка проверки доступа. Проверьте соединение.");
        setLoading(false);
        return;
      }

      if (!isTutor) {
        navigate("/register-tutor");
        return;
      }

      setAuthorized(true);
    } catch (error) {
      console.error("Error in TutorGuard:", error);
      setError("Ошибка соединения. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    checkAccess();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        navigate("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, checkAccess]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <Button onClick={checkAccess} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return <>{children}</>;
};

export default TutorGuard;
