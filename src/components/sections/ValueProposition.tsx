import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, Lightbulb, Heart, LucideIcon } from "lucide-react";

const ValueCard = ({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) => {
  return (
    <Card 
      animate={false}
      className="group hover:shadow-elegant transition-all duration-300 hover:-translate-y-2 hover:border-accent"
    >
      <CardContent className="pt-6">
        <div className="mb-4"><Icon className="w-10 h-10 text-accent" /></div>
        <h3 className="text-xl font-bold mb-2 text-primary-variant">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
};

const ValueProposition = () => {
  const values = [
    {
      icon: ShieldCheck,
      title: "Никто не узнает о твоих ошибках",
      description: "Ни родители, ни одноклассники, ни учителя не увидят твои ошибки. Твои трудности — только между тобой и AI. Никакого стыда или страха осуждения."
    },
    {
      icon: Lightbulb,
      title: "Получай подсказки, а не готовые ответы",
      description: "Мы учим думать, а не списывать. Ты сам придешь к решению через вопросы-подсказки."
    },
    {
      icon: Heart,
      title: "AI не раздражается от твоих вопросов",
      description: "В отличие от учителя, Сократ AI не вздохнет, когда ты не понял с первого раза. Отвечает эмпатично, с юмором и поддержкой — как понимающий друг. Переспрашивай сколько нужно."
    }
  ];

  return (
    <section className="py-12 px-4 bg-background">
      <div className="container mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-6 text-primary">
          Понимай предметы сам, не беспокоя учителя и одноклассников
        </h2>
        <p className="text-center text-lg md:text-xl max-w-3xl mx-auto mb-12 text-muted-foreground">
          Мы не даем готовые решения. Мы задаем <strong>вопросы-подсказки</strong>, которые помогают тебе
          <strong> самому прийти к ответу</strong>. Ты можешь спрашивать сколько угодно раз, переспрашивать,
          уточнять — <strong>без стыда и дискомфорта</strong>.
        </p>

        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => (
            <ValueCard key={index} icon={value.icon} title={value.title} description={value.description} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default ValueProposition;
