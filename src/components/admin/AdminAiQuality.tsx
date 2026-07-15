import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import {
  fetchMockExamQuality,
  fetchMockExamProblems,
  type MockQualityData,
  type MockProblemCase,
} from "@/lib/adminMockExamsApi";

interface Props {
  startDate: string;
  endDate: string;
}

/**
 * «AI-качество» — метрики качества AI-грейдера пробников (расхождение AI vs
 * репетитор, confidence, flags, проблемные кейсы). Извлечено из бывшей
 * вкладки «Пробники» (AdminMockExams → MockQualityPane); подвкладки
 * «Список»/«Воронка» удалены по решению владельца 2026-07-15.
 */
export const AdminAiQuality = ({ startDate, endDate }: Props) => {
  const [data, setData] = useState<MockQualityData | null>(null);
  const [problems, setProblems] = useState<MockProblemCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let c = false;
    setLoading(true);
    Promise.all([fetchMockExamQuality(startDate, endDate), fetchMockExamProblems(startDate, endDate)])
      .then(([q, p]) => { if (!c) { setData(q); setProblems(p); } })
      .catch((e) => console.error("[AdminAiQuality]", e))
      .finally(() => !c && setLoading(false));
    return () => { c = true; };
  }, [startDate, endDate]);

  if (loading) return <Skeleton className="h-40" />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">AI черновиков</div>
          <div className="text-xl font-semibold">{data.totalDrafts}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Низкая confidence</div>
          <div className="text-xl font-semibold">{Math.round(data.lowConfidenceRate * 100)}%</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Override rate</div>
          <div className="text-xl font-semibold">{Math.round(data.overrideRate * 100)}%</div>
          <div className="text-[11px] text-muted-foreground">|Δ| ≈ {data.avgAbsDelta.toFixed(1)} балла</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground">Avg latency grading</div>
          <div className="text-xl font-semibold">{Math.round(data.avgLatencyMs / 1000)}s</div>
          {data.stuckAiCheckingCount > 0 && <div className="text-[11px] text-rose-600">stuck: {data.stuckAiCheckingCount}</div>}
        </CardContent></Card>
      </div>

      <Card><CardContent className="p-4">
        <div className="text-sm font-medium mb-2">Частоты flags</div>
        {Object.keys(data.flagCounts).length === 0 ? (
          <div className="text-xs text-muted-foreground">Нет flags</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {Object.entries(data.flagCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-xs">{k}: {v}</Badge>
            ))}
          </div>
        )}
      </CardContent></Card>

      <Card><CardContent className="p-4">
        <div className="text-sm font-medium mb-2">Confidence по KIM (Часть 2)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {Object.entries(data.kimConfidence).sort(([a], [b]) => Number(a) - Number(b)).map(([k, v]) => (
            <div key={k} className="border rounded p-2">
              <div className="font-medium">№{k}</div>
              <div className="text-muted-foreground">
                high {v.high} · med {v.medium} · <span className="text-rose-600">low {v.low}</span> / {v.total}
              </div>
            </div>
          ))}
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-4">
        <div className="text-sm font-medium mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />Проблемные кейсы ({problems.length})</div>
        {problems.length === 0 ? (
          <div className="text-xs text-muted-foreground">Нет проблемных кейсов 🎉</div>
        ) : (
          <div className="space-y-1 text-xs">
            {problems.map((p, i) => (
              <div key={`${p.attemptId}-${i}`} className="flex items-center justify-between border-l-2 border-amber-300 pl-2 py-1">
                <div>
                  <span className="font-medium">{p.reason}</span>: <span className="text-muted-foreground">{p.detail}</span>
                </div>
                <code className="text-[10px] text-muted-foreground">{p.attemptId.slice(0, 8)}…</code>
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
};
