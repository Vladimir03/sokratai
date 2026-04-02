import { useScrollAnimation } from "@/hooks/useScrollAnimation";

const Testimonials = () => {
  const testimonials = [
    {
      text: (
        <>
          "<strong>Это самый прекрасный сайт!</strong> Можешь задать конкретный вопрос по поводу его решения. Он объяснил, ты можешь еще раз задать вопрос. Это удобно. <strong>Не сразу дает ответ, а наводящий вопрос тоже</strong>."
        </>
      ),
      author: "Маша, 10 класс",
      rating: "⭐⭐⭐⭐⭐ 10/10"
    },
    {
      text: (
        <>
          "Ваш AI-помощник <strong>дает информацию для размышления и задает наводящие вопросы</strong>... Он именно <strong>объясняет, разъясняет</strong>, ты с ним можешь <strong>поговорить как с живым человеком</strong>, объясняет на понятном языке и примерах."
        </>
      ),
      author: "Максим, 11 класс ЕГЭ Математика",
      rating: "⭐⭐⭐⭐⭐"
    },
    {
      text: (
        <>
          "Если сравнить в начале 10 класса и сейчас — у меня <strong>оценки лучше стали</strong>... я уверена, что помощь этого AI-помощника точно здесь присутствует, прям вот на все 100% я в этом уверена"
        </>
      ),
      author: "Маша, 10 класс",
      rating: "⭐⭐⭐⭐⭐"
    },
    {
      text: (
        <>
          "Я каждый день пользуюсь AI помощником. Он <strong>действительно хорошо решает задачи</strong>...В сравнении он <strong>лучше решает задачи, чем другие AI</strong>"
        </>
      ),
      author: "Лера, 10 класс",
      rating: "⭐⭐⭐⭐⭐"
    }
  ];

  return (
    <section className="py-20 px-4 bg-muted/30">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          💬 Что говорят пользователи
        </h2>

        <div className="overflow-x-auto pb-4 -mx-4 px-4">
          <div className="flex gap-6 w-max">
            {testimonials.map((testimonial, index) => {
              const TestimonialCard = () => {
                const ref = useScrollAnimation();
                return (
                  <div 
                    ref={ref}
                    className="fade-base bg-background border-l-4 border-accent p-6 md:p-8 rounded-lg shadow-elegant italic w-[350px] md:w-[400px] flex-shrink-0"
                  >
                    <p className="text-foreground mb-4 text-lg">
                      {testimonial.text}
                    </p>
                    <div className="font-bold not-italic" style={{ color: "hsl(231, 36%, 29%)" }}>{testimonial.author}</div>
                    <div className="text-amber-500 mt-2">{testimonial.rating}</div>
                  </div>
                );
              };
              return <TestimonialCard key={index} />;
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
