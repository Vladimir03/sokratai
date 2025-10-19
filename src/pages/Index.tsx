import { useEffect, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, BookOpen, TrendingUp, Zap, Target, Trophy } from "lucide-react";

// Lazy load below-the-fold sections
const FeaturesSection = lazy(() => import("@/components/sections/FeaturesSection"));
const BenefitsSection = lazy(() => import("@/components/sections/BenefitsSection"));
const CTASection = lazy(() => import("@/components/sections/CTASection"));

const Index = () => {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Динамический импорт Supabase для уменьшения начального bundle
    import("@/integrations/supabase/client").then(({ supabase }) => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setIsAuthenticated(!!session);
      });
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
      <section className="relative overflow-hidden bg-gradient-hero py-20 px-4">
        <div className="container mx-auto text-center relative z-10">
          <div className="inline-block mb-4 px-4 py-2 bg-accent/20 rounded-full">
            <span className="text-accent font-semibold">🚀 Новое поколение подготовки к ЕГЭ</span>
          </div>
          <h1 
            className="text-5xl md:text-7xl font-bold text-primary-foreground mb-6"
            {...({ fetchpriority: "high" } as any)}
          >
            Твой личный ИИ-репетитор<br />по математике 24/7
          </h1>
          <p className="text-xl text-primary-foreground/90 mb-8 max-w-2xl mx-auto">
            Готовься к ЕГЭ с искусственным интеллектом: мгновенные решения, понятные объяснения, отслеживание прогресса
          </p>
          <Button 
            size="lg" 
            className="bg-accent hover:bg-accent/90 text-accent-foreground shadow-glow animate-scale-in text-lg px-8 py-6"
            onClick={() => navigate(isAuthenticated ? "/chat" : "/signup")}
          >
            {isAuthenticated ? "Начать обучение" : "Начать бесплатно"}
          </Button>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute top-20 left-10 w-20 h-20 bg-accent/20 rounded-full blur-xl animate-pulse" />
        <div className="absolute bottom-20 right-10 w-32 h-32 bg-primary-glow/20 rounded-full blur-2xl animate-pulse" />
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
