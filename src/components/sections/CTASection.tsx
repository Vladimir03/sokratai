import { Button } from "@/components/ui/button";

interface CTASectionProps {
  isAuthenticated: boolean;
  onNavigate: () => void;
}

const CTASection = ({ isAuthenticated, onNavigate }: CTASectionProps) => {
  return (
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
          onClick={onNavigate}
        >
          {isAuthenticated ? "Перейти к обучению" : "Зарегистрироваться бесплатно"}
        </Button>
      </div>
    </section>
  );
};

export default CTASection;
