import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { z } from "zod";
import { GraduationCap } from "lucide-react";
import TutorTelegramLoginButton from "@/components/TutorTelegramLoginButton";

const registerSchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: "Минимум 2 символа" })
    .max(100, { message: "Максимум 100 символов" }),
  email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
  password: z.string()
    .min(8, { message: "Минимум 8 символов" })
    .regex(/[A-Z]/, { message: "Должна быть заглавная буква" })
    .regex(/[0-9]/, { message: "Должна быть цифра" }),
});

function isExistingEmailError(error: unknown): boolean {
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("already in use") ||
    message.includes("user already exists")
  );
}

const RegisterTutor = () => {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect only if user is already a tutor
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Check if user is already a tutor
        const { data: isTutor } = await supabase.rpc("is_tutor", { 
          _user_id: session.user.id 
        });
        
        if (isTutor) {
          navigate("/tutor/dashboard");
        }
        // If not a tutor, show registration form
      }
    };
    checkSession();
  }, [navigate]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validation = registerSchema.safeParse({ name, email, password });
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        setLoading(false);
        return;
      }

      // Step 1: Register the user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: validation.data.email,
        password: validation.data.password,
        options: {
          data: {
            username: validation.data.name,
          },
          emailRedirectTo: `${window.location.origin}/tutor/dashboard`,
        },
      });

      if (authError && isExistingEmailError(authError)) {
        console.warn("auth_event:existing_email", {
          flow: "tutor_register",
          email: validation.data.email,
        });
        toast.error("Email уже занят. Для репетитора нужен отдельный аккаунт.");
        return;
      }

      if (authError) throw authError;

      if (!authData.user) {
        throw new Error("Не удалось создать пользователя");
      }

      // Step 2: Assign tutor role via edge function
      const { error: roleError } = await supabase.functions.invoke("assign-tutor-role", {
        body: { user_id: authData.user.id },
      });

      if (roleError) {
        console.error("auth_event:role_assignment_failed", {
          flow: "tutor_register",
          user_id: authData.user.id,
          error: roleError.message,
        });
        toast.error("Не удалось назначить роль репетитора. Попробуйте снова.");
        return;
      }

      toast.success("Регистрация успешна!");
      navigate("/tutor/dashboard");
    } catch (error: any) {
      console.error("Registration error:", error);
      toast.error(getAuthErrorMessage(error, "Ошибка регистрации"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-2">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold text-center">Регистрация репетитора</CardTitle>
          <CardDescription className="text-center">
            Создайте аккаунт для управления учениками
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center">
            <p className="text-sm text-muted-foreground mb-3">
              Быстрая регистрация через Telegram
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

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
              />
            </div>
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
                placeholder="Пароль (минимум 8 символов)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={loading}
              />
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={loading}
            >
              {loading ? "Регистрация..." : "Зарегистрироваться"}
            </Button>
          </form>

          <div className="space-y-3 text-center text-sm">
            <p className="text-muted-foreground">
              Уже есть аккаунт?{" "}
              <Link to="/tutor/login" className="text-primary hover:underline">
                Войти
              </Link>
            </p>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  или
                </span>
              </div>
            </div>
            <p className="text-muted-foreground">
              Вы ученик?{" "}
              <Link to="/signup" className="text-primary hover:underline">
                Регистрация ученика
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterTutor;
