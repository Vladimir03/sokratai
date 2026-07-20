import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { lazy, Suspense } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import AuthGuard from "@/components/AuthGuard";

// Lazy load UI providers to reduce initial bundle
const LazyToaster = lazy(() => import("@/components/ui/toaster").then(m => ({ default: m.Toaster })));
const LazySonner = lazy(() => import("@/components/ui/sonner").then(m => ({ default: m.Toaster })));
const LazyTooltipProvider = lazy(() => import("@/components/ui/tooltip").then(m => ({ default: m.TooltipProvider })));

// Lazy load analytics tracker
const AnalyticsTracker = lazy(() => import("@/components/AnalyticsTracker"));

// Lazy load Index page too - it's the landing page but still benefits from code splitting
const Index = lazy(() => import("./pages/Index"));
const StudentLanding = lazy(() => import("./pages/StudentLanding"));


// Lazy load all pages for optimal code splitting
const Login = lazy(() => import("./pages/Login"));
const TutorLogin = lazy(() => import("./pages/TutorLogin"));
const SignUp = lazy(() => import("./pages/SignUp"));
const SignupRouter = lazy(() => import("./pages/SignupRouter"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Chat = lazy(() => import("./pages/Chat"));
const StudentHomework = lazy(() => import("./pages/StudentHomework"));
const StudentHomeworkDetail = lazy(() => import("./pages/StudentHomeworkDetail"));
const StudentSchedule = lazy(() => import("./pages/StudentSchedule"));
const LessonDetail = lazy(() => import("./pages/student/LessonDetail"));
// Phase 1 student homework problem screen — production data via
// `useStudentProblemTask`. Mounted under <AuthGuard fullBleed> below so
// the mobile-first 100dvh layout is preserved while still requiring a
// session. Updated 2026-05-09 (codex re-review #3) — was previously
// mock-only and outside AuthGuard during TASK-7 mock validation.
const HomeworkProblem = lazy(() => import("./pages/student/HomeworkProblem"));
const StudentMockExams = lazy(() => import("./pages/student/StudentMockExams"));
const StudentMockExam = lazy(() => import("./pages/student/StudentMockExam"));
const StudentMockExamResult = lazy(() => import("./pages/student/StudentMockExamResult"));
const PublicHomeworkShare = lazy(() => import("./pages/PublicHomeworkShare"));
const PublicMockInvite = lazy(() => import("./pages/PublicMockInvite"));
const PublicMockResult = lazy(() => import("./pages/PublicMockResult"));
const PublicStudentReport = lazy(() => import("./pages/PublicStudentReport"));
const Progress = lazy(() => import("./pages/Progress"));
const Profile = lazy(() => import("./pages/Profile"));
const MiniApp = lazy(() => import("./pages/MiniApp"));
const MiniAppSolution = lazy(() => import("./pages/MiniAppSolution"));
const Admin = lazy(() => import("./pages/Admin"));
const RetentionAnalysis = lazy(() => import("./pages/RetentionAnalysis"));
const Requisites = lazy(() => import("./pages/Requisites"));
const Offer = lazy(() => import("./pages/Offer"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Practice = lazy(() => import("./pages/Practice"));
const Diagnostic = lazy(() => import("./pages/Diagnostic"));
const TrainerPage = lazy(() => import("./pages/TrainerPage"));
const RegisterTutor = lazy(() => import("./pages/RegisterTutor"));
const EgorLanding = lazy(() => import("./pages/EgorLanding"));
const TutorHome = lazy(() => import("./pages/tutor/TutorHome"));
const TutorChat = lazy(() => import("./pages/tutor/TutorChat"));
const TutorSchedule = lazy(() => import("./pages/tutor/TutorSchedule"));
const TutorStudents = lazy(() => import("./pages/tutor/TutorStudents"));
const TutorStudentProfile = lazy(() => import("./pages/tutor/TutorStudentProfile"));
const TutorPayments = lazy(() => import("./pages/tutor/TutorPayments"));
const TutorHomework = lazy(() => import("./pages/tutor/TutorHomework"));
const TutorHomeworkFolderPage = lazy(() => import("./pages/tutor/HomeworkFolderPage"));
const TutorHomeworkCreate = lazy(() => import("./pages/tutor/TutorHomeworkCreate"));
const TutorHomeworkDetail = lazy(() => import("./pages/tutor/TutorHomeworkDetail"));
const TutorHomeworkPreview = lazy(() => import("./pages/tutor/TutorHomeworkPreview"));
const TutorHomeworkTemplates = lazy(() => import("./pages/tutor/TutorHomeworkTemplates"));
const TutorMockExams = lazy(() => import("./pages/tutor/mock-exams/TutorMockExams"));
const TutorMockExamCreate = lazy(() => import("./pages/tutor/mock-exams/TutorMockExamCreate"));
const TutorMockExamVariantEditor = lazy(() => import("./pages/tutor/mock-exams/TutorMockExamVariantEditor"));
const TutorMockExamDetail = lazy(() => import("./pages/tutor/mock-exams/TutorMockExamDetail"));
const TutorMockExamReview = lazy(() => import("./pages/tutor/mock-exams/TutorMockExamReview"));
const TutorProfile = lazy(() => import("./pages/tutor/TutorProfile"));
const AppFrame = lazy(() =>
  import("./components/tutor/chrome/AppFrame").then((m) => ({ default: m.AppFrame })),
);

// Redirect legacy /tutor/homework/:id/results links (Telegram reminders,
// push notifications) to the unified Detail page.
function RedirectHomeworkResultsToDetail() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/tutor/homework/${id ?? ''}`} replace />;
}
// student-progress: «Прогресс» переехал во вкладку карточки ученика (UX-fix).
// Старый /progress deep-link → карточка (Прогресс — первая вкладка по умолчанию).
function RedirectStudentProgressToCard() {
  const { tutorStudentId } = useParams<{ tutorStudentId: string }>();
  return <Navigate to={`/tutor/students/${tutorStudentId ?? ''}`} replace />;
}
const RedirectTutorAssistant = lazy(() => import("./pages/RedirectTutorAssistant"));
const KnowledgeBasePage = lazy(() => import("./pages/tutor/knowledge/KnowledgeBasePage"));
const CatalogTopicPage = lazy(() => import("./pages/tutor/knowledge/CatalogTopicPage"));
const FolderPage = lazy(() => import("./pages/tutor/knowledge/FolderPage"));
const AiTaskLoaderPage = lazy(() => import("./pages/tutor/knowledge/AiTaskLoaderPage"));
const InvitePage = lazy(() => import("./pages/InvitePage"));
const StudentClaimPage = lazy(() => import("./pages/StudentClaimPage"));
const SetPasswordPage = lazy(() => import("./pages/SetPasswordPage"));
const BookLesson = lazy(() => import("./pages/BookLesson"));
const InstallApp = lazy(() => import("./pages/InstallApp"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));

// Simple loading fallback
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="flex space-x-2">
      <div className="w-3 h-3 bg-primary rounded-full animate-bounce" />
      <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
      <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.4s" }} />
    </div>
  </div>
);

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Suspense fallback={null}>
      <LazyTooltipProvider>
        <ErrorBoundary>
          <Suspense fallback={null}>
            <LazyToaster />
            <LazySonner />
          </Suspense>
          <BrowserRouter>
            <Suspense fallback={null}>
              <AnalyticsTracker />
            </Suspense>
            <Routes>
              <Route
                path="/"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <Index />
                  </Suspense>
                }
              />
            <Route
              path="/.lovable/oauth/consent"
              element={
                <Suspense fallback={<PageLoader />}>
                  <OAuthConsent />
                </Suspense>
              }
            />
            <Route
              path="/students"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentLanding />
                </Suspense>
              }
            />
            <Route path="/tutors" element={<Navigate to="/" replace />} />
            <Route
              path="/egor"
              element={
                <Suspense fallback={<PageLoader />}>
                  <EgorLanding />
                </Suspense>
              }
            />
            <Route
              path="/login"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Login />
                </Suspense>
              } 
            />
            <Route
              path="/tutor/login"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TutorLogin />
                </Suspense>
              }
            />
            <Route
              path="/signup"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SignupRouter />
                </Suspense>
              }
            />
            <Route 
              path="/forgot-password" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <ForgotPassword />
                </Suspense>
              } 
            />
            <Route 
              path="/reset-password" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <ResetPassword />
                </Suspense>
              } 
            />
            <Route 
              path="/chat"
              element={
                <Suspense fallback={<PageLoader />}>
                  <Chat />
                </Suspense>
              } 
            />
            <Route 
              path="/homework" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentHomework />
                </Suspense>
              } 
            />
            <Route
              path="/homework/:id"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentHomeworkDetail />
                </Suspense>
              }
            />
            {/* Phase 1 student homework problem screen — production data
                via `useStudentProblemTask`. Auth-gated with `fullBleed`
                (skips global Navigation chrome) so the mobile-first
                100dvh layout is preserved while still redirecting
                unauthenticated direct loads to /login. Codex re-review #3
                (2026-05-09): previously mounted outside AuthGuard, which
                let direct URL probes surface the page's generic API
                error instead of the standard auth redirect. */}
            <Route
              path="/student/homework/:hwId/problem/:taskId"
              element={
                <AuthGuard fullBleed="below-xl">
                  <Suspense fallback={<PageLoader />}>
                    <HomeworkProblem />
                  </Suspense>
                </AuthGuard>
              }
            />
            <Route
              path="/student/schedule"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentSchedule />
                </Suspense>
              }
            />
            <Route
              path="/student/schedule/:lessonId"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LessonDetail />
                </Suspense>
              }
            />
            <Route
              path="/student/mock-exams"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentMockExams />
                </Suspense>
              }
            />
            <Route
              path="/student/mock-exams/:id/result"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentMockExamResult />
                </Suspense>
              }
            />
            <Route
              path="/student/mock-exams/:id"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentMockExam />
                </Suspense>
              }
            />
            <Route
              path="/p/mock-invite/:slug"
              element={
                <Suspense fallback={<PageLoader />}>
                  <PublicMockInvite />
                </Suspense>
              }
            />
            <Route
              path="/p/mock-result/:slug"
              element={
                <Suspense fallback={<PageLoader />}>
                  <PublicMockResult />
                </Suspense>
              }
            />
            <Route
              path="/p/report/:slug"
              element={
                <Suspense fallback={<PageLoader />}>
                  <PublicStudentReport />
                </Suspense>
              }
            />
            <Route
              path="/p/:slug"
              element={
                <Suspense fallback={<PageLoader />}>
                  <PublicHomeworkShare />
                </Suspense>
              }
            />
            <Route 
              path="/practice" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Practice />
                </Suspense>
              } 
            />
            <Route 
              path="/diagnostic" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Diagnostic />
                </Suspense>
              } 
            />
            <Route
              path="/trainer"
              element={
                <Suspense fallback={<div className="min-h-[100dvh] grid place-items-center text-slate-500">Загрузка…</div>}>
                  <TrainerPage />
                </Suspense>
              }
            />
            <Route 
              path="/progress" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Progress />
                </Suspense>
              } 
            />
            <Route 
              path="/profile" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Profile />
                </Suspense>
              } 
            />
            <Route 
              path="/miniapp" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <MiniApp />
                </Suspense>
              } 
            />
            <Route 
              path="/miniapp/solution/:id" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <MiniAppSolution />
                </Suspense>
              } 
            />
            <Route 
              path="/admin" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Admin />
                </Suspense>
              } 
            />
            <Route 
              path="/retention-analysis" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <RetentionAnalysis />
                </Suspense>
              } 
            />
            <Route 
              path="/requisites" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Requisites />
                </Suspense>
              } 
            />
            <Route 
              path="/offer" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Offer />
                </Suspense>
              } 
            />
            <Route 
              path="/privacy-policy" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <PrivacyPolicy />
                </Suspense>
              } 
            />
            <Route 
              path="/register-tutor" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <RegisterTutor />
                </Suspense>
              } 
            />
            <Route
              path="/tutor"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AppFrame />
                </Suspense>
              }
            >
              <Route index element={<Navigate to="/tutor/home" replace />} />
              <Route path="home" element={<TutorHome />} />
              <Route path="dashboard" element={<Navigate to="/tutor/home" replace />} />
              <Route path="schedule" element={<TutorSchedule />} />
              <Route path="chat/:conversationId" element={<TutorChat />} />
              <Route path="chat" element={<TutorChat />} />
              <Route path="students" element={<TutorStudents />} />
              <Route path="students/:tutorStudentId/progress" element={<RedirectStudentProgressToCard />} />
              <Route path="students/:tutorStudentId" element={<TutorStudentProfile />} />
              <Route path="payments" element={<TutorPayments />} />
              <Route path="profile" element={<TutorProfile />} />
              <Route path="homework/templates" element={<TutorHomeworkTemplates />} />
              <Route path="homework/create" element={<TutorHomeworkCreate />} />
              <Route path="homework/:id/edit" element={<TutorHomeworkCreate />} />
              <Route path="homework/:id/preview" element={<TutorHomeworkPreview />} />
              <Route path="homework/:id/results" element={<RedirectHomeworkResultsToDetail />} />
              {/* folder/:folderId ДО :id — иначе "folder" захватится как :id. */}
              <Route path="homework/folder/:folderId" element={<TutorHomeworkFolderPage />} />
              <Route path="homework/:id" element={<TutorHomeworkDetail />} />
              <Route path="homework" element={<TutorHomework />} />
              <Route path="mock-exams/new" element={<TutorMockExamCreate />} />
              {/* Фаза 2 (2026-07-20): конструктор своих вариантов пробника */}
              <Route path="mock-exams/variants/new" element={<TutorMockExamVariantEditor />} />
              <Route path="mock-exams/variants/:id/edit" element={<TutorMockExamVariantEditor />} />
              <Route path="mock-exams/:id/review/:studentId" element={<TutorMockExamReview />} />
              <Route path="mock-exams/:id" element={<TutorMockExamDetail />} />
              <Route path="mock-exams" element={<TutorMockExams />} />
              <Route path="assistant" element={<RedirectTutorAssistant />} />
              <Route path="knowledge/topic/:topicId" element={<CatalogTopicPage />} />
              <Route path="knowledge/ai-loader" element={<AiTaskLoaderPage />} />
              <Route path="knowledge/folder/:folderId" element={<FolderPage />} />
              <Route path="knowledge" element={<KnowledgeBasePage />} />
            </Route>
            <Route 
              path="/book/:bookingLink" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <BookLesson />
                </Suspense>
              } 
            />
            <Route
              path="/invite/:inviteCode"
              element={
                <Suspense fallback={<PageLoader />}>
                  <InvitePage />
                </Suspense>
              }
            />
            <Route
              path="/c/:token"
              element={
                <Suspense fallback={<PageLoader />}>
                  <StudentClaimPage />
                </Suspense>
              }
            />
            <Route
              path="/set-password"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SetPasswordPage />
                </Suspense>
              }
            />
            <Route
              path="/install"
              element={
                <Suspense fallback={<PageLoader />}>
                  <InstallApp />
                </Suspense>
              }
            />
            <Route
              path="*"
              element={
                <Suspense fallback={<PageLoader />}>
                  <NotFound />
                </Suspense>
              } 
            />
          </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </LazyTooltipProvider>
    </Suspense>
  </QueryClientProvider>
);

export default App;
