import { useScrollAnimation } from "@/hooks/useScrollAnimation";

const AhaMoments = () => {
  const Card1 = () => {
    const ref = useScrollAnimation();
    return (
      <div ref={ref} className="fade-base bg-background rounded-2xl p-8 md:p-10 shadow-2xl">
        <h3 className="text-2xl font-bold mb-4 text-accent">🎯 Способ 1: Получи подсказку и реши сам</h3>
        <p className="mb-6 text-lg text-foreground">
          Застрял на задаче по алгебре? Не беги к одноклассникам. Просто спроси у AI:
        </p>
        <ul className="space-y-3 mb-8 text-foreground">
          <li className="flex items-start gap-2">
            <span className="text-accent flex-shrink-0">✅</span>
            <span>Отправь задачу</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent flex-shrink-0">✅</span>
            <span>
              Получи <strong>вопрос-подсказку</strong> вместо готового ответа
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent flex-shrink-0">✅</span>
            <span>Подумай еще раз</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent flex-shrink-0">✅</span>
            <span>
              <strong>Решил сам!</strong> Вот оно — чувство "я смог!"
            </span>
          </li>
        </ul>
        <blockquote className="border-l-4 border-accent bg-muted/30 p-6 rounded-r-xl italic">
          <p className="text-foreground mb-4">
            "Испытываю радость от общения с Сократ AI, потому что я поняла, как решать задачу сама. Есть наводка, и с
            помощью нее я не просто списываю,
            <strong> меня заставляют думать</strong>"
          </p>
          <footer className="font-bold text-primary-variant">— Маша, 10 класс</footer>
        </blockquote>
      </div>
    );
  };

  const Card2 = () => {
    const ref = useScrollAnimation();
    return (
      <div ref={ref} className="fade-base bg-background rounded-2xl p-8 md:p-10 shadow-2xl">
        <h3 className="text-2xl font-bold mb-4 text-accent">
          🔥 Способ 2: Выбери способ решения, понятный именно тебе
        </h3>
        <p className="mb-6 text-lg text-foreground">Учитель объяснил одним способом, но ты не понял?</p>
        <ul className="space-y-3 mb-8 text-foreground">
          <li className="flex items-start gap-2">
            <span className="text-accent flex-shrink-0">✅</span>
            <span>
              Попроси показать <strong>2-3 разных способа</strong> решения той же задачи
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent flex-shrink-0">✅</span>
            <span>
              Выбери тот, который кажется логичным <strong>для твоего мышления</strong>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent flex-shrink-0">✅</span>
            <span>Решай дальше понятным тебе алгоритмом</span>
          </li>
        </ul>
        <blockquote className="border-l-4 border-accent bg-muted/30 p-6 rounded-r-xl italic">
          <p className="text-foreground mb-4">
            "Сократ AI показывает <strong>несколько способов</strong>, можно <strong>выбрать более простой способ</strong>{" "}
            - это супер удобно, это такой толчок для понимания"
          </p>
          <footer className="font-bold text-primary-variant">— Максим, 11 класс ЕГЭ Математика</footer>
        </blockquote>
      </div>
    );
  };

  return (
    <section className="py-20 px-4 bg-accent relative overflow-hidden">
      <div className="container mx-auto relative z-10">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-white">✨ Испытай радость от понимания</h2>

        <div className="space-y-8">
          <Card1 />
          <Card2 />
        </div>
      </div>
    </section>
  );
};

export default AhaMoments;
