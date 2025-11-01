import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, BookOpen, TrendingUp, Zap, Target, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// Lazy load below-the-fold sections
const FeaturesSection = lazy(() => import("@/components/sections/FeaturesSection"));
const BenefitsSection = lazy(() => import("@/components/sections/BenefitsSection"));
const CTASection = lazy(() => import("@/components/sections/CTASection"));

const Index = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });
  }, []);

  const features = [
    {
      icon: MessageSquare,
      title: "ИИ-репетитор 24/7",
      description: "Получайте мгновенные объяснения любых задач с пошаговыми решениями",
    },
    {
      icon: BookOpen,
      title: "1000+ задач",
      description: "Практикуйтесь на реальных задачах ЕГЭ с детальными разборами",
    },
    {
      icon: TrendingUp,
      title: "Отслеживание прогресса",
      description: "Следите за своими успехами и видьте рост навыков в реальном времени",
    },
  ];

  const benefits = [
    {
      icon: Zap,
      title: "Быстрые ответы",
      description: "Получайте решения за секунды",
    },
    {
      icon: Target,
      title: "Персонализация",
      description: "Адаптивное обучение под ваш уровень",
    },
    {
      icon: Trophy,
      title: "Геймификация",
      description: "Зарабатывайте XP и значки",
    },
  ];

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-hero py-16 px-4 md:py-24">
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
                <p className="text-primary-foreground/80 text-sm md:text-base italic">
                  ИИ-помощник, который учит думать
                </p>
              </div>
            </div>

            {/* Main headline */}
            <h1 
              className="text-4xl md:text-6xl font-bold text-primary-foreground mb-6 leading-tight"
              {...({ fetchpriority: "high" } as any)}
            >
              Застрял на задаче? Задай вопрос, без стыда.
            </h1>
            
            {/* Subheadline */}
            <p className="text-lg md:text-xl text-primary-foreground/90 mb-8 max-w-2xl">
              Не даем готовые ответы. Помогаем понять через наводящие вопросы.
            </p>

            {/* CTA Button */}
            <Button 
              size="lg" 
              className="bg-accent hover:bg-accent/90 text-accent-foreground shadow-glow text-base md:text-lg px-8 py-6 rounded-2xl font-semibold transition-all hover:scale-105"
              onClick={() => navigate(isAuthenticated ? "/chat" : "/signup")}
            >
              🚀 Попробовать бесплатно 7 дней
            </Button>
          </div>
        </div>
        
        {/* Subtle decorative gradient overlays */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-accent/10 rounded-full blur-3xl opacity-30" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary-glow/10 rounded-full blur-3xl opacity-20" />
      </section>

      {/* Lazy load below-the-fold sections */}
      <Suspense fallback={<div className="py-20 skeleton" style={{ height: "400px" }} />}>
        <FeaturesSection features={features} />
      </Suspense>
      
      <Suspense fallback={<div className="py-20 skeleton" style={{ height: "300px" }} />}>
        <BenefitsSection benefits={benefits} />
      </Suspense>
      
      <Suspense fallback={<div className="py-20 skeleton" style={{ height: "250px" }} />}>
        <CTASection isAuthenticated={isAuthenticated} onNavigate={() => navigate(isAuthenticated ? "/chat" : "/signup")} />
      </Suspense>
    </div>
  );
};

export default Index;
