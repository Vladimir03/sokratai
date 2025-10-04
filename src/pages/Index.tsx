import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, BookOpen, TrendingUp, Zap, Target, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
      <section className="relative overflow-hidden bg-gradient-hero py-20 px-4">
        <div className="container mx-auto text-center relative z-10">
          <div className="inline-block mb-4 px-4 py-2 bg-accent/20 rounded-full">
            <span className="text-accent font-semibold">🚀 Новое поколение подготовки к ЕГЭ</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold text-primary-foreground mb-6 animate-fade-in">
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

      {/* Features Section */}
      <section className="py-20 px-4 bg-background">
        <div className="container mx-auto">
          <h2 className="text-4xl font-bold text-center mb-12">
            Почему выбирают нас?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Card 
                  key={index} 
                  className="group hover:shadow-elegant transition-all duration-300 hover:-translate-y-2"
                >
                  <CardContent className="pt-6">
                    <div className="w-12 h-12 bg-gradient-hero rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Icon className="w-6 h-6 text-primary-foreground" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <h2 className="text-4xl font-bold text-center mb-12">
            Преимущества платформы
          </h2>
          <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {benefits.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <div key={index} className="text-center">
                  <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mx-auto mb-4">
                    <Icon className="w-8 h-8 text-accent-foreground" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">{benefit.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-gradient-hero">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl font-bold text-primary-foreground mb-6">
            Готов начать подготовку?
          </h2>
          <p className="text-xl text-primary-foreground/90 mb-8">
            Присоединяйся к тысячам учеников, которые уже повысили свои баллы
          </p>
          <Button 
            size="lg" 
            className="bg-accent hover:bg-accent/90 text-accent-foreground shadow-glow text-lg px-8 py-6"
            onClick={() => navigate(isAuthenticated ? "/chat" : "/signup")}
          >
            {isAuthenticated ? "Перейти к обучению" : "Зарегистрироваться бесплатно"}
          </Button>
        </div>
      </section>
    </div>
  );
};

export default Index;
