import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabaseClient";
import { readAuthRedirectError, translateAuthError } from "@/lib/authErrors";
import { toast } from "sonner";
import { z } from "zod";

const passwordSchema = z.object({
  password: z.string().min(6, { message: "Минимум 6 символов" }),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

// Recovery links arrive via api.sokratai.ru/functions/v1/email-verify (RU-bypass,
// rule 96), which redirects here with tokens in the URL hash. supabase-js parses
// the hash at client init — BEFORE this lazy page mounts — so we must NOT rely on
// the PASSWORD_RECOVERY event. INITIAL_SESSION is replayed per-subscriber after
// the hash parse, which makes the gate below race-free.
type Gate = "checking" | "ready" | "invalid";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [gate, setGate] = useState<Gate>("checking");
  const [gateError, setGateError] = useState<string | null>(null);

  useEffect(() => {
    // email-verify appends ?email_verify_error=<code> on failure (expired /
    // already-used link) — surface it instead of a dead password form.
    // The shared EMAIL_VERIFY_ERRORS texts are signup-worded («Зарегистрируйтесь
    // заново») — override with recovery-appropriate copy here.
    const RECOVERY_ERROR_OVERRIDES: Record<string, string> = {
      token_expired:
        "Ссылка для сброса пароля истекла. Запросите новую — мы пришлём свежее письмо.",
      token_invalid:
        "Ссылка для сброса пароля уже использована или недействительна. Запросите новую.",
      invalid_type:
        "Некорректная ссылка. Запросите сброс пароля заново.",
      missing_params:
        "Некорректная ссылка. Запросите сброс пароля заново.",
      malformed_token:
        "Ссылка повреждена. Запросите сброс пароля заново.",
    };
    const authErr = readAuthRedirectError(new URLSearchParams(window.location.search));
    if (authErr) {
      setGateError(RECOVERY_ERROR_OVERRIDES[authErr.code] ?? authErr.message);
      setGate("invalid");
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setGate("ready");
      } else if (event === "INITIAL_SESSION") {
        // Hash parsed (or absent), still no session → dead/expired link.
        setGate("invalid");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validation = passwordSchema.safeParse({ password, confirmPassword });
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: validation.data.password,
      });

      if (error) throw error;

      toast.success("Пароль обновлён! Войдите с новым паролем.");
      // Recovery session must not stay alive after the reset. Global signOut
      // needs the network (fails under RU DPI and leaves the local session
      // intact) — fall back to a guaranteed local clear (P1 review 2026-07-14).
      try {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) await supabase.auth.signOut({ scope: "local" });
      } catch {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      }
      navigate("/login");
    } catch (error: unknown) {
      toast.error(translateAuthError(error, "Ошибка обновления пароля"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">Новый пароль</CardTitle>
          <CardDescription className="text-center">
            {gate === "invalid"
              ? "Не получилось открыть ссылку из письма"
              : "Введите новый пароль для вашего аккаунта"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {gate === "checking" && (
            <p className="text-center text-sm text-muted-foreground py-6">
              Проверяем ссылку…
            </p>
          )}

          {gate === "invalid" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                {gateError ??
                  "Ссылка недействительна или истекла. Запросите новое письмо для сброса пароля."}
              </p>
              <Button asChild className="w-full">
                <Link to="/forgot-password">Запросить новую ссылку</Link>
              </Button>
              <Link to="/login" className="text-sm text-muted-foreground hover:underline inline-block">
                Назад к входу
              </Link>
            </div>
          )}

          {gate === "ready" && (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <Input
                type="password"
                placeholder="Новый пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
              <Input
                type="password"
                placeholder="Подтвердите пароль"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
              />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Сохранение..." : "Сохранить пароль"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
