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
          {/* Chat Dialog */}
          <div className="bg-background border-2 border-accent rounded-xl p-6 md:p-8 shadow-2xl mb-8">
            <div className="space-y-4">
              {/* User message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  Ты
                </div>
                <div className="flex-1 bg-muted/50 rounded-lg p-3 text-sm md:text-base">
                  Не понимаю, как решать квадратные уравнения. Помоги с x² - 5x + 6 = 0
                </div>
              </div>

              {/* Sokrat message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-semibold text-accent">
                  Сократ
                </div>
                <div className="flex-1 bg-accent/5 rounded-lg p-3 text-sm md:text-base border border-accent/20">
                  Хороший вопрос! Квадратное уравнение можно решить разными способами.
                  Какой метод ты уже знаешь? Формулу дискриминанта или разложение на множители?
                </div>
              </div>

              {/* User message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  Ты
                </div>
                <div className="flex-1 bg-muted/50 rounded-lg p-3 text-sm md:text-base">
                  Слышал про дискриминант, но не помню формулу
                </div>
              </div>

              {/* Sokrat message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-semibold text-accent">
                  Сократ
                </div>
                <div className="flex-1 bg-accent/5 rounded-lg p-3 text-sm md:text-base border border-accent/20">
                  Отлично! Дискриминант находится по формуле D = b² - 4ac.
                  В твоем уравнении x² - 5x + 6 = 0, какие коэффициенты a, b и c?
                </div>
              </div>

              {/* User message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  Ты
                </div>
                <div className="flex-1 bg-muted/50 rounded-lg p-3 text-sm md:text-base">
                  a = 1, b = -5, c = 6?
                </div>
              </div>

              {/* Sokrat message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-semibold text-accent">
                  Сократ
                </div>
                <div className="flex-1 bg-accent/5 rounded-lg p-3 text-sm md:text-base border border-accent/20">
                  Правильно! Теперь подставь эти значения в формулу дискриминанта. Что получится?
                </div>
              </div>

              {/* User message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                  Ты
                </div>
                <div className="flex-1 bg-muted/50 rounded-lg p-3 text-sm md:text-base">
                  D = (-5)² - 4×1×6 = 25 - 24 = 1
                </div>
              </div>

              {/* Sokrat message */}
              <div className="flex gap-3 items-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-semibold text-accent">
                  Сократ
                </div>
                <div className="flex-1 bg-accent/5 rounded-lg p-3 text-sm md:text-base border border-accent/20">
                  ОТЛИЧНО! 🎉 Ты все правильно посчитал! Теперь можешь найти корни по формуле
                  x = (-b ± √D) / 2a. Попробуй сам!
                </div>
              </div>
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
