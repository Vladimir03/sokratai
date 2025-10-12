import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Navigation from "@/components/Navigation";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SUBJECTS, Priority } from "@/types/homework";

const HomeworkAdd = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    subject: "",
    topic: "",
    deadline: "",
    priority: "later" as Priority,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Не авторизован");

      const { data, error } = await supabase
        .from("homework_sets")
        .insert({
          user_id: user.id,
          subject: formData.subject,
          topic: formData.topic,
          deadline: formData.deadline || null,
          priority: formData.priority,
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Домашнее задание добавлено");
      navigate(`/homework/${data.id}`);
    } catch (error) {
      console.error("Error creating homework:", error);
      toast.error("Ошибка при создании задания");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <main className="container mx-auto px-4 pt-20 pb-24 md:pb-8">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/homework")}
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-hero bg-clip-text text-transparent">
                  Новое домашнее задание
                </h1>
                <p className="text-muted-foreground mt-1">
                  Добавьте информацию о домашнем задании
                </p>
              </div>
            </div>

            {/* Form */}
            <Card>
              <CardHeader>
                <CardTitle>Информация о задании</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="subject">Предмет</Label>
                    <Select
                      value={formData.subject}
                      onValueChange={(value) =>
                        setFormData({ ...formData, subject: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите предмет" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUBJECTS.map((subject) => (
                          <SelectItem key={subject.id} value={subject.name}>
                            {subject.emoji} {subject.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="topic">Тема / Параграф</Label>
                    <Input
                      id="topic"
                      placeholder="§15 Теорема Пифагора"
                      value={formData.topic}
                      onChange={(e) =>
                        setFormData({ ...formData, topic: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="deadline">Дедлайн (необязательно)</Label>
                    <Input
                      id="deadline"
                      type="date"
                      value={formData.deadline}
                      onChange={(e) =>
                        setFormData({ ...formData, deadline: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="priority">Срочность</Label>
                    <Select
                      value={formData.priority}
                      onValueChange={(value) =>
                        setFormData({ ...formData, priority: value as Priority })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="urgent">🔴 Срочно</SelectItem>
                        <SelectItem value="important">🟡 Важно</SelectItem>
                        <SelectItem value="later">🟢 Позже</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate("/homework")}
                      className="flex-1"
                    >
                      Отмена
                    </Button>
                    <Button
                      type="submit"
                      disabled={isLoading || !formData.subject || !formData.topic}
                      className="flex-1"
                    >
                      {isLoading ? "Создание..." : "Создать"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
};

export default HomeworkAdd;
