import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Target, Brain, Zap, Trophy, ArrowRight, Lock } from "lucide-react";
import Navigation from "@/components/Navigation";

interface Topic {
  id: string;
  name: string;
  emoji: string;
  questionsCount: number;
  completedCount: number;
  isLocked: boolean;
}

const topics: Topic[] = [
  { id: "algebra", name: "Алгебра", emoji: "📐", questionsCount: 20, completedCount: 0, isLocked: false },
  { id: "geometry", name: "Геометрия", emoji: "📏", questionsCount: 15, completedCount: 0, isLocked: false },
  { id: "equations", name: "Уравнения", emoji: "🔢", questionsCount: 25, completedCount: 0, isLocked: false },
  { id: "functions", name: "Функции", emoji: "📈", questionsCount: 18, completedCount: 0, isLocked: true },
  { id: "probability", name: "Вероятность", emoji: "🎲", questionsCount: 12, completedCount: 0, isLocked: true },
];

export default function Practice() {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <main className="container mx-auto px-4 pt-20 pb-24 md:pb-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <Target className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Тренажёр</h1>
          </div>
          <p className="text-muted-foreground">
            Практикуйся и улучшай свои навыки решения задач
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
            <CardContent className="p-4 text-center">
              <Brain className="h-5 w-5 mx-auto mb-1 text-primary" />
              <p className="text-2xl font-bold">0</p>
              <p className="text-xs text-muted-foreground">Решено</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-500/5 to-amber-500/10 border-amber-500/20">
            <CardContent className="p-4 text-center">
              <Zap className="h-5 w-5 mx-auto mb-1 text-amber-500" />
              <p className="text-2xl font-bold">0</p>
              <p className="text-xs text-muted-foreground">Серия</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 border-emerald-500/20">
            <CardContent className="p-4 text-center">
              <Trophy className="h-5 w-5 mx-auto mb-1 text-emerald-500" />
              <p className="text-2xl font-bold">0%</p>
              <p className="text-xs text-muted-foreground">Точность</p>
            </CardContent>
          </Card>
        </div>

        {/* Topics */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold mb-4">Выбери тему</h2>
          
          {topics.map((topic) => {
            const progress = topic.questionsCount > 0 
              ? (topic.completedCount / topic.questionsCount) * 100 
              : 0;
            
            return (
              <Card 
                key={topic.id}
                className={`transition-all duration-200 ${
                  topic.isLocked 
                    ? "opacity-60 cursor-not-allowed" 
                    : "hover:shadow-md hover:border-primary/30 cursor-pointer"
                } ${selectedTopic === topic.id ? "border-primary ring-2 ring-primary/20" : ""}`}
                onClick={() => !topic.isLocked && setSelectedTopic(topic.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="text-3xl">{topic.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium">{topic.name}</h3>
                        {topic.isLocked && (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {topic.completedCount}/{topic.questionsCount}
                        </span>
                      </div>
                    </div>
                    {!topic.isLocked && (
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Start Button */}
        {selectedTopic && (
          <div className="fixed bottom-20 md:bottom-4 left-0 right-0 px-4">
            <div className="container mx-auto max-w-md">
              <Button 
                className="w-full h-12 text-base font-medium shadow-lg"
                size="lg"
              >
                <Target className="mr-2 h-5 w-5" />
                Начать тренировку
              </Button>
            </div>
          </div>
        )}

        {/* Coming Soon Notice */}
        <Card className="mt-6 bg-muted/50 border-dashed">
          <CardContent className="p-4 text-center">
            <p className="text-sm text-muted-foreground">
              🚧 Тренажёр в разработке. Скоро появятся интерактивные задачи!
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
