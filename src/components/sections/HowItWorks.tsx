const HowItWorks = () => {
  return (
    <section className="py-20 px-4 bg-muted/30">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 text-primary">
          🛠️ Как это работает
        </h2>
        
        <h3 className="text-2xl font-bold text-center text-primary-variant mb-12">
          Сократовский метод в действии:
        </h3>

        <div className="max-w-4xl mx-auto">
          {/* Code Example */}
          <div className="bg-slate-900 text-white rounded-xl p-6 md:p-8 font-mono text-sm md:text-base leading-relaxed shadow-2xl mb-8">
            <div className="text-accent mb-3">
              <strong>Ты:</strong> Не понимаю, как решать квадратные уравнения. Помоги с x² - 5x + 6 = 0
            </div>
            <div className="text-blue-400 mb-3">
              <strong>Сократ:</strong> Хороший вопрос! Квадратное уравнение можно решить разными способами.
              Какой метод ты уже знаешь? Формулу дискриминанта или разложение на множители?
            </div>
            <div className="text-accent mb-3">
              <strong>Ты:</strong> Слышал про дискриминант, но не помню формулу
            </div>
            <div className="text-blue-400 mb-3">
              <strong>Сократ:</strong> Отлично! Дискриминант находится по формуле D = b² - 4ac.
              В твоем уравнении x² - 5x + 6 = 0, какие коэффициенты a, b и c?
            </div>
            <div className="text-accent mb-3">
              <strong>Ты:</strong> a = 1, b = -5, c = 6?
            </div>
            <div className="text-blue-400 mb-3">
              <strong>Сократ:</strong> Правильно! Теперь подставь эти значения в формулу дискриминанта. Что получится?
            </div>
            <div className="text-accent mb-3">
              <strong>Ты:</strong> D = (-5)² - 4×1×6 = 25 - 24 = 1
            </div>
            <div className="text-blue-400">
              <strong>Сократ:</strong> ОТЛИЧНО! 🎉 Ты все правильно посчитал! Теперь можешь найти корни по формуле
              x = (-b ± √D) / 2a. Попробуй сам!
            </div>
          </div>

          {/* Comparison Table */}
          <div className="bg-background rounded-xl p-6 md:p-8 shadow-elegant">
            <h3 className="text-xl font-bold text-center mb-6 text-primary">Разница с обычными ИИ:</h3>
            <div className="space-y-4">
              <div className="p-4 border-b-2 border-border">
                <strong className="text-foreground">Традиционный ИИ (ChatGPT):</strong>
                <p className="mt-2 text-muted-foreground">
                  Дает готовый ответ → ты списал → на контрольной не можешь решить
                </p>
              </div>
              <div className="p-4 bg-accent/10 rounded-lg">
                <strong className="text-foreground">Сократ:</strong>
                <p className="mt-2 text-foreground">
                  Задает вопросы-подсказки → ты понял сам → на контрольной решаешь уверенно! ✅
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
