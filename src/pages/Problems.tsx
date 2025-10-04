import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { CheckCircle2, Circle } from "lucide-react";
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

interface Problem {
  id: string;
  question: string;
  topic: string;
  level: string;
  created_at: string;
  isSolved?: boolean;
}

const Problems = () => {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [solution, setSolution] = useState("");

  useEffect(() => {
    fetchProblems();
  }, []);

  const fetchProblems = async () => {
    try {
      const { data: problemsData, error: problemsError } = await supabase
        .from("problems_public")
        .select("*")
        .order("created_at");

      if (problemsError) throw problemsError;

      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { data: solutions, error: solutionsError } = await supabase
          .from("user_solutions")
          .select("problem_id, is_correct")
          .eq("user_id", user.id);

        if (solutionsError) throw solutionsError;

        const solvedIds = new Set(
          solutions?.filter(s => s.is_correct).map(s => s.problem_id) || []
        );

        const enrichedProblems = problemsData?.map(p => ({
          ...p,
          isSolved: solvedIds.has(p.id),
        })) || [];

        setProblems(enrichedProblems);
      } else {
        setProblems(problemsData || []);
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (!selectedProblem || !userAnswer.trim()) {
      toast.error("Введите ответ");
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .rpc('check_problem_answer', {
          problem_id_input: selectedProblem.id,
          user_answer_input: userAnswer.trim()
        });

      if (error) throw error;

      const result = data[0];
      
      // Save to user_solutions
      await supabase.from('user_solutions').insert({
        user_id: user.id,
        problem_id: selectedProblem.id,
        user_answer: userAnswer.trim(),
        is_correct: result.is_correct
      });

      if (result.is_correct) {
        toast.success("Правильно! 🎉");
        setSelectedProblem(null);
        setUserAnswer("");
        setShowSolution(false);
        fetchProblems(); // Refresh to show solved status
      } else {
        toast.error("Неправильно. Попробуйте ещё раз.");
        setSolution(result.solution);
        setShowSolution(true);
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const parseLatex = (text: string) => {
    const parts = [];
    let lastIndex = 0;
    const regex = /\$(.*?)\$/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
      }
      parts.push(<InlineMath key={`math-${match.index}`} math={match[1]} />);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(<span key="text-end">{text.slice(lastIndex)}</span>);
    }

    return parts.length > 0 ? parts : text;
  };

  const filteredProblems = problems.filter(p => {
    if (topicFilter !== "all" && p.topic !== topicFilter) return false;
    if (levelFilter !== "all" && p.level !== levelFilter) return false;
    return true;
  });

  const difficultyColors = {
    easy: "bg-green-500/10 text-green-600 border-green-500/20",
    medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    hard: "bg-red-500/10 text-red-600 border-red-500/20",
  };

  const difficultyLabels = {
    easy: "Лёгкий",
    medium: "Средний",
    hard: "Сложный",
  };

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-6">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Каталог задач</h1>
          <p className="text-muted-foreground">Выберите задачу и практикуйтесь</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <Select value={topicFilter} onValueChange={setTopicFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Тема" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все темы</SelectItem>
              <SelectItem value="Алгебра">Алгебра</SelectItem>
              <SelectItem value="Геометрия">Геометрия</SelectItem>
              <SelectItem value="Тригонометрия">Тригонометрия</SelectItem>
            </SelectContent>
          </Select>

          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Сложность" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все уровни</SelectItem>
              <SelectItem value="easy">Лёгкий</SelectItem>
              <SelectItem value="medium">Средний</SelectItem>
              <SelectItem value="hard">Сложный</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Problems Grid */}
        {loading ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProblems.map((problem) => (
              <Card key={problem.id} className="hover:shadow-elegant transition-all duration-300">
                <CardHeader>
                  <div className="flex items-start justify-between mb-2">
                    <Badge variant="secondary">{problem.topic}</Badge>
                    {problem.isSolved ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <CardTitle className="text-lg">{parseLatex(problem.question)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2 flex-wrap">
                    <Badge 
                      variant="outline" 
                      className={difficultyColors[problem.level as keyof typeof difficultyColors]}
                    >
                      {difficultyLabels[problem.level as keyof typeof difficultyLabels]}
                    </Badge>
                  </div>
                  
                  <Button 
                    className="w-full"
                    onClick={() => {
                      setSelectedProblem(problem);
                      setUserAnswer("");
                      setShowSolution(false);
                      setSolution("");
                    }}
                  >
                    Решить
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Answer Submission Dialog */}
        <Dialog open={!!selectedProblem} onOpenChange={(open) => !open && setSelectedProblem(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Решение задачи</DialogTitle>
              <DialogDescription>
                Введите ваш ответ ниже
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-2">Задача:</p>
                <div className="text-base">
                  {selectedProblem && parseLatex(selectedProblem.question)}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Ваш ответ:</label>
                <Input
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  placeholder="Введите ответ..."
                  disabled={submitting}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmitAnswer();
                    }
                  }}
                />
              </div>

              {showSolution && solution && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm font-medium mb-2 text-destructive">Решение:</p>
                  <div className="text-sm whitespace-pre-wrap">
                    {parseLatex(solution)}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedProblem(null);
                    setUserAnswer("");
                    setShowSolution(false);
                  }}
                  disabled={submitting}
                >
                  Закрыть
                </Button>
                <Button
                  onClick={handleSubmitAnswer}
                  disabled={submitting || !userAnswer.trim()}
                >
                  {submitting ? "Проверка..." : "Проверить"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AuthGuard>
  );
};

export default Problems;
