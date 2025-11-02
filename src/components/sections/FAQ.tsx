const FAQ = () => {
  const faqs = [
    {
      question: "Q: Это заменит репетитора?",
      answer: "A: Нет, это дополнение к репетитору. Идеально: репетитор раз в неделю + Сократ каждый день."
    },
    {
      question: "Q: Подходит ли для подготовки к ОГЭ/ЕГЭ?",
      answer: "A: Да! Мы адаптированы под школьную программу и экзамены. Показываем способы решения, которые принимают на ОГЭ/ЕГЭ."
    },
    {
      question: "Q: Можно использовать на телефоне?",
      answer: "A: Да! Работает на компьютере, планшете и телефоне. Особенно удобно в школе перед контрольными."
    },
    {
      question: "Q: А если у меня пробелы с 5-6 класса?",
      answer: "A: ИИ диагностирует пробелы и помогает их закрыть перед изучением новых тем."
    },
    {
      question: "Q: Сколько стоит после пробного периода?",
      answer: "A: Есть тарифы 399₽/месяц, 699₽/месяц и 1399₽/месяц - это дополнительно одно занятие с репетитором."
    }
  ];

  return (
    <section className="py-20 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          ❓ Часто задаваемые вопросы
        </h2>

        <div className="space-y-4 max-w-4xl mx-auto">
          {faqs.map((faq, index) => (
            <div 
              key={index}
              className="bg-background border border-border rounded-xl p-6 transition-all duration-300 hover:shadow-elegant hover:border-accent"
            >
              <div className="font-bold text-lg mb-3 text-primary">{faq.question}</div>
              <div className="text-muted-foreground leading-relaxed">{faq.answer}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQ;
