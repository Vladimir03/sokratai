import { Card, CardContent } from "@/components/ui/card";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

const ValueProposition = () => {
  const values = [
    {
      icon: "🤫",
      title: "Задавай любые вопросы анонимно",
      description: "Никто не увидит твои ошибки. Только ты и ИИ. Никакого стыда или страха осуждения."
    },
    {
      icon: "💡",
      title: "Получай наводки, а не готовые ответы",
      description: "Мы учим думать, а не списывать. Ты сам придешь к решению через наводящие вопросы."
    },
    {
      icon: "🔄",
      title: "Неограниченное количество попыток",
      description: "Можешь переспрашивать хоть 100 раз. ИИ терпеливый и всегда готов помочь."
    }
  ];

  return (
    <section className="py-20 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-6 text-primary">
          💡 Понимай математику сам, не беспокоя учителя и одноклассников
        </h2>
        <p className="text-center text-lg md:text-xl max-w-3xl mx-auto mb-12 text-muted-foreground">
          Мы не даем готовые решения. Мы задаем <strong>наводящие вопросы</strong>, которые помогают тебе
          <strong> самому прийти к ответу</strong>. Ты можешь спрашивать сколько угодно раз, переспрашивать,
          уточнять — <strong>без стыда и дискомфорта</strong>.
        </p>

        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => {
            const ValueCard = () => {
              const ref = useScrollAnimation();
              return (
                <Card 
                  ref={ref}
                  className="fade-base group hover:shadow-elegant transition-all duration-300 hover:-translate-y-2 hover:border-accent"
                >
                  <CardContent className="pt-6">
                    <div className="text-5xl mb-4">{value.icon}</div>
                    <h3 className="text-xl font-bold mb-2 text-primary-variant">{value.title}</h3>
                    <p className="text-muted-foreground">{value.description}</p>
                  </CardContent>
                </Card>
              );
            };
            return <ValueCard key={index} />;
          })}
        </div>
      </div>
    </section>
  );
};

export default ValueProposition;
