import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

interface ChartDataPoint {
  date: string;
  value: number;
}

interface AdminLineChartProps {
  title: string;
  data: ChartDataPoint[];
  color?: string;
}

export const AdminLineChart = ({ title, data, color = "#8884d8" }: AdminLineChartProps) => {
  const formattedData = data.map(item => ({
    ...item,
    formattedDate: format(parseISO(item.date), "d MMM", { locale: ru }),
  }));

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formattedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="formattedDate" 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                dot={{ fill: color, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: color }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
