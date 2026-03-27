import { Card, CardContent } from "@/components/ui/card";
import { Users, MessageSquare, UserCheck, TrendingUp } from "lucide-react";

interface SummaryData {
  totalUsers: number;
  totalTutors: number;
  totalStudents: number;
  newUsers: number;
  newTutors: number;
  newStudents: number;
  totalMessages: number;
  activeUsersToday: number;
}

interface AdminSummaryCardsProps {
  data: SummaryData;
}

export const AdminSummaryCards = ({ data }: AdminSummaryCardsProps) => {
  const cards = [
    {
      title: "Всего пользователей",
      value: data.totalUsers,
      sub: `${data.totalStudents} уч. / ${data.totalTutors} реп.`,
      icon: Users,
      color: "text-blue-500",
      bgColor: "bg-blue-50",
    },
    {
      title: "Новых за период",
      value: data.newUsers,
      sub: `${data.newStudents} уч. / ${data.newTutors} реп.`,
      icon: TrendingUp,
      color: "text-green-500",
      bgColor: "bg-green-50",
    },
    {
      title: "Сообщений за период",
      value: data.totalMessages,
      icon: MessageSquare,
      color: "text-purple-500",
      bgColor: "bg-purple-50",
    },
    {
      title: "Активных сегодня",
      value: data.activeUsersToday,
      icon: UserCheck,
      color: "text-orange-500",
      bgColor: "bg-orange-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.title} animate={false} className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="text-3xl font-bold mt-1">{card.value.toLocaleString()}</p>
                {"sub" in card && card.sub && (
                  <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                )}
              </div>
              <div className={`p-3 rounded-full ${card.bgColor}`}>
                <card.icon className={`w-6 h-6 ${card.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
