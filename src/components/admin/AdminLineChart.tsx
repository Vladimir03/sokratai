import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

interface ChartDataPoint {
  date: string;
  value: number;
  students?: number;
  tutors?: number;
}

interface AdminLineChartProps {
  title: string;
  data: ChartDataPoint[];
  color?: string;
  multiLine?: boolean;
}

export const AdminLineChart = ({ title, data, color = "#8884d8", multiLine = false }: AdminLineChartProps) => {
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
              {multiLine && <Legend />}
              <Line
                type="monotone"
                dataKey="value"
                name={multiLine ? "Всего" : undefined}
                stroke={color}
                strokeWidth={2}
                dot={{ fill: color, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: color }}
              />
              {multiLine && (
                <>
                  <Line
                    type="monotone"
                    dataKey="students"
                    name="Ученики"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ fill: "#3b82f6", strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: "#3b82f6" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="tutors"
                    name="Репетиторы"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={{ fill: "#f97316", strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: "#f97316" }}
                  />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
