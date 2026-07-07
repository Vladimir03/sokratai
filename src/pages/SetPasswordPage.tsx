import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { z } from "zod";
import { setPasswordByToken } from "@/lib/setPasswordApi";

/**
 * /set-password?t=<token> — migration page for existing Telegram-only users
 * (RU-compliance, rule 96 «406-ФЗ»). Reached via the bot command `/parol`, which
 * delivers a one-time token. The user sets an email+password on their EXISTING
 * account (history preserved), then logs in via the compliant email+password
 * path. Public route (no AuthGuard); the token authorizes the write server-side.
 */

const schema = z
  .object({
    email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
    password: z.string().min(6, { message: "Минимум 6 символов" }),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Пароли не совпадают",
    path: ["confirmPassword"],
  });

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const validation = schema.safeParse({ email, password, confirmPassword });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setLoading(true);
    try {
      const res = await setPasswordByToken(token, validation.data.email, validation.data.password);
      toast.success(`Готово! Теперь входи по email ${res.email}`, { duration: 8000 });
      navigate("/login");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить пароль");
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
        <Card className="w-full max-w-md shadow-elegant">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">Ссылка недействительна</CardTitle>
            <CardDescription className="text-center">
              Открой ссылку из бота заново или напиши боту команду <b>/parol</b>, чтобы получить новую.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full" style={{ minHeight: 48 }}>
              <Link to="/login">На страницу входа</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Задай пароль</CardTitle>
          <CardDescription className="text-center">
            Вход через Telegram отключён по требованию закона. Укажи email и пароль — дальше будешь входить
            по ним. Прогресс и история сохранятся.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Ваш email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="text-base"
              style={{ fontSize: 16, touchAction: "manipulation" }}
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Пароль (мин. 6 символов)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="text-base"
              style={{ fontSize: 16, touchAction: "manipulation" }}
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Повторите пароль"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
              className="text-base"
              style={{ fontSize: 16, touchAction: "manipulation" }}
            />
            <Button type="submit" className="w-full" disabled={loading} style={{ minHeight: 48 }}>
              {loading ? "Сохранение…" : "Задать пароль"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Уже есть пароль? <Link to="/login" className="underline">Войти</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
