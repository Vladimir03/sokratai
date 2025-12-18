import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface RetentionData {
  rate: number;
  cohortSize: number;
  retained: number;
}

interface AdminRetentionCardsProps {
  retention: {
    day1: RetentionData;
    day3: RetentionData;
    day7: RetentionData;
  };
}

export const AdminRetentionCards = ({ retention }: AdminRetentionCardsProps) => {
  const retentionCards = [
    { label: "D1 Retention", data: retention.day1, color: "bg-blue-500" },
    { label: "D3 Retention", data: retention.day3, color: "bg-purple-500" },
    { label: "D7 Retention", data: retention.day7, color: "bg-green-500" },
  ];

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg">Retention</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {retentionCards.map((card) => (
            <div key={card.label} className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">{card.label}</span>
                <span className="text-sm text-muted-foreground">
                  {card.data.retained}/{card.data.cohortSize} ({card.data.rate}%)
                </span>
              </div>
              <Progress value={card.data.rate} className="h-2" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
