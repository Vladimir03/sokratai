import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, ExternalLink } from "lucide-react";

export interface TopUser {
  id: string;
  username: string;
  telegramUsername: string | null;
  segment: "premium" | "trial" | "free";
  messageCount: number;
  avgPerDay: number;
}

interface AdminTopUsersProps {
  topUsers: TopUser[];
}

const segmentConfig = {
  premium: { label: "Premium", className: "bg-green-500/10 text-green-600 border-green-500/20" },
  trial: { label: "Trial", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  free: { label: "Free", className: "bg-muted text-muted-foreground border-border" },
};

export function AdminTopUsers({ topUsers }: AdminTopUsersProps) {
  if (!topUsers || topUsers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            Топ-10 активных пользователей
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            Нет данных за выбранный период
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          Топ-10 активных пользователей
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-2 text-muted-foreground font-medium text-sm">#</th>
                <th className="text-left py-3 px-2 text-muted-foreground font-medium text-sm">Пользователь</th>
                <th className="text-left py-3 px-2 text-muted-foreground font-medium text-sm">Сегмент</th>
                <th className="text-right py-3 px-2 text-muted-foreground font-medium text-sm">Сообщений</th>
                <th className="text-right py-3 px-2 text-muted-foreground font-medium text-sm">В день</th>
              </tr>
            </thead>
            <tbody>
              {topUsers.map((user, index) => {
                const segment = segmentConfig[user.segment];
                const isHighlyActive = user.avgPerDay >= 8;
                
                return (
                  <tr 
                    key={user.id} 
                    className={`border-b border-border/50 ${isHighlyActive ? "bg-yellow-500/5" : ""}`}
                  >
                    <td className="py-3 px-2 font-medium">
                      {index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : index + 1}
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex flex-col">
                        <span className="font-medium">{user.username}</span>
                        {user.telegramUsername && (
                          <a
                            href={`https://t.me/${user.telegramUsername}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
                          >
                            @{user.telegramUsername}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <Badge variant="outline" className={segment.className}>
                        {segment.label}
                      </Badge>
                    </td>
                    <td className="py-3 px-2 text-right font-medium">
                      {user.messageCount}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span className={isHighlyActive ? "text-yellow-600 font-medium" : ""}>
                        {user.avgPerDay.toFixed(1)}
                      </span>
                      {isHighlyActive && <span className="ml-1">🔥</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
