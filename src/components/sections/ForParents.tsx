import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ForParentsProps {
  onNavigate: () => void;
}

const ForParents = ({ onNavigate }: ForParentsProps) => {
  return (
    <section className="py-20 px-4 bg-muted/30">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          🎓 Для родителей
        </h2>

        <div className="max-w-4xl mx-auto">
          <Card className="mb-8">
            <CardContent className="pt-6">
              <h3 className="text-2xl font-bold mb-6 text-primary">Почему стоит попробовать:</h3>
              <ul className="space-y-4 text-lg">
                <li className="flex items-start">
                  <span className="text-accent mr-3 text-2xl">✅</span>
                  <span>
                    <strong>Видимый прогресс:</strong> Вы увидите улучшение оценок за 2-3 месяца
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-accent mr-3 text-2xl">✅</span>
                  <span>
                    <strong>Самостоятельность:</strong> Ребенок учится решать проблемы сам
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-accent mr-3 text-2xl">✅</span>
                  <span>
                    <strong>Доступная цена:</strong> 399₽/мес вместо 5,000-20,000₽ за репетитора
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-accent mr-3 text-2xl">✅</span>
                  <span>
                    <strong>Безопасность:</strong> Ребенок учится дома, без посторонних людей
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="text-accent mr-3 text-2xl">✅</span>
                  <span>
                    <strong>Без стресса:</strong> Никто не увидит ошибки ребенка, только ИИ
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Parent Testimonial */}
          <div className="bg-background border-l-4 border-accent p-6 md:p-8 rounded-lg shadow-elegant mb-8">
            <p className="text-lg italic text-foreground mb-4">
              "Мама оценки смотрит каждый день, проверяет, она даже мб расстраивается, когда у меня плохая оценка. И она пытается понять, почему у меня такая оценка!... Родители, когда увидели этот прогресс им стало приятно, так как я сама таким образом занимаюсь!"
            </p>
            <div className="font-bold" style={{ color: "hsl(231, 36%, 29%)" }}>Маша, 10 класс</div>
            <div className="text-amber-500 mt-2">⭐⭐⭐⭐⭐</div>
          </div>

          {/* CTA */}
          <div className="text-center">
            <p className="text-xl mb-6 text-foreground">
              <strong>Попробуйте 7 дней бесплатно</strong> и увидьте разницу сами
            </p>
            <Button 
              size="lg"
              className="bg-accent hover:bg-accent/90 text-accent-foreground text-lg px-12 py-6"
              onClick={onNavigate}
            >
              Начать бесплатный пробный период
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ForParents;
