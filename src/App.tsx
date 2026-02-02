import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { useYandexMetrika } from "@/hooks/useYandexMetrika";
import ErrorBoundary from "@/components/ErrorBoundary";

import Index from "./pages/Index";

// Компонент для отслеживания аналитики (должен быть внутри BrowserRouter)
const AnalyticsTracker = () => {
  useYandexMetrika();
  return null;
};

// Lazy load all pages for optimal code splitting
const Login = lazy(() => import("./pages/Login"));
const SignUp = lazy(() => import("./pages/SignUp"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Chat = lazy(() => import("./pages/Chat"));
const Homework = lazy(() => import("./pages/Homework"));
const HomeworkAdd = lazy(() => import("./pages/HomeworkAdd"));
const HomeworkTaskList = lazy(() => import("./pages/HomeworkTaskList"));
const HomeworkTaskDetail = lazy(() => import("./pages/HomeworkTaskDetail"));
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
const RegisterTutor = lazy(() => import("./pages/RegisterTutor"));
const TutorDashboard = lazy(() => import("./pages/tutor/TutorDashboard"));
const TutorSchedule = lazy(() => import("./pages/tutor/TutorSchedule"));
const TutorStudents = lazy(() => import("./pages/tutor/TutorStudents"));
const TutorStudentProfile = lazy(() => import("./pages/tutor/TutorStudentProfile"));
const TutorPayments = lazy(() => import("./pages/tutor/TutorPayments"));
const InviteToTelegram = lazy(() => import("./pages/InviteToTelegram"));
const BookLesson = lazy(() => import("./pages/BookLesson"));

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
    <TooltipProvider>
      <ErrorBoundary>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AnalyticsTracker />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route 
              path="/login" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <Login />
                </Suspense>
              } 
            />
            <Route 
              path="/signup" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <SignUp />
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
                  <Homework />
                </Suspense>
              } 
            />
            <Route 
              path="/homework/add" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <HomeworkAdd />
                </Suspense>
              } 
            />
            <Route 
              path="/homework/:id" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <HomeworkTaskList />
                </Suspense>
              } 
            />
            <Route 
              path="/homework/:homeworkId/task/:taskId" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <HomeworkTaskDetail />
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
              path="/tutor/dashboard" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <TutorDashboard />
                </Suspense>
              } 
            />
            <Route 
              path="/tutor/schedule" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <TutorSchedule />
                </Suspense>
              } 
            />
            <Route 
              path="/tutor/students" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <TutorStudents />
                </Suspense>
              } 
            />
            <Route 
              path="/tutor/students/:tutorStudentId" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <TutorStudentProfile />
                </Suspense>
              } 
            />
            <Route 
              path="/tutor/payments" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <TutorPayments />
                </Suspense>
              } 
            />
            <Route 
              path="/tutor/schedule" 
              element={
                <Suspense fallback={<PageLoader />}>
                  <TutorSchedule />
                </Suspense>
              } 
            />
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
                  <InviteToTelegram />
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
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
