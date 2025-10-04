import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { User, Zap, Target, Trophy, Edit } from "lucide-react";
import { z } from "zod";

const usernameSchema = z.string()
  .trim()
  .min(3, "Минимум 3 символа")
  .max(30, "Максимум 30 символов")
  .regex(/^[a-zA-Zа-яА-Я0-9_-]+$/, "Только буквы, цифры, _ и -");

interface Profile {
  username: string;
  xp: number;
  level: number;
  streak: number;
}

const Profile = () => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState("");

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error) throw error;
      setProfile(data);
      setNewUsername(data.username);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUsername = async () => {
    try {
      // Validate username format
      const validation = usernameSchema.safeParse(newUsername);
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check if username is already taken
      const { data: existingUser } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", validation.data)
        .neq("id", user.id)
        .maybeSingle();

      if (existingUser) {
        toast.error("Это имя уже занято");
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({ username: validation.data })
        .eq("id", user.id);

      if (error) throw error;

      toast.success("Имя обновлено!");
      setProfile(prev => prev ? { ...prev, username: validation.data } : null);
      setEditing(false);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  if (loading) {
    return (
      <AuthGuard>
        <div className="container mx-auto px-4 py-6">
          <div className="text-center py-12">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Профиль</h1>
          <p className="text-muted-foreground">Управление аккаунтом</p>
        </div>

        <div className="space-y-6">
          {/* Main Profile Card */}
          <Card className="bg-gradient-hero text-primary-foreground shadow-glow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center">
                    <User className="w-10 h-10 text-accent-foreground" />
                  </div>
                  <div>
                    {editing ? (
                      <div className="flex gap-2 items-center">
                        <Input
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="bg-background text-foreground"
                        />
                        <Button onClick={handleUpdateUsername} variant="secondary" size="sm">
                          Сохранить
                        </Button>
                        <Button onClick={() => setEditing(false)} variant="outline" size="sm">
                          Отмена
                        </Button>
                      </div>
                    ) : (
                      <>
                        <CardTitle className="text-2xl">{profile?.username}</CardTitle>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setEditing(true)}
                          className="text-primary-foreground hover:text-accent"
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Изменить имя
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold">Ур. {profile?.level}</div>
                  <div className="text-sm opacity-90">{profile?.xp} XP</div>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Stats Grid */}
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Опыт (XP)
                </CardTitle>
                <Zap className="w-4 h-4 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{profile?.xp || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  До следующего уровня: {1000 - (profile?.xp || 0)} XP
                </div>
                <div className="w-full bg-muted rounded-full h-2 mt-2">
                  <div
                    className="bg-accent h-2 rounded-full transition-all duration-500"
                    style={{ width: `${((profile?.xp || 0) / 1000) * 100}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Текущая серия
                </CardTitle>
                <Target className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{profile?.streak || 0} дней</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {profile?.streak ? "Продолжайте в том же духе!" : "Начните новую серию"}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Уровень
                </CardTitle>
                <Trophy className="w-4 h-4 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{profile?.level || 1}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {profile?.level === 1 ? "Новичок" : profile?.level && profile.level < 5 ? "Ученик" : "Мастер"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Badges */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-accent" />
                Значки
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-gradient-card rounded-lg border-2 border-accent">
                  <div className="text-4xl mb-2">🎯</div>
                  <div className="text-sm font-medium">Новичок</div>
                  <div className="text-xs text-muted-foreground">Зарегистрирован</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                  <div className="text-4xl mb-2">📚</div>
                  <div className="text-sm font-medium">Студент</div>
                  <div className="text-xs text-muted-foreground">5 уровень</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                  <div className="text-4xl mb-2">🎓</div>
                  <div className="text-sm font-medium">Выпускник</div>
                  <div className="text-xs text-muted-foreground">10 уровень</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                  <div className="text-4xl mb-2">👑</div>
                  <div className="text-sm font-medium">Мастер</div>
                  <div className="text-xs text-muted-foreground">20 уровень</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthGuard>
  );
};

export default Profile;
