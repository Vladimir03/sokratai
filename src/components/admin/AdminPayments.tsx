import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { CreditCard, Search } from "lucide-react";

interface PaymentWithProfile {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: string;
  subscription_days: number;
  subscription_expires_at: string | null;
  created_at: string;
  profile: {
    username: string;
    telegram_username: string | null;
  } | null;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  succeeded: { label: "Оплачен", variant: "default" },
  pending: { label: "Ожидание", variant: "secondary" },
  canceled: { label: "Отменён", variant: "destructive" },
};

export const AdminPayments = () => {
  const [payments, setPayments] = useState<PaymentWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchPayments = async () => {
    setIsLoading(true);
    try {
      // Fetch payments
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("id, user_id, amount, currency, status, subscription_days, subscription_expires_at, created_at")
        .order("created_at", { ascending: false });

      if (paymentsError) throw paymentsError;

      // Fetch profiles separately
      const userIds = [...new Set(paymentsData?.map(p => p.user_id) || [])];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, username, telegram_username")
        .in("id", userIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      
      const combined: PaymentWithProfile[] = (paymentsData || []).map(payment => ({
        ...payment,
        profile: profilesMap.get(payment.user_id) || null,
      }));
      
      setPayments(combined);
    } catch (err) {
      console.error("Error fetching payments:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredPayments = useMemo(() => {
    if (!searchQuery.trim()) return payments;
    
    const query = searchQuery.toLowerCase();
    return payments.filter((payment) => {
      const username = payment.profile?.username?.toLowerCase() || "";
      const telegram = payment.profile?.telegram_username?.toLowerCase() || "";
      return username.includes(query) || telegram.includes(query);
    });
  }, [payments, searchQuery]);

  const stats = useMemo(() => {
    const succeededPayments = filteredPayments.filter(p => p.status === "succeeded");
    return {
      total: filteredPayments.length,
      succeededCount: succeededPayments.length,
      totalAmount: succeededPayments.reduce((sum, p) => sum + Number(p.amount), 0),
    };
  }, [filteredPayments]);

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), "d MMM yyyy, HH:mm", { locale: ru });
  };

  const formatExpiryDate = (dateString: string | null) => {
    if (!dateString) return "—";
    return format(new Date(dateString), "d MMM yyyy", { locale: ru });
  };

  const getStatusBadge = (status: string) => {
    const config = statusConfig[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getUserDisplay = (payment: PaymentWithProfile) => {
    if (payment.profile?.telegram_username) {
      return `@${payment.profile.telegram_username}`;
    }
    return payment.profile?.username || payment.user_id.slice(0, 8);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            История платежей
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5" />
          История платежей
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или @username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Table */}
        <ScrollArea className="h-[400px] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Пользователь</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Подписка до</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {searchQuery ? "Платежи не найдены" : "Нет платежей"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredPayments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(payment.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {getUserDisplay(payment)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatAmount(payment.amount, payment.currency)}
                    </TableCell>
                    <TableCell>{getStatusBadge(payment.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatExpiryDate(payment.subscription_expires_at)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>

        {/* Stats */}
        <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4">
          <span>
            Всего платежей: <span className="font-medium text-foreground">{stats.total}</span>
            {stats.total !== stats.succeededCount && (
              <span> (успешных: {stats.succeededCount})</span>
            )}
          </span>
          <span>
            Общая сумма: <span className="font-medium text-foreground">{formatAmount(stats.totalAmount, "RUB")}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
