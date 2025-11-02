const Testimonials = () => {
  const testimonials = [
    {
      text: "Это самый прекрасный сайт! Можешь задать конкретный вопрос по поводу его решения. Он объяснил, ты можешь еще раз задать вопрос. Это удобно. Не сразу дает ответ, а наводящий вопрос тоже.",
      author: "Маша, 10 класс",
      rating: "⭐⭐⭐⭐⭐ 10/10"
    },
    {
      text: "Ваш ИИ-помощник дает информацию для размышления и задает наводящие вопросы... Он именно объясняет, разъясняет, ты с ним можешь поговорить как с живым человеком, объясняет на понятном языке и примерах.",
      author: "Максим, 11 класс ЕГЭ Математика",
      rating: "⭐⭐⭐⭐⭐"
    },
    {
      text: "Если сравнить в начале 10 класса и сейчас — у меня оценки лучше стали... я уверена, что помощь этого ИИ-помощника точно здесь присутствует, прям вот на все 100% я в этом уверена",
      author: "Маша, 10 класс",
      rating: "⭐⭐⭐⭐⭐"
    },
    {
      text: "Я каждый день пользуюсь ИИ помощником. Он действительно хорошо решает задачи...В сравнении он лучше решает задачи, чем другие ИИ",
      author: "Лера, 10 класс",
      rating: "⭐⭐⭐⭐⭐"
    }
  ];

  return (
    <section className="py-20 px-4 bg-muted/30">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          💬 Что говорят реальные пользователи
        </h2>

        <div className="space-y-6 max-w-4xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <div 
              key={index}
              className="bg-background border-l-4 border-accent p-6 md:p-8 rounded-lg shadow-elegant italic"
            >
              <p className="text-foreground mb-4 text-lg">
                "{testimonial.text}"
              </p>
              <div className="font-bold text-primary-variant not-italic">{testimonial.author}</div>
              <div className="text-amber-500 mt-2">{testimonial.rating}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
