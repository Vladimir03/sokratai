import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

interface TutorGuardProps {
  children: React.ReactNode;
}

const TutorGuard = ({ children }: TutorGuardProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          navigate("/login");
          return;
        }

        // Check if user has tutor role
        const { data: isTutor, error } = await supabase.rpc("is_tutor", { 
          _user_id: session.user.id 
        });

        if (error) {
          console.error("Error checking tutor role:", error);
          navigate("/");
          return;
        }

        if (!isTutor) {
          navigate("/");
          return;
        }

        setAuthorized(true);
      } catch (error) {
        console.error("Error in TutorGuard:", error);
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    checkAccess();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        navigate("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

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

  if (!authorized) {
    return null;
  }

  return <>{children}</>;
};

export default TutorGuard;
