import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export interface Bucket {
  label: string;
  count: number;
  share: number;
}

interface Props {
  successBuckets: Bucket[];
  failureBuckets: Bucket[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const BucketList = ({ items, tone }: { items: Bucket[]; tone: "good" | "bad" }) => {
  if (!items.length) {
    return <div className="text-sm text-muted-foreground">Нет данных за период</div>;
  }
  return (
    <ol className="space-y-2">
      {items.slice(0, 3).map((b, i) => (
        <li key={i} className="flex items-start justify-between gap-3 text-sm">
          <div className="flex items-start gap-2 min-w-0">
            <span className="text-xs font-bold text-muted-foreground w-4 shrink-0 mt-0.5">{i + 1}.</span>
            <span className="leading-snug">{b.label}</span>
          </div>
          <div className="text-right shrink-0">
            <div className={tone === "good" ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>
              {b.count}
            </div>
            <div className="text-xs text-muted-foreground">{pct(b.share)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
};

export const PatternBuckets = ({ successBuckets, failureBuckets }: Props) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Card animate={false}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Успешные паттерны
          </CardTitle>
          <p className="text-xs text-muted-foreground">Что чаще приводит к значимому прогрессу (от значимых тредов)</p>
        </CardHeader>
        <CardContent>
          <BucketList items={successBuckets} tone="good" />
        </CardContent>
      </Card>
      <Card animate={false}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            Паттерны застревания
          </CardTitle>
          <p className="text-xs text-muted-foreground">Что чаще встречается среди начатых тредов без успеха</p>
        </CardHeader>
        <CardContent>
          <BucketList items={failureBuckets} tone="bad" />
        </CardContent>
      </Card>
    </div>
  );
};
