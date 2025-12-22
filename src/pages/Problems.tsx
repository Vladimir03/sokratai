import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { CheckCircle2, Circle, X, Check } from "lucide-react";
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

interface CheckResult {
  status: 'correct' | 'incorrect' | null;
  solution?: string;
}

const Problems = () => {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [loading, setLoading] = useState(true);
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [checkResults, setCheckResults] = useState<Record<string, CheckResult>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});

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

  const handleCheckAnswer = async (problemId: string) => {
    const answer = userAnswers[problemId]?.trim();
    if (!answer) {
      toast.error("Введите ответ");
      return;
    }

    setChecking(prev => ({ ...prev, [problemId]: true }));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Пользователь не авторизован");

      const { data, error } = await supabase.rpc('check_problem_answer', {
        problem_id_input: problemId,
        user_answer_input: answer
      });

      if (error) throw error;

      const isCorrect = data[0]?.is_correct || false;
      const solution = data[0]?.solution;

      await supabase.from('user_solutions').insert({
        user_id: user.id,
        problem_id: problemId,
        user_answer: answer,
        is_correct: isCorrect
      });

      // Update user stats (XP, streak, level)
      await supabase.rpc('update_user_stats_on_solve', {
        p_user_id: user.id,
        p_is_correct: isCorrect
      });

      setCheckResults(prev => ({
        ...prev,
        [problemId]: {
          status: isCorrect ? 'correct' : 'incorrect',
          solution: solution
        }
      }));

      if (isCorrect) {
        toast.success("Правильно! +10 XP");
      } else {
        toast.error("Неправильно. Посмотрите решение ниже");
      }
      
      // Refresh problems list to show updated solved status
      await fetchProblems();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setChecking(prev => ({ ...prev, [problemId]: false }));
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
      <div className="container mx-auto px-4 pt-20 pb-6">
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
                  
                  {!problem.isSolved && !checkResults[problem.id] && (
                    <>
                      <Input
                        placeholder="Введите ответ"
                        value={userAnswers[problem.id] || ""}
                        onChange={(e) => setUserAnswers(prev => ({
                          ...prev,
                          [problem.id]: e.target.value
                        }))}
                        disabled={checking[problem.id]}
                      />
                      <Button 
                        className="w-full"
                        onClick={() => handleCheckAnswer(problem.id)}
                        disabled={checking[problem.id]}
                      >
                        {checking[problem.id] ? "Проверка..." : "Проверить"}
                      </Button>
                    </>
                  )}

                  {checkResults[problem.id]?.status === 'correct' && (
                    <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                      <Check className="w-5 h-5 text-green-600" />
                      <span className="text-green-600 font-medium">Правильно! +1 решённая задача</span>
                    </div>
                  )}

                  {checkResults[problem.id]?.status === 'incorrect' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                        <X className="w-5 h-5 text-red-600" />
                        <span className="text-red-600 font-medium">Неправильно</span>
                      </div>
                      {checkResults[problem.id]?.solution && (
                        <div className="p-4 bg-muted rounded-md">
                          <h4 className="font-semibold mb-2">Решение:</h4>
                          <div className="text-sm">
                            {parseLatex(checkResults[problem.id].solution || "")}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AuthGuard>
  );
};

export default Problems;
