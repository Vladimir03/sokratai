import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { claimPendingInvite } from "@/lib/inviteApi";
import Navigation from "./Navigation";
import OnboardingModal from "./OnboardingModal";

interface AuthGuardProps {
  children: React.ReactNode;
  /**
   * When `true`, skip the global `<Navigation />` chrome and the surrounding
   * `pt-14 pb-20` padding wrapper. The student `HomeworkProblem` mobile
   * screen owns its own full-bleed (`100dvh`) layout — wrapping it in the
   * default chrome eats the topbar and adds dead space at the bottom.
   *
   * Auth check (redirect to `/login` if no session) and the onboarding
   * modal continue to fire — only chrome rendering is opted out.
   *
   * Codex re-review #3 (2026-05-09): the `/student/homework/:hwId/problem/
   * :taskId` route was previously mounted outside any auth guard, so a
   * direct unauthenticated URL got the page's generic "Не удалось загрузить
   * задачу" instead of the standard auth redirect.
   */
  fullBleed?: boolean;
}

const AuthGuard = ({ children, fullBleed = false }: AuthGuardProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const claimAttempted = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        navigate("/login");
        return;
      }

      setUserId(session.user.id);

      // Claim pending invite if any (non-blocking, fire-once)
      if (!claimAttempted.current) {
        claimAttempted.current = true;
        claimPendingInvite().catch(() => {
          // Silently ignore — retriable errors stay in localStorage
        });
      }

      // Check onboarding status
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", session.user.id)
        .single();

      if (profile && !profile.onboarding_completed) {
        setShowOnboarding(true);
      }

      setLoading(false);
    });

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

  if (fullBleed) {
    return (
      <>
        <OnboardingModal
          open={showOnboarding}
          userId={userId}
          onComplete={() => setShowOnboarding(false)}
        />
        {children}
      </>
    );
  }

  return (
    <>
      <OnboardingModal
        open={showOnboarding}
        userId={userId}
        onComplete={() => setShowOnboarding(false)}
      />
      <Navigation />
      <div className="pt-14 pb-20 md:pb-4">
        {children}
      </div>
    </>
  );
};

export default AuthGuard;
