import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

interface CohortRetentionData {
  date: string;
  cohortSize: number;
  d1: { retained: number; rate: number };
  d3: { retained: number; rate: number };
  d7: { retained: number; rate: number };
}

interface AdminRetentionCardsProps {
  cohortRetention: CohortRetentionData[];
}

const getRetentionCellColor = (rate: number): string => {
  if (rate < 0) return "bg-muted text-muted-foreground";
  if (rate === 0) return "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400";
  if (rate < 20) return "bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-400";
  if (rate < 40) return "bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-400";
  if (rate < 60) return "bg-lime-100 dark:bg-lime-950 text-lime-700 dark:text-lime-400";
  return "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400";
};

const formatRetentionCell = (data: { retained: number; rate: number }) => {
  if (data.rate < 0) return "—";
  return `${data.rate}%`;
};

export const AdminRetentionCards = ({ cohortRetention }: AdminRetentionCardsProps) => {
  const sortedData = [...cohortRetention].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg">Когортный Retention</CardTitle>
      </CardHeader>
      <CardContent>
        {sortedData.length === 0 ? (
          <p className="text-muted-foreground text-sm">Нет данных за выбранный период</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Дата регистрации</TableHead>
                  <TableHead className="text-center">Когорта</TableHead>
                  <TableHead className="text-center">D1</TableHead>
                  <TableHead className="text-center">D3</TableHead>
                  <TableHead className="text-center">D7</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((row) => (
                  <TableRow key={row.date}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {format(parseISO(row.date), "d MMM", { locale: ru })}
                    </TableCell>
                    <TableCell className="text-center">{row.cohortSize}</TableCell>
                    <TableCell className={`text-center ${getRetentionCellColor(row.d1.rate)}`}>
                      {formatRetentionCell(row.d1)}
                    </TableCell>
                    <TableCell className={`text-center ${getRetentionCellColor(row.d3.rate)}`}>
                      {formatRetentionCell(row.d3)}
                    </TableCell>
                    <TableCell className={`text-center ${getRetentionCellColor(row.d7.rate)}`}>
                      {formatRetentionCell(row.d7)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
