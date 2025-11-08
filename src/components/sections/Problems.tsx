const Problems = () => {
  return (
    <section className="py-20 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          😰 Узнаёшь себя?
        </h2>

        <div className="space-y-6 max-w-4xl mx-auto">
          {/* Problem 1 */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border-l-4 border-amber-500 p-6 rounded-lg">
            <h3 className="text-xl font-bold mb-4 text-amber-900 dark:text-amber-300">
              Проблема 1: Застреваешь на задачах и не знаешь, к кому обратиться
            </h3>
            <div className="space-y-2 text-amber-800 dark:text-amber-400">
              <p>❌ Учитель быстро объяснил — не успел записать</p>
              <p>❌ Одноклассников стыдно спрашивать в 10-й раз</p>
              <p>❌ До следующего занятия с репетитором еще неделя</p>
              <p>❌ В YouTube ищешь, но там либо слишком просто, либо вообще непонятно</p>
            </div>
          </div>

          {/* Problem 2 */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border-l-4 border-amber-500 p-6 rounded-lg">
            <h3 className="text-xl font-bold mb-4 text-amber-900 dark:text-amber-300">
              Проблема 2: Проблемы накопились, и теперь не понимаешь текущие темы
            </h3>
            <div className="space-y-2 text-amber-800 dark:text-amber-400">
              <p>❌ В 7-8 классе появились алгебра + геометрия — двойной стресс</p>
              <p>❌ В 10-11 классе каждый день новые темы — не успеваешь</p>
              <p>❌ Есть ощущение, что пробелы тянутся еще с 5-6 класса</p>
              <p>❌ Страшно, что провалишь ОГЭ/ЕГЭ</p>
            </div>
          </div>

          {/* Emotions Box */}
          <div className="bg-muted border-2 border-accent rounded-2xl p-8 text-center mt-12">
            <h3 className="text-2xl font-bold mb-6 text-primary">😞 Эмоции, которые ты чувствуешь сейчас:</h3>
            <div className="space-y-4 text-lg text-foreground">
              <p>
                <strong>Стыд:</strong> Стыдно признаться, что не понимаешь "простую" тему
              </p>
              <p>
                <strong>Раздражение:</strong> "Я не математик, у меня не получится"
              </p>
              <p>
                <strong>Беспомощность:</strong> "Я уже так долго отстаю, теперь не догоню"
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Problems;
