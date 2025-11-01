import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, BookOpen, TrendingUp, Zap, Target, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import sokratLogo from "@/assets/sokrat-logo.png";

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
            <div className="flex items-center gap-4 mb-8">
              <img src={sokratLogo} alt="Сократ логотип" className="w-16 h-16 md:w-20 md:h-20" />
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
