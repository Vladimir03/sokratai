import { Card, CardContent } from "@/components/ui/card";

const Results = () => {
  const results = [
    {
      icon: "😊",
      title: "Радость от самостоятельного понимания",
      subtitle: '"Я понял(а) САМ(А)!"',
      description: "Не просто списал(а) — понял(а). Чувство гордости: \"я смог(ла) разобраться\""
    },
    {
      icon: "💪",
      title: "Уверенность в своих силах",
      subtitle: '"Я могу решать сложные задачи"',
      description: "Больше не боишься контрольных. Знаешь, что справишься."
    },
    {
      icon: "📈",
      title: "Реальный рост баллов",
      subtitle: 'От "3" к "4-5"',
      description: "Видимое улучшение оценок за 1-2 месяца."
    }
  ];

  return (
    <section className="py-20 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-12 text-primary">
          🌟 Что ты получишь через 1-2 месяца
        </h2>

        <div className="grid md:grid-cols-3 gap-8 mb-12">
          {results.map((result, index) => (
            <Card key={index} className="hover:shadow-elegant transition-all duration-300">
              <CardContent className="pt-6 text-center">
                <div className="text-5xl mb-4">{result.icon}</div>
                <h3 className="text-xl font-bold mb-2 text-primary-variant">{result.title}</h3>
                <p className="font-bold text-lg mb-3 text-accent">{result.subtitle}</p>
                <p className="text-muted-foreground">{result.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Timeline Box */}
        <div className="bg-muted border-2 border-accent rounded-2xl p-8 max-w-3xl mx-auto">
          <h3 className="text-2xl font-bold text-center mb-8 text-primary">📊 Твой путь к успеху:</h3>
          <div className="space-y-4 text-lg">
            <p><strong>День 1:</strong> Задаешь первый вопрос → чувствуешь разницу</p>
            <p><strong>Неделя 1:</strong> Уже не боишься сложных задач</p>
            <p><strong>Месяц 1:</strong> Улучшение оценок на 1 балл</p>
            <p><strong>Месяц 2-3:</strong> Стабильные результаты, уверенность растет</p>
            <p><strong>ОГЭ/ЕГЭ:</strong> Сдаешь спокойно, без паники</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Results;
