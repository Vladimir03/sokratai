import { Bot, RefreshCw, Lightbulb, ClipboardList } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';

const jobs = [
  {
    icon: RefreshCw,
    title: 'Создать похожую задачу',
    description: 'Генерация задач по образцу для ЕГЭ/ОГЭ',
  },
  {
    icon: Lightbulb,
    title: 'Решить / объяснить',
    description: 'Пошаговое решение и объяснение для ученика',
  },
  {
    icon: ClipboardList,
    title: 'Собрать ДЗ по теме',
    description: 'Готовый набор задач по теме урока',
  },
];

function TutorAssistantContent() {
  return (
    <TutorLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-socrat-primary" />
            <h1 className="text-2xl font-bold">AI-помощник репетитора</h1>
          </div>
          <p className="text-muted-foreground">
            Помогает быстро готовить задачи, домашки и объяснения для ЕГЭ/ОГЭ
          </p>
        </div>

        {/* Job cards */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          {jobs.map((job) => (
            <Card
              key={job.title}
              animate={false}
              className="cursor-pointer transition-colors hover:border-socrat-primary/50 hover:bg-accent/50"
            >
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-socrat-primary/10">
                  <job.icon className="h-6 w-6 text-socrat-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">{job.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{job.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Placeholder for future content */}
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p>Раздел в разработке</p>
          <p className="mt-1 text-sm">Скоро здесь появятся инструменты для подготовки к урокам</p>
        </div>
      </div>
    </TutorLayout>
  );
}

export default function TutorAssistant() {
  return (
    <TutorGuard>
      <TutorAssistantContent />
    </TutorGuard>
  );
}
