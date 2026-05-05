import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";

const TutorSignupTrial = lazy(() => import("./TutorSignupTrial"));
const SignUp = lazy(() => import("./SignUp"));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="flex space-x-2">
      <div className="w-3 h-3 bg-primary rounded-full animate-bounce" />
      <div
        className="w-3 h-3 bg-primary rounded-full animate-bounce"
        style={{ animationDelay: "0.2s" }}
      />
      <div
        className="w-3 h-3 bg-primary rounded-full animate-bounce"
        style={{ animationDelay: "0.4s" }}
      />
    </div>
  </div>
);

export default function SignupRouter() {
  const [params] = useSearchParams();
  const isTutorTrial =
    params.get("ref") === "tutor-landing" || params.get("trial") === "7";

  return (
    <Suspense fallback={<PageLoader />}>
      {isTutorTrial ? <TutorSignupTrial /> : <SignUp />}
    </Suspense>
  );
}
