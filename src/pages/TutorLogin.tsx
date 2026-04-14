import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { z } from "zod";
import TutorTelegramLoginButton from "@/components/TutorTelegramLoginButton";

const loginSchema = z.object({
  email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
  password: z.string().min(6, { message: "Минимум 6 символов" }),
});

const TutorLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: isTutor } = await supabase.rpc("is_tutor", { _user_id: session.user.id });
      if (isTutor) {
        navigate("/tutor/dashboard");
      } else {
        await supabase.auth.signOut();
      }
    };

    checkSession();
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validation = loginSchema.safeParse({ email, password });
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: validation.data.email,
        password: validation.data.password,
      });

      if (error) throw error;

      if (!data.user) {
        throw new Error("Не удалось получить пользователя");
      }

      const { data: isTutor, error: roleError } = await supabase.rpc("is_tutor", { _user_id: data.user.id });
      if (roleError) throw roleError;

      if (!isTutor) {
        console.warn("auth_event:not_tutor_account", { user_id: data.user.id });
        await supabase.auth.signOut();
        toast.error("Этот аккаунт не репетиторский. Используйте отдельный tutor-аккаунт.");
        return;
      }

      toast.success("Успешный вход!");
      navigate("/tutor/dashboard");
    } catch (error: any) {
      toast.error(getAuthErrorMessage(error, "Ошибка входа"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">Вход для репетитора</CardTitle>
          <CardDescription className="text-center">
            Войдите в репетиторский кабинет
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center">
            <p className="text-sm text-muted-foreground mb-3">
              Быстрый вход через Telegram
            </p>
            <TutorTelegramLoginButton className="w-full" />
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                или по email
              </span>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-xs text-muted-foreground hover:underline">
                Забыли пароль?
              </Link>
            </div>
            <Button
              type="submit"
              className="w-full"
              variant="outline"
              disabled={loading}
            >
              {loading ? "Вход..." : "Войти по email"}
            </Button>
          </form>

          <div className="space-y-3 text-center text-sm">
            <p className="text-muted-foreground">
              Нет репетиторского аккаунта?{" "}
              <Link to="/register-tutor" className="text-primary hover:underline">
                Зарегистрироваться
              </Link>
            </p>
            <p className="text-muted-foreground">
              Вы ученик?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Вход ученика
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TutorLogin;
