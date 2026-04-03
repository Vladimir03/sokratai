import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const Comparison = () => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const scrollAmount = 300;
      scrollContainerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <section className="py-20 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          Почему мы лучше других решений
        </h2>

        {/* Comparison Table with Scroll Navigation */}
        <div className="relative mb-12">
          {/* Navigation Arrows */}
          <button
            onClick={() => scroll("left")}
            className="flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 md:-translate-x-6 z-10 w-10 h-10 md:w-12 md:h-12 items-center justify-center rounded-full bg-background border-2 border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all shadow-lg"
            aria-label="Прокрутить влево"
          >
            <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <button
            onClick={() => scroll("right")}
            className="flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 md:translate-x-6 z-10 w-10 h-10 md:w-12 md:h-12 items-center justify-center rounded-full bg-background border-2 border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all shadow-lg"
            aria-label="Прокрутить вправо"
          >
            <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
          </button>

          {/* Scrollable Container */}
          <div
            ref={scrollContainerRef}
            className="overflow-x-auto scroll-smooth scrollbar-thin scrollbar-thumb-accent scrollbar-track-muted"
            style={{ scrollbarWidth: "thin" }}
          >
            <table className="w-full bg-background rounded-xl shadow-elegant overflow-hidden">
              <thead>
                <tr>
                  <th className="bg-primary text-primary-foreground p-4 md:p-5 text-left font-bold">Критерий</th>
                  <th className="bg-primary text-primary-foreground p-4 md:p-5 text-left font-bold">Репетитор</th>
                  <th className="bg-primary text-primary-foreground p-4 md:p-5 text-left font-bold">
                    ChatGPT/Deepseek
                  </th>
                  <th className="bg-accent text-accent-foreground p-4 md:p-5 text-left font-bold">Сократ AI</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="p-4 md:p-5 font-bold">Цена/месяц</td>
                  <td className="p-4 md:p-5">5,000-20,000₽</td>
                  <td className="p-4 md:p-5">Бесплатно / 2000₽</td>
                  <td className="p-4 md:p-5 font-bold text-accent">699₽</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="p-4 md:p-5 font-bold">Доступность</td>
                  <td className="p-4 md:p-5">1-2 раза в неделю</td>
                  <td className="p-4 md:p-5">24/7</td>
                  <td className="p-4 md:p-5 font-bold">24/7</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="p-4 md:p-5 font-bold">Метод обучения</td>
                  <td className="p-4 md:p-5">Персональный</td>
                  <td className="p-4 md:p-5">Готовый ответ</td>
                  <td className="p-4 md:p-5 font-bold">Вопросы-подсказки, не готовые ответы</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="p-4 md:p-5 font-bold">Диагностика пробелов</td>
                  <td className="p-4 md:p-5">Да</td>
                  <td className="p-4 md:p-5">Нет</td>
                  <td className="p-4 md:p-5 font-bold">Да</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="p-4 md:p-5 font-bold">Можно ошибаться без страха</td>
                  <td className="p-4 md:p-5">Средне</td>
                  <td className="p-4 md:p-5">Да</td>
                  <td className="p-4 md:p-5 font-bold">Да, полная анонимность</td>
                </tr>
                <tr className="hover:bg-muted/20 transition-colors">
                  <td className="p-4 md:p-5 font-bold">Развивает мышление</td>
                  <td className="p-4 md:p-5">Да</td>
                  <td className="p-4 md:p-5">Нет</td>
                  <td className="p-4 md:p-5 font-bold">Да</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Important Note */}
        <div className="bg-amber-50 dark:bg-amber-950/20 border-l-4 border-amber-400 p-6 md:p-8 rounded-lg max-w-4xl mx-auto">
          <h3 className="text-xl font-bold mb-4 text-amber-900 dark:text-amber-300">
            Важно: Мы не заменяем репетитора
          </h3>
          <p className="text-lg text-amber-800 dark:text-amber-400">
            Идеальная модель: <strong>Репетитор (раз в неделю) + Сократ AI (каждый день)</strong>
            <br />
            <br />
            Репетитор ставит цели и направляет, Сократ AI помогает между занятиями. Вместе это дает лучший результат!
          </p>
        </div>
      </div>
    </section>
  );
};

export default Comparison;
