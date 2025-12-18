import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FunnelData {
  registered: number;
  completedOnboarding: number;
  sentFirstMessage: number;
}

interface AdminFunnelChartProps {
  funnel: FunnelData;
}

export const AdminFunnelChart = ({ funnel }: AdminFunnelChartProps) => {
  const steps = [
    { label: "Регистрация", value: funnel.registered, color: "bg-blue-500" },
    { label: "Онбординг", value: funnel.completedOnboarding, color: "bg-purple-500" },
    { label: "Первое сообщение", value: funnel.sentFirstMessage, color: "bg-green-500" },
  ];

  const maxValue = Math.max(...steps.map(s => s.value), 1);

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg">Воронка конверсии</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {steps.map((step, index) => {
            const width = (step.value / maxValue) * 100;
            const prevValue = index > 0 ? steps[index - 1].value : step.value;
            const conversionRate = prevValue > 0 ? Math.round((step.value / prevValue) * 100) : 0;

            return (
              <div key={step.label} className="space-y-1">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium">{step.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{step.value}</span>
                    {index > 0 && (
                      <span className="text-muted-foreground">
                        ({conversionRate}%)
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-8 bg-muted rounded-lg overflow-hidden">
                  <div
                    className={`h-full ${step.color} transition-all duration-500 flex items-center justify-end pr-3`}
                    style={{ width: `${width}%` }}
                  >
                    {width > 20 && (
                      <span className="text-white text-xs font-medium">{step.value}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
