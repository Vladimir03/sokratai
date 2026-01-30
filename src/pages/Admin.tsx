import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/lib/supabaseClient";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminSummaryCards } from "@/components/admin/AdminSummaryCards";
import { AdminRetentionCards } from "@/components/admin/AdminRetentionCards";
import { AdminFunnelChart } from "@/components/admin/AdminFunnelChart";
import { AdminLineChart } from "@/components/admin/AdminLineChart";
import { AdminCRM } from "@/components/admin/AdminCRM";
import { AdminPayments } from "@/components/admin/AdminPayments";
import { AdminSegmentsChart, SegmentsData } from "@/components/admin/AdminSegmentsChart";
import { AdminTopUsers, TopUser } from "@/components/admin/AdminTopUsers";
import { ArrowLeft, RefreshCw, Shield, CalendarIcon, BarChart3, MessageSquare, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

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
  segments: SegmentsData;
  topUsers: TopUser[];
}

const Admin = () => {
  const navigate = useNavigate();
  const { isAdmin, isLoading: isCheckingAdmin } = useAdminAccess();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  const fetchAnalytics = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Необходима авторизация");
        return;
      }

      const startDate = dateRange.from.toISOString().split("T")[0];
      const endDate = dateRange.to.toISOString().split("T")[0];
      
      // Use POST method - GET with body is not allowed by browsers
      const { data, error: invokeError } = await supabase.functions.invoke("admin-analytics", {
        body: { startDate, endDate },
      });

      if (invokeError) {
        console.error("Edge function error:", invokeError);
        throw new Error(invokeError.message || "Ошибка загрузки аналитики");
      }
      
      if (data?.error) {
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
  }, [isCheckingAdmin, isAdmin, dateRange]);

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
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[280px] justify-start text-left font-normal",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "d MMM", { locale: ru })} –{" "}
                        {format(dateRange.to, "d MMM yyyy", { locale: ru })}
                      </>
                    ) : (
                      format(dateRange.from, "d MMM yyyy", { locale: ru })
                    )
                  ) : (
                    <span>Выберите период</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) {
                      setDateRange({ from: range.from, to: range.to });
                    } else if (range?.from) {
                      setDateRange({ from: range.from, to: range.from });
                    }
                  }}
                  numberOfMonths={2}
                  disabled={(date) => date > new Date()}
                  className={cn("p-3 pointer-events-auto")}
                  locale={ru}
                />
              </PopoverContent>
            </Popover>
            <Button variant="outline" onClick={fetchAnalytics} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Обновить
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="analytics" className="space-y-6">
          <TabsList>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Аналитика
            </TabsTrigger>
            <TabsTrigger value="crm" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              CRM
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              Платежи
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analytics">
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

                {/* Segments */}
                {analytics.segments && (
                  <AdminSegmentsChart segments={analytics.segments} />
                )}

                {/* Top Users */}
                {analytics.topUsers && (
                  <AdminTopUsers topUsers={analytics.topUsers} />
                )}

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
          </TabsContent>

          <TabsContent value="crm">
            <AdminCRM />
          </TabsContent>

          <TabsContent value="payments">
            <AdminPayments />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Admin;
