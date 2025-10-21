import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MessageSquare, Camera, Type, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HomeworkTask, TaskStatus, SUBJECTS } from "@/types/homework";
import { toast } from "sonner";
import { useState } from "react";

const HomeworkTaskDetail = () => {
  const { homeworkId, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [conditionText, setConditionText] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const { data: task } = useQuery({
    queryKey: ["homework-task", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homework_tasks")
        .select("*, homework_sets(*)")
        .eq("id", taskId)
        .single();

      if (error) throw error;
      return data as HomeworkTask & { homework_sets: any };
    },
  });

  // AI analysis generator
  const generateAIAnalysis = async (conditionText?: string, conditionPhotoUrl?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-homework-task', {
        body: {
          conditionText,
          conditionPhotoUrl,
          subject: task?.homework_sets?.subject,
          topic: task?.homework_sets?.topic
        }
      });

      if (error) throw error;
      return data.analysis;
    } catch (error) {
      console.error("AI analysis error:", error);
      toast.error("Ошибка AI анализа, используем базовый анализ");
      // Fallback to basic analysis
      return {
        type: "задача",
        solution_steps: [
          "Запиши данные из условия",
          "Выбери подходящий метод решения",
          "Выполни вычисления",
          "Проверь ответ"
        ]
      };
    }
  };

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: TaskStatus) => {
      const { error } = await supabase
        .from("homework_tasks")
        .update({ status: newStatus })
        .eq("id", taskId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["homework-task", taskId] });
      toast.success("Статус обновлен");
    },
    onError: () => {
      toast.error("Ошибка при обновлении статуса");
    },
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `${taskId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("chat-images")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("chat-images")
        .getPublicUrl(filePath);

      toast.info("Анализирую задачу с помощью AI...");
      const aiAnalysis = await generateAIAnalysis(undefined, publicUrl);

      const { error: updateError } = await supabase
        .from("homework_tasks")
        .update({
          condition_photo_url: publicUrl,
          ai_analysis: aiAnalysis,
        })
        .eq("id", taskId);

      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ["homework-task", taskId] });
      toast.success("Условие загружено!");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Ошибка при загрузке фото");
    } finally {
      setIsUploading(false);
    }
  };

  const handleTextSubmit = async () => {
    if (!conditionText.trim()) {
      toast.error("Введите условие задачи");
      return;
    }

    setIsUploading(true);
    try {
      toast.info("Анализирую задачу с помощью AI...");
      const aiAnalysis = await generateAIAnalysis(conditionText, undefined);

      const { error } = await supabase
        .from("homework_tasks")
        .update({
          condition_text: conditionText,
          ai_analysis: aiAnalysis,
        })
        .eq("id", taskId);

      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["homework-task", taskId] });
      toast.success("Условие сохранено!");
      setConditionText("");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Ошибка при сохранении");
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      not_started: { label: "Не начато", variant: "secondary" as const },
      in_progress: { label: "В процессе", variant: "default" as const },
      completed: { label: "Выполнено", variant: "outline" as const },
    };
    return statusConfig[status as keyof typeof statusConfig] || statusConfig.not_started;
  };

  if (!task) return null;

  const statusBadge = getStatusBadge(task.status);
  const hasCondition = task.condition_text || task.condition_photo_url;
  const subjectEmoji = SUBJECTS.find(s => s.id === task.homework_sets?.subject)?.emoji || "📚";

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="container mx-auto px-4 pt-[120px] md:pt-20 pb-8">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(`/homework/${homeworkId}`)}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1">
                <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  Задача {task.task_number}
                </h1>
                <p className="text-muted-foreground mt-1">
                  {subjectEmoji} {task.homework_sets?.subject}, {task.homework_sets?.topic}
                </p>
              </div>
            </div>

            {!hasCondition ? (
              /* STATE 1: NO CONDITION - Upload Interface */
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Camera className="w-5 h-5" />
                      Загрузи условие задачи
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Photo Upload Option */}
                    <label htmlFor="photo-upload" className="block">
                      <Card className="cursor-pointer hover:shadow-lg transition-shadow border-2 hover:border-primary">
                        <CardContent className="flex items-center gap-4 p-6">
                          <Camera className="w-8 h-8 text-primary" />
                          <div className="flex-1">
                            <h3 className="font-semibold">📷 Сфотографировать</h3>
                            <p className="text-sm text-muted-foreground">
                              Загрузи фото условия задачи
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </label>
                    <input
                      id="photo-upload"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoUpload}
                      disabled={isUploading}
                    />

                    {/* Text Input Option */}
                    <Card className="border-2">
                      <CardContent className="p-6 space-y-4">
                        <div className="flex items-center gap-4">
                          <Type className="w-8 h-8 text-primary" />
                          <div className="flex-1">
                            <h3 className="font-semibold">⌨️ Написать текстом</h3>
                            <p className="text-sm text-muted-foreground">
                              Введи условие вручную
                            </p>
                          </div>
                        </div>
                        <Textarea
                          placeholder="Введи условие задачи..."
                          value={conditionText}
                          onChange={(e) => setConditionText(e.target.value)}
                          className="min-h-[120px]"
                          disabled={isUploading}
                        />
                        <Button
                          onClick={handleTextSubmit}
                          disabled={isUploading || !conditionText.trim()}
                          className="w-full"
                        >
                          {isUploading ? "Сохранение..." : "Сохранить условие"}
                        </Button>
                      </CardContent>
                    </Card>

                    {/* Info Alert */}
                    <div className="flex items-start gap-2 p-4 bg-muted rounded-lg">
                      <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        💡 Без условия ИИ не сможет помочь с конкретной задачей
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              /* STATE 2: CONDITION EXISTS - Show condition + AI analysis */
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-green-600 flex items-center gap-2">
                        ✅ Условие обработано!
                      </CardTitle>
                      <Badge variant={statusBadge.variant}>
                        {statusBadge.label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Show condition */}
                    {task.condition_photo_url && (
                      <div>
                        <h3 className="font-semibold mb-2">Фото условия:</h3>
                        <img
                          src={task.condition_photo_url}
                          alt="Условие задачи"
                          className="rounded-lg max-w-full"
                        />
                      </div>
                    )}
                    
                    {task.condition_text && (
                      <div>
                        <h3 className="font-semibold mb-2">Условие:</h3>
                        <p className="text-muted-foreground whitespace-pre-wrap">
                          {task.condition_text}
                        </p>
                      </div>
                    )}

                    <div className="border-t pt-4">
                      <h3 className="font-semibold mb-2">Статус выполнения:</h3>
                      <Select
                        value={task.status}
                        onValueChange={(value) => updateStatusMutation.mutate(value as TaskStatus)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_started">Не начато</SelectItem>
                          <SelectItem value="in_progress">В процессе</SelectItem>
                          <SelectItem value="completed">Выполнено</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* AI Analysis */}
                {task.ai_analysis && (
                  <Card>
                    <CardHeader>
                      <CardTitle>🤖 Первичный анализ</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h3 className="font-semibold mb-1">Тип задачи:</h3>
                        <p className="text-muted-foreground">
                          {task.ai_analysis.type}
                        </p>
                      </div>
                      {task.ai_analysis.solution_steps && task.ai_analysis.solution_steps.length > 0 && (
                        <div>
                          <h3 className="font-semibold mb-2">💡 План решения:</h3>
                          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                            {task.ai_analysis.solution_steps.map((step, idx) => (
                              <li key={idx}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Chat Button */}
                <Button
                  className="w-full gap-2"
                  size="lg"
                  onClick={async () => {
                    if (!taskId || !task) return;

                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;

                    // Check if chat already exists for this task
                    const { data: existingChat } = await supabase
                      .from('chats')
                      .select('id')
                      .eq('homework_task_id', taskId)
                      .eq('user_id', user.id)
                      .maybeSingle();

                    let chatId = existingChat?.id;

                    // If not, create it
                    if (!chatId) {
                      const subjectIcons: Record<string, string> = {
                        'Математика': '📐',
                        'Алгебра': '📐',
                        'Геометрия': '📐',
                        'Физика': '⚗️',
                        'Химия': '🧪',
                        'Биология': '🧬'
                      };

                      const { data: newChat, error } = await supabase
                        .from('chats')
                        .insert({
                          user_id: user.id,
                          chat_type: 'homework_task',
                          homework_task_id: taskId,
                          title: `Задача ${task.task_number}`,
                          icon: subjectIcons[task.homework_sets.subject] || '📚'
                        })
                        .select()
                        .single();

                      if (error) {
                        toast.error("Не удалось создать чат");
                        return;
                      }

                      chatId = newChat.id;
                    }

                    navigate(`/chat?id=${chatId}`);
                  }}
                >
                  <MessageSquare className="w-4 h-4" />
                  💬 Обсудить с ИИ-репетитором
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
};

export default HomeworkTaskDetail;
