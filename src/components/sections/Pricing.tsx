import { Button } from "@/components/ui/button";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PricingProps {
  onNavigate: () => void;
}

const Pricing = ({ onNavigate }: PricingProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = 450;
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <section className="py-20 px-4 bg-muted/30" id="pricing">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          💎 Начни понимать математику, физику или информатику уже сегодня
        </h2>

        {/* Pricing Wrapper with Scroll */}
        <div className="relative my-10">
          {/* Navigation Arrows - Now visible on mobile too */}
          <button
            onClick={() => scroll('left')}
            className="flex absolute left-0 md:left-0 top-1/2 -translate-y-1/2 -translate-x-3 md:-translate-x-6 z-10 w-10 h-10 md:w-12 md:h-12 items-center justify-center rounded-full bg-background border-2 border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all shadow-lg"
            aria-label="Предыдущий тариф"
          >
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
          </button>
          
          <button
            onClick={() => scroll('right')}
            className="flex absolute right-0 md:right-0 top-1/2 -translate-y-1/2 translate-x-3 md:translate-x-6 z-10 w-10 h-10 md:w-12 md:h-12 items-center justify-center rounded-full bg-background border-2 border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all shadow-lg"
            aria-label="Следующий тариф"
          >
            <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Scrollable Container */}
          <div
            ref={scrollContainerRef}
            className="flex gap-8 overflow-x-auto scroll-smooth py-5 px-2 scrollbar-thin scrollbar-thumb-accent scrollbar-track-muted"
            style={{ scrollbarWidth: 'thin' }}
          >
            {/* Tier 1: FREE */}
            <div className="bg-background rounded-2xl p-8 md:p-10 shadow-2xl border-2 border-border flex-shrink-0 w-[320px] md:w-[400px]">
              <h3 className="text-2xl font-bold mb-2 text-primary">🎁 Попробуй бесплатно</h3>
              <p className="text-lg mb-6 text-muted-foreground">Без карты. Без обязательств.</p>
              
              <div className="text-5xl md:text-6xl font-bold my-6 text-primary">
                0₽<span className="text-xl md:text-2xl opacity-80 font-semibold">/месяц</span>
              </div>
              
              <p className="mb-8 text-lg text-muted-foreground">
                Отлично для знакомства с Сократом!
              </p>
              
              <ul className="space-y-3 mb-8 text-foreground">
                {[
                  "10 сообщений в день",
                  "Вопросы-подсказки вместо готовых ответов",
                  "Несколько способов решения задач",
                  "Работа на компьютере и телефоне",
                  "Мультичаты по предметам (математика, физика, информатика)"
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-accent mr-2 font-bold text-xl">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              
              <Button 
                size="lg"
                className="w-full bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-6"
                onClick={onNavigate}
              >
                Начать бесплатно
              </Button>
            </div>

            {/* Tier 2: 699₽ - Popular */}
            <div className="bg-primary rounded-2xl p-8 md:p-10 shadow-2xl text-white flex-shrink-0 w-[320px] md:w-[400px] relative">
              {/* Popular Badge */}
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground px-6 py-2 rounded-full font-bold text-sm uppercase tracking-wide shadow-lg">
                Популярно
              </div>
              
              <h3 className="text-2xl font-bold mb-2">🚀 Безлимитное обучение</h3>
              <p className="text-lg mb-6 opacity-90">7 дней бесплатно. Без карты. Без обязательств.</p>
              
              <div className="text-5xl md:text-6xl font-bold my-6">
                699₽<span className="text-xl md:text-2xl opacity-80 font-semibold">/месяц</span>
              </div>
              
              <p className="mb-6 text-lg">
                Это всего <strong>23₽ в день</strong> — дешевле кофе!
              </p>
              
              <p className="mb-4 text-lg leading-relaxed">
                Все из FREE, <strong className="text-xl">ПЛЮС:</strong>
              </p>
              
              <ul className="space-y-3 mb-8">
                {[
                  "НЕОГРАНИЧЕННОЕ количество сообщений",
                  "Генерация похожих задач для практики",
                  "Диагностика проблем из прошлых классов",
                  "Детальный прогресс по кодификатору ЕГЭ"
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-accent mr-2 font-bold text-xl">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              
              <Button 
                size="lg"
                className="w-full bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-6"
                onClick={onNavigate}
              >
                ✍️ Попробовать бесплатно
              </Button>
              
              <p className="mt-5 text-sm opacity-90 text-center">
                Отмена в любой момент. Никаких скрытых платежей.
              </p>
            </div>

            {/* Tier 3: PRO - 1399₽ */}
            <div className="bg-background rounded-2xl p-8 md:p-10 shadow-2xl border-2 border-border flex-shrink-0 w-[320px] md:w-[400px]">
              <h3 className="text-2xl font-bold mb-2 text-primary">💎 ИИ-помощник Сократ + Репетитор</h3>
              <p className="text-lg mb-6 text-muted-foreground">Максимальный результат на ЕГЭ!</p>
              
              <div className="text-5xl md:text-6xl font-bold my-6 text-primary">
                1399₽<span className="text-xl md:text-2xl opacity-80 font-semibold">/месяц</span>
              </div>
              
              <p className="mb-6 text-lg text-muted-foreground">
                Это <strong>47₽ в день</strong> — цена качественного образования!
              </p>
              
              <p className="mb-4 text-lg leading-relaxed text-foreground">
                Все из Популярного, <strong className="text-xl">ПЛЮС:</strong>
              </p>
              
              <ul className="space-y-3 mb-6 text-foreground">
                {[
                  "1 час занятия с Репетитором",
                  "Настройка ИИ-помощника под твои цели"
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-accent mr-2 font-bold text-xl">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              
              <p className="mb-8 text-base leading-relaxed text-muted-foreground italic">
                ⚡ Репетитор проведет занятие, а также поможет с настройкой ИИ-помощника под твои цели в учебе. 
                Можно договориться на последующие занятия, если все понравится!
              </p>
              
              <Button 
                size="lg"
                className="w-full bg-accent hover:bg-accent/90 text-accent-foreground text-lg py-6"
                onClick={onNavigate}
              >
                Связаться с нами
              </Button>
            </div>
          </div>
        </div>

        {/* Price Comparison Box */}
        <div className="text-center mt-12">
          <div className="inline-block bg-background rounded-2xl p-8 md:p-12 shadow-elegant">
            <h3 className="text-2xl font-bold mb-6 text-primary-variant">💰 Сравни:</h3>
            <div className="space-y-3 text-lg">
              <p className="text-muted-foreground">
                <span className="line-through">Telegram Premium: 300₽/мес</span> → только эмодзи
              </p>
              <p className="text-muted-foreground">
                <span className="line-through">Netflix: 500₽/мес</span> → развлечение
              </p>
              <p className="text-accent font-bold text-2xl mt-4">
                Сократ: от 0₽/мес → твое образование и будущее! 🎓
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Pricing;