const AhaMoments = () => {
  return (
    <section className="py-20 px-4 bg-gradient-accent relative overflow-hidden">
      <div className="container mx-auto relative z-10">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-white">
          ✨ Испытай радость от понимания
        </h2>

        <div className="space-y-8">
          {/* Aha Card 1 */}
          <div className="bg-background rounded-2xl p-8 md:p-10 shadow-2xl">
            <h3 className="text-2xl font-bold mb-4 text-accent">
              🎯 Способ 1: Получи наводку и реши сам
            </h3>
            <p className="mb-6 text-lg text-foreground">
              Застрял на задаче по алгебре? Не беги к одноклассникам. Просто спроси у ИИ:
            </p>
            <ul className="space-y-3 mb-8 text-foreground">
              <li className="flex items-start">
                <span className="text-accent mr-2">✅</span>
                Отправь задачу
              </li>
              <li className="flex items-start">
                <span className="text-accent mr-2">✅</span>
                Получи <strong>наводящий вопрос</strong> вместо готового ответа
              </li>
              <li className="flex items-start">
                <span className="text-accent mr-2">✅</span>
                Подумай еще раз
              </li>
              <li className="flex items-start">
                <span className="text-accent mr-2">✅</span>
                <strong>Решил сам!</strong> Вот оно — чувство "я смог!"
              </li>
            </ul>
            <blockquote className="border-l-4 border-accent bg-muted/30 p-6 rounded-r-xl italic">
              <p className="text-foreground mb-4">
                "Радость, потому что я поняла как решать задачу сама. Есть наводка, и с помощью нее я не просто списываю,
                <strong> меня заставляют думать</strong>"
              </p>
              <footer className="font-bold text-primary-variant">— Маша, 10 класс</footer>
            </blockquote>
          </div>

          {/* Aha Card 2 */}
          <div className="bg-background rounded-2xl p-8 md:p-10 shadow-2xl">
            <h3 className="text-2xl font-bold mb-4 text-accent">
              🔥 Способ 2: Выбери способ решения, понятный именно тебе
            </h3>
            <p className="mb-6 text-lg text-foreground">
              Учитель объяснил одним способом, но ты не понял?
            </p>
            <ul className="space-y-3 mb-8 text-foreground">
              <li className="flex items-start">
                <span className="text-accent mr-2">✅</span>
                Попроси показать <strong>2-3 разных способа</strong> решения той же задачи
              </li>
              <li className="flex items-start">
                <span className="text-accent mr-2">✅</span>
                Выбери тот, который кажется логичным <strong>для твоего мышления</strong>
              </li>
              <li className="flex items-start">
                <span className="text-accent mr-2">✅</span>
                Решай дальше понятным тебе алгоритмом
              </li>
            </ul>
            <blockquote className="border-l-4 border-accent bg-muted/30 p-6 rounded-r-xl italic">
              <p className="text-foreground mb-4">
                "Он показывает <strong>несколько способов</strong>... можно <strong>выбрать более простой способ</strong>...
                это супер удобно... это такой толчок для понимания"
              </p>
              <footer className="font-bold text-primary-variant">— Максим, 11 класс ЕГЭ Математика</footer>
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AhaMoments;
