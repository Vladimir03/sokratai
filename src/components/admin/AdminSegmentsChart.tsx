import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Crown, Clock, User, TrendingUp } from "lucide-react";

export interface SegmentData {
  count: number;
  avgMessagesPerDay: number;
  highlyActive: number;
}

export interface SegmentsData {
  premium: SegmentData;
  trial: SegmentData;
  free: SegmentData;
}

interface AdminSegmentsChartProps {
  segments: SegmentsData;
}

const COLORS = {
  premium: "#f59e0b", // amber/gold
  trial: "#8b5cf6",   // purple
  free: "#64748b",    // slate
};

const LABELS = {
  premium: "Premium",
  trial: "Триал",
  free: "Бесплатные",
};

const ICONS = {
  premium: Crown,
  trial: Clock,
  free: User,
};

export const AdminSegmentsChart = ({ segments }: AdminSegmentsChartProps) => {
  const total = segments.premium.count + segments.trial.count + segments.free.count;
  
  const pieData = [
    { name: LABELS.premium, value: segments.premium.count, color: COLORS.premium },
    { name: LABELS.trial, value: segments.trial.count, color: COLORS.trial },
    { name: LABELS.free, value: segments.free.count, color: COLORS.free },
  ].filter(d => d.value > 0);

  const segmentRows = [
    { key: "premium" as const, data: segments.premium },
    { key: "trial" as const, data: segments.trial },
    { key: "free" as const, data: segments.free },
  ];

  const getPercentage = (count: number) => {
    if (total === 0) return 0;
    return Math.round((count / total) * 100);
  };

  const getHighlyActivePercentage = (segment: SegmentData) => {
    if (segment.count === 0) return 0;
    return Math.round((segment.highlyActive / segment.count) * 100);
  };

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Вовлечённость по сегментам
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => [`${value} польз.`, "Количество"]}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground">Сегмент</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground">Польз.</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground">Сообщ./день</th>
                  <th className="text-right py-3 px-2 font-medium text-muted-foreground">8+ в день</th>
                </tr>
              </thead>
              <tbody>
                {segmentRows.map(({ key, data }) => {
                  const Icon = ICONS[key];
                  return (
                    <tr key={key} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: COLORS[key] }}
                          />
                          <Icon className="w-4 h-4" style={{ color: COLORS[key] }} />
                          <span className="font-medium">{LABELS[key]}</span>
                        </div>
                      </td>
                      <td className="text-right py-3 px-2">
                        <span className="font-semibold">{data.count}</span>
                        <span className="text-muted-foreground text-xs ml-1">
                          ({getPercentage(data.count)}%)
                        </span>
                      </td>
                      <td className="text-right py-3 px-2">
                        <span className="font-semibold">{data.avgMessagesPerDay.toFixed(1)}</span>
                      </td>
                      <td className="text-right py-3 px-2">
                        <span className="font-semibold">{data.highlyActive}</span>
                        <span className="text-muted-foreground text-xs ml-1">
                          ({getHighlyActivePercentage(data)}%)
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30">
                  <td className="py-3 px-2 font-semibold">Всего</td>
                  <td className="text-right py-3 px-2 font-semibold">{total}</td>
                  <td className="text-right py-3 px-2 font-semibold">
                    {total > 0 
                      ? ((segments.premium.avgMessagesPerDay * segments.premium.count +
                          segments.trial.avgMessagesPerDay * segments.trial.count +
                          segments.free.avgMessagesPerDay * segments.free.count) / total).toFixed(1)
                      : "0.0"
                    }
                  </td>
                  <td className="text-right py-3 px-2 font-semibold">
                    {segments.premium.highlyActive + segments.trial.highlyActive + segments.free.highlyActive}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};