import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";

import Index from "./pages/Index";

// Lazy load all pages for optimal code splitting
const Login = lazy(() => import("./pages/Login"));
const SignUp = lazy(() => import("./pages/SignUp"));
const Chat = lazy(() => import("./pages/Chat"));
const Homework = lazy(() => import("./pages/Homework"));
const HomeworkAdd = lazy(() => import("./pages/HomeworkAdd"));
const HomeworkTaskList = lazy(() => import("./pages/HomeworkTaskList"));
const HomeworkTaskDetail = lazy(() => import("./pages/HomeworkTaskDetail"));
const Problems = lazy(() => import("./pages/Problems"));
const Progress = lazy(() => import("./pages/Progress"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));

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
      <Toaster />
      <Sonner />
      <BrowserRouter>
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
            path="/problems" 
            element={
              <Suspense fallback={<PageLoader />}>
                <Problems />
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
            path="*" 
            element={
              <Suspense fallback={<PageLoader />}>
                <NotFound />
              </Suspense>
            } 
          />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
