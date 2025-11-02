const Comparison = () => {
  return (
    <section className="py-20 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          🥊 Почему мы лучше других решений
        </h2>

        {/* Comparison Table */}
        <div className="overflow-x-auto mb-12">
          <table className="w-full bg-background rounded-xl shadow-elegant overflow-hidden">
            <thead>
              <tr>
                <th className="bg-primary text-primary-foreground p-4 md:p-5 text-left font-bold">Критерий</th>
                <th className="bg-primary text-primary-foreground p-4 md:p-5 text-left font-bold">Репетитор</th>
                <th className="bg-primary text-primary-foreground p-4 md:p-5 text-left font-bold">ChatGPT/Deepseek</th>
                <th className="bg-accent text-accent-foreground p-4 md:p-5 text-left font-bold">Сократ ✅</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                <td className="p-4 md:p-5 font-bold">Цена/месяц</td>
                <td className="p-4 md:p-5">5,000-20,000₽</td>
                <td className="p-4 md:p-5">Бесплатно / 2000₽</td>
                <td className="p-4 md:p-5 font-bold">399₽ 🔥</td>
              </tr>
              <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                <td className="p-4 md:p-5 font-bold">Доступность</td>
                <td className="p-4 md:p-5">1-2 раза в неделю</td>
                <td className="p-4 md:p-5">24/7</td>
                <td className="p-4 md:p-5 font-bold">24/7 ✅</td>
              </tr>
              <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                <td className="p-4 md:p-5 font-bold">Метод обучения</td>
                <td className="p-4 md:p-5">Персональный ✅</td>
                <td className="p-4 md:p-5">Готовый ответ ❌</td>
                <td className="p-4 md:p-5 font-bold">Сократовский метод ✅</td>
              </tr>
              <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                <td className="p-4 md:p-5 font-bold">Диагностика пробелов</td>
                <td className="p-4 md:p-5">Да ✅</td>
                <td className="p-4 md:p-5">Нет ❌</td>
                <td className="p-4 md:p-5 font-bold">Да ✅</td>
              </tr>
              <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                <td className="p-4 md:p-5 font-bold">Без стыда</td>
                <td className="p-4 md:p-5">Средне</td>
                <td className="p-4 md:p-5">Да ✅</td>
                <td className="p-4 md:p-5 font-bold">Да, полная анонимность ✅</td>
              </tr>
              <tr className="hover:bg-muted/20 transition-colors">
                <td className="p-4 md:p-5 font-bold">Развивает мышление</td>
                <td className="p-4 md:p-5">Да ✅</td>
                <td className="p-4 md:p-5">Нет ❌</td>
                <td className="p-4 md:p-5 font-bold">Да ✅</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Important Note */}
        <div className="bg-amber-50 dark:bg-amber-950/20 border-l-4 border-amber-400 p-6 md:p-8 rounded-lg max-w-4xl mx-auto">
          <h3 className="text-xl font-bold mb-4 text-amber-900 dark:text-amber-300">
            💡 Важно: Мы не заменяем репетитора
          </h3>
          <p className="text-lg text-amber-800 dark:text-amber-400">
            Идеальная модель: <strong>Репетитор (раз в неделю) + Сократ (каждый день)</strong>
            <br /><br />
            Репетитор ставит цели и направляет, Сократ помогает между занятиями. Вместе это дает лучший результат!
          </p>
        </div>
      </div>
    </section>
  );
};

export default Comparison;
