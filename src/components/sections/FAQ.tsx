import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = () => {
  const faqs = [
    {
      question: "Это заменит репетитора?",
      answer: "Нет, это дополнение к репетитору. Идеально: репетитор раз в неделю + Сократ AI каждый день."
    },
    {
      question: "Подходит ли для подготовки к ОГЭ/ЕГЭ?",
      answer: "Да! Мы адаптированы под школьную программу и экзамены. Показываем способы решения, которые принимают на ОГЭ/ЕГЭ."
    },
    {
      question: "Можно использовать на телефоне?",
      answer: "Да! Работает на компьютере, планшете и телефоне. Особенно удобно в школе перед контрольными."
    },
    {
      question: "А если у меня пробелы с 5-6 класса?",
      answer: "AI диагностирует пробелы и помогает их закрыть перед изучением новых тем."
    },
    {
      question: "Сколько стоит после пробного периода?",
      answer: "Есть тарифы 399₽/месяц, 699₽/месяц и 1399₽/месяц - это дополнительно одно занятие с репетитором."
    }
  ];

  return (
    <section className="py-20 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          ❓ Часто задаваемые вопросы
        </h2>

        <Accordion type="single" collapsible className="max-w-4xl mx-auto">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="text-left font-bold text-lg text-primary hover:text-primary-variant">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
};

export default FAQ;
