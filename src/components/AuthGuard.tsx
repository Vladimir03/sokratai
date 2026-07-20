import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { claimPendingInvite } from "@/lib/inviteApi";
import { applyPendingConsent } from "@/lib/consent";
import Navigation from "./Navigation";
import OnboardingModal from "./OnboardingModal";

/**
 * `fullBleed` rendering modes:
 * - `true` — no `<Navigation />`, no padding wrapper at any viewport.
 *   Mobile-first full-bleed screens (`HomeworkProblem` Phase 1).
 * - `'below-xl'` — no chrome on `<1280px` (mobile + tablet); regular
 *   `<Navigation />` + `xl:pt-14` wrapper on `≥1280px` (desktop). Used by
 *   Phase 3 split-layout where tablet has its own breadcrumb topbar but
 *   desktop shows the global tabs. Padding-top 56px matches Navigation
 *   `h-14`; consumer is responsible for height accounting (e.g.
 *   `xl:h-[calc(var(--vv-h,100vh)-56px)]` — `100vh` fallback chosen over
 *   `100dvh` for Safari 15.0–15.3 compat; see `HomeworkProblem.tsx`).
 * - `false` / undefined — default. `<Navigation />` + `pt-14 pb-20` wrapper
 *   at all viewports.
 *
 * Auth check (redirect to `/login` if no session) fires in all modes.
 * **OnboardingModal is intentionally suppressed in `fullBleed=true` and
 * `'below-xl'` modes** — these surfaces are student-first homework UX
 * where blocking onboarding modal interrupts task solving (preview-QA #10
 * product decision 2026-05-11). Only the default mode (no `fullBleed` /
 * `false`) renders the modal.
 *
 * Codex re-review #3 (2026-05-09): the `/student/homework/:hwId/problem/
 * :taskId` route was previously mounted outside any auth guard, so a direct
 * unauthenticated URL got the page's generic "Не удалось загрузить задачу"
 * instead of the standard auth redirect.
 */
type FullBleedScope = boolean | 'below-xl';

interface AuthGuardProps {
  children: React.ReactNode;
  fullBleed?: FullBleedScope;
}

const AuthGuard = ({ children, fullBleed = false }: AuthGuardProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const claimAttempted = useRef(false);
  const sessionHandled = useRef(false);

  useEffect(() => {
    // RU OAuth bypass (2026-05-16): custom oauth-google-callback edge function
    // returns `redirectTo#access_token=...&refresh_token=...&type=signup`.
    // supabase-js parses URL hash asynchronously and emits `INITIAL_SESSION`
    // event with the parsed session. If we call `getSession()` synchronously
    // on mount BEFORE the hash parse completes, we get null → navigate("/login")
    // → user sees the same signup form → clicks Google again → infinite loop.
    //
    // Fix: wait for `INITIAL_SESSION` event (fires exactly once on init, with
    // session=null OR session=<parsed>). Process auth decision only there.
    // `SIGNED_IN` follows for explicit logins (email/Telegram polling
    // setSession). `SIGNED_OUT` invalidates state and forces login redirect.

    const handleSession = async (session: Session | null) => {
      if (sessionHandled.current) return;
      sessionHandled.current = true;

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
        // Flush согласия, stash-нутого перед OAuth-редиректом (ревью 5.6 P1 #5):
        // возврат Яндекс/VK приземляется на student-поверхности (/student/schedule
        // и др.), где локального листенера нет — без flush'а consent-audit
        // оставался пустым. Идемпотентно (no-op без stashed intent), non-blocking.
        void applyPendingConsent(session.user.id);
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
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION: fires once after hash-token parse — our primary auth
      // entry point. SIGNED_IN: fires after explicit setSession()/verifyOtp.
      // Both should hydrate this guard. SIGNED_OUT: nuke session and bounce.
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        void handleSession(session);
      } else if (event === "SIGNED_OUT") {
        sessionHandled.current = false;
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

  if (fullBleed === true) {
    // Preview-QA #10 (2026-05-11): suppress OnboardingModal на fullBleed
    // routes. Vladimir's product decision — «не блокировать ученика
    // onboarding modal: если переходит в ДЗ, пусть сразу решает».
    // Mobile homework problem screen — student-first UX, onboarding
    // не должен gate'ить эту поверхность. Если onboarding критичен —
    // Phase 2 добавит soft prompt после первого submission или
    // tutor-side enforcement.
    return <>{children}</>;
  }

  if (fullBleed === 'below-xl') {
    // Phase 3 split-layout: tablet (<1280) — full-bleed, desktop (≥1280) —
    // global `<Navigation />` shown. Same onboarding-suppress rationale as
    // above (homework is student-first surface). Children handle their own
    // height accounting (e.g. `h-[var(--vv-h,100dvh)] xl:h-[calc(100dvh-56px)]`)
    // since `xl:pt-14` only pushes content below the fixed nav, it does
    // not shrink children's explicit height.
    return (
      <>
        <div className="hidden xl:block">
          <Navigation />
        </div>
        <div className="xl:pt-14">
          {children}
        </div>
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
