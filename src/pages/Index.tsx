import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

// Lazy load sections
const SpecialOffer = lazy(() => import("@/components/sections/SpecialOffer"));
const ValueProposition = lazy(() => import("@/components/sections/ValueProposition"));
const AhaMoments = lazy(() => import("@/components/sections/AhaMoments"));
const Problems = lazy(() => import("@/components/sections/Problems"));
const HowItWorks = lazy(() => import("@/components/sections/HowItWorks"));
const Results = lazy(() => import("@/components/sections/Results"));
const Testimonials = lazy(() => import("@/components/sections/Testimonials"));
const Comparison = lazy(() => import("@/components/sections/Comparison"));
const Pricing = lazy(() => import("@/components/sections/Pricing"));
const FAQ = lazy(() => import("@/components/sections/FAQ"));
const ForParents = lazy(() => import("@/components/sections/ForParents"));
const Footer = lazy(() => import("@/components/sections/Footer"));

const Index = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });
  }, []);

  const handleNavigate = () => {
    navigate(isAuthenticated ? "/chat" : "/signup");
  };

  return (
    <div className="min-h-screen">
      {/* Special Offer Banner */}
      <Suspense fallback={<div className="h-16 bg-muted animate-pulse" />}>
        <SpecialOffer />
      </Suspense>

      {/* Navigation Tabs */}
      <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="container mx-auto">
          <div className="flex overflow-x-auto scrollbar-hide">
            <a href="#hero" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              Главная
            </a>
            <a href="#benefits" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              Преимущества
            </a>
            <a href="#how-it-works" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              Как работает
            </a>
            <a href="#results" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              Результаты
            </a>
            <a href="#testimonials" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              Отзывы
            </a>
            <a href="#pricing" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              Цены
            </a>
            <a href="#faq" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              FAQ
            </a>
            <a href="#for-parents" className="px-4 py-3 text-sm font-medium whitespace-nowrap hover:text-primary transition-colors">
              Для родителей
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section id="hero" className="relative overflow-hidden bg-gradient-hero py-16 px-4 md:py-24">
        <div className="container mx-auto relative z-10">
          <div className="flex flex-col items-start max-w-4xl">
            {/* Logo and brand */}
            <div className="flex items-center gap-6 mb-8">
              <svg className="w-20 h-20 md:w-24 md:h-24 flex-shrink-0" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                {/* First bubble (question) */}
                <path d="M 15 25 Q 15 15 25 15 L 45 15 Q 55 15 55 25 L 55 40 Q 55 50 45 50 L 30 50 L 20 60 L 20 50 Q 15 50 15 40 Z" 
                      fill="#10b981" opacity="0.9"/>
                <text x="35" y="37" fontFamily="Manrope, sans-serif" fontSize="20" fontWeight="bold" fill="white" textAnchor="middle">?</text>
                
                {/* Second bubble (understanding/lightbulb) */}
                <path d="M 45 55 Q 45 45 55 45 L 75 45 Q 85 45 85 55 L 85 70 Q 85 80 75 80 L 60 80 L 80 90 L 60 90 Q 45 90 45 80 Z" 
                      fill="white" opacity="0.95"/>
                <text x="65" y="67" fontFamily="Manrope, sans-serif" fontSize="20" fontWeight="bold" fill="#2d3561" textAnchor="middle">💡</text>
              </svg>
              <div className="flex flex-col">
                <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground">
                  Сократ
                </h2>
              </div>
            </div>

            {/* Main headline */}
            <h1 
              className="text-3xl md:text-5xl font-bold text-primary-foreground mb-6 leading-tight"
              {...({ fetchpriority: "high" } as any)}
            >
              🎯 ИИ-помощник по математике, физике и информатике, который учит тебя думать и понимать самостоятельно
            </h1>
            
            {/* Subheadline */}
            <p className="text-lg md:text-xl text-primary-foreground/90 mb-8 max-w-2xl">
              Для тех, кто готовится к ОГЭ/ЕГЭ и хочет понимать математику, физику и информатику, а не просто списывать
            </p>

            {/* CTA Button */}
            <Button 
              size="lg" 
              className="bg-accent hover:bg-accent/90 text-accent-foreground shadow-glow text-base md:text-lg px-8 py-6 rounded-2xl font-semibold transition-all hover:scale-105"
              onClick={handleNavigate}
            >
              🚀 Попробовать бесплатно
            </Button>
          </div>
        </div>
        
        {/* Subtle decorative gradient overlays */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-accent/10 rounded-full blur-3xl opacity-30" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary-glow/10 rounded-full blur-3xl opacity-20" />
      </section>

      {/* Lazy load all sections */}
      <div id="benefits">
        <Suspense fallback={<div className="py-20 bg-muted animate-pulse" style={{ height: "400px" }} />}>
          <ValueProposition />
        </Suspense>
        
        <Suspense fallback={<div className="py-20 animate-pulse" style={{ height: "500px" }} />}>
          <AhaMoments />
        </Suspense>
        
        <Suspense fallback={<div className="py-20 bg-muted animate-pulse" style={{ height: "400px" }} />}>
          <Problems />
        </Suspense>
      </div>
      
      <div id="how-it-works">
        <Suspense fallback={<div className="py-20 animate-pulse" style={{ height: "500px" }} />}>
          <HowItWorks />
        </Suspense>
      </div>
      
      <div id="results">
        <Suspense fallback={<div className="py-20 bg-muted animate-pulse" style={{ height: "400px" }} />}>
          <Results />
        </Suspense>
      </div>
      
      <div id="testimonials">
        <Suspense fallback={<div className="py-20 animate-pulse" style={{ height: "500px" }} />}>
          <Testimonials />
        </Suspense>
      </div>
      
      <Suspense fallback={<div className="py-20 bg-muted animate-pulse" style={{ height: "600px" }} />}>
        <Comparison />
      </Suspense>
      
      <div id="pricing">
        <Suspense fallback={<div className="py-20 animate-pulse" style={{ height: "700px" }} />}>
          <Pricing onNavigate={handleNavigate} />
        </Suspense>
      </div>
      
      <div id="faq">
        <Suspense fallback={<div className="py-20 bg-muted animate-pulse" style={{ height: "400px" }} />}>
          <FAQ />
        </Suspense>
      </div>
      
      <div id="for-parents">
        <Suspense fallback={<div className="py-20 animate-pulse" style={{ height: "500px" }} />}>
          <ForParents onNavigate={handleNavigate} />
        </Suspense>
      </div>
      
      <Suspense fallback={<div className="py-20 bg-muted animate-pulse" style={{ height: "300px" }} />}>
        <Footer />
      </Suspense>
    </div>
  );
};

export default Index;
