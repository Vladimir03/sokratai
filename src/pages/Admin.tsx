import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminSummaryCards } from "@/components/admin/AdminSummaryCards";
import { AdminRetentionCards } from "@/components/admin/AdminRetentionCards";
import { AdminFunnelChart } from "@/components/admin/AdminFunnelChart";
import { AdminLineChart } from "@/components/admin/AdminLineChart";
import { ArrowLeft, RefreshCw, Shield } from "lucide-react";

interface CohortRetentionData {
  date: string;
  cohortSize: number;
  d1: { retained: number; rate: number };
  d3: { retained: number; rate: number };
  d7: { retained: number; rate: number };
}

interface AnalyticsData {
  summary: {
    totalUsers: number;
    newUsers: number;
    totalMessages: number;
    activeUsersToday: number;
  };
  registrations: { date: string; value: number }[];
  messages: { date: string; value: number }[];
  dau: { date: string; value: number }[];
  cohortRetention: CohortRetentionData[];
  funnel: {
    registered: number;
    completedOnboarding: number;
    sentFirstMessage: number;
  };
}

const Admin = () => {
  const navigate = useNavigate();
  const { isAdmin, isLoading: isCheckingAdmin } = useAdminAccess();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState("7");

  const fetchAnalytics = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Необходима авторизация");
        return;
      }

      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-analytics?days=${period}`;
      
      const response = await fetch(functionUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Ошибка сервера");
      }

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setAnalytics(data);
    } catch (err) {
      console.error("Error fetching analytics:", err);
      setError(err instanceof Error ? err.message : "Ошибка загрузки аналитики");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isCheckingAdmin && isAdmin) {
      fetchAnalytics();
    }
  }, [isCheckingAdmin, isAdmin, period]);

  if (isCheckingAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Shield className="w-12 h-12 mx-auto text-muted-foreground animate-pulse" />
          <p className="mt-4 text-muted-foreground">Проверка доступа...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <Shield className="w-16 h-16 mx-auto text-destructive" />
          <h1 className="text-2xl font-bold mt-4">Доступ запрещён</h1>
          <p className="text-muted-foreground mt-2">
            У вас нет прав для просмотра этой страницы. 
            Если вы считаете, что это ошибка, свяжитесь с администратором.
          </p>
          <Button onClick={() => navigate("/")} className="mt-6">
            <ArrowLeft className="w-4 h-4 mr-2" />
            На главную
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Админ-панель</h1>
              <p className="text-muted-foreground">Аналитика и метрики</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Период" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 дней</SelectItem>
                <SelectItem value="14">14 дней</SelectItem>
                <SelectItem value="30">30 дней</SelectItem>
                <SelectItem value="90">90 дней</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={fetchAnalytics} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Обновить
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 text-destructive rounded-lg p-4 mb-6">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Skeleton className="h-80" />
              <Skeleton className="h-80" />
            </div>
          </div>
        ) : analytics ? (
          <div className="space-y-6">
            {/* Summary Cards */}
            <AdminSummaryCards data={analytics.summary} />

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdminLineChart
                title="Регистрации"
                data={analytics.registrations}
                color="#22c55e"
              />
              <AdminLineChart
                title="Сообщения"
                data={analytics.messages}
                color="#8b5cf6"
              />
            </div>

            {/* Charts Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AdminLineChart
                title="DAU (активные пользователи)"
                data={analytics.dau}
                color="#3b82f6"
              />
              <AdminRetentionCards cohortRetention={analytics.cohortRetention} />
            </div>

            {/* Funnel */}
            <AdminFunnelChart funnel={analytics.funnel} />
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Admin;
