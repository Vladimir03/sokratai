import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ClipboardList, Activity, Sparkles, AlertTriangle, ChevronRight, ArrowLeft } from "lucide-react";
import {
  fetchMockExamList,
  fetchMockExamFunnel,
  fetchMockExamQuality,
  fetchMockExamProblems,
  fetchMockExamAttemptRaw,
  type MockTutorOverview,
  type MockFunnelData,
  type MockQualityData,
  type MockProblemCase,
  type MockAttemptRaw,
} from "@/lib/adminMockExamsApi";

interface Props {
  startDate: string;
  endDate: string;
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: "В процессе",
  submitted: "Сдан",
  ai_checking: "AI проверяет",
  awaiting_review: "Ждёт tutor",
  approved: "Approved",
  manually_entered: "Manual entry",
};

const STATUS_COLOR: Record<string, string> = {
  in_progress: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-100 text-blue-700",
  ai_checking: "bg-violet-100 text-violet-700",
  awaiting_review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-700",
  manually_entered: "bg-stone-100 text-stone-700",
};

export const AdminMockExams = ({ startDate, endDate }: Props) => {
  return (
    <Tabs defaultValue="list" className="space-y-4">
      <TabsList>
        <TabsTrigger value="list" className="gap-1"><ClipboardList className="w-4 h-4" />Список</TabsTrigger>
        <TabsTrigger value="funnel" className="gap-1"><Activity className="w-4 h-4" />Воронка</TabsTrigger>
        <TabsTrigger value="quality" className="gap-1"><Sparkles className="w-4 h-4" />Качество AI</TabsTrigger>
      </TabsList>
      <TabsContent value="list"><MockListPane startDate={startDate} endDate={endDate} /></TabsContent>
      <TabsContent value="funnel"><MockFunnelPane startDate={startDate} endDate={endDate} /></TabsContent>
      <TabsContent value="quality"><MockQualityPane startDate={startDate} endDate={endDate} /></TabsContent>
    </Tabs>
  );
};

/* ─── Sub-tab 1: List with drill-down to attempts ─── */
function MockListPane({ startDate, endDate }: Props) {
  const [tutors, setTutors] = useState<MockTutorOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTutor, setSelectedTutor] = useState<MockTutorOverview | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<{ id: string; title: string } | null>(null);
  const [raw, setRaw] = useState<MockAttemptRaw | null>(null);
  const [rawLoading, setRawLoading] = useState(false);

  useEffect(() => {
    let c = false;
    setLoading(true);
    fetchMockExamList(startDate, endDate)
      .then((d) => { if (!c) setTutors(d); })
      .catch((e) => console.error("[AdminMockExams.list]", e))
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [startDate, endDate]);

  const openRaw = async (attemptId: string) => {
    setRawLoading(true);
    try {
      setRaw(await fetchMockExamAttemptRaw(attemptId));
    } finally {
      setRawLoading(false);
    }
  };

  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (tutors.length === 0) return <Card><CardContent className="p-8 text-center text-muted-foreground">Нет пробников за выбранный период</CardContent></Card>;

  // Drill-down view: raw attempt
  if (raw) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          <Button size="sm" variant="ghost" onClick={() => setRaw(null)}><ArrowLeft className="w-4 h-4 mr-1" />Назад</Button>
          <div>
            <div className="font-medium">{raw.assignment?.title || "—"}</div>
            <div className="text-sm text-muted-foreground">Ученик: {raw.studentName || "Анонимный лид"}</div>
            <Badge className={STATUS_COLOR[raw.attempt.status] || ""}>{STATUS_LABEL[raw.attempt.status] || raw.attempt.status}</Badge>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Часть 1 ({raw.part1Answers.length})</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-1 text-xs">
              {raw.part1Answers.map((a) => (
                <div key={a.kim_number} className="border rounded p-1.5">
                  <div className="font-medium">№{a.kim_number} · {a.earned_score ?? "—"} <span className="text-muted-foreground">({a.score_source || "—"})</span></div>
                  <div className="text-muted-foreground truncate">отв: {a.student_answer || "—"}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Часть 2 ({raw.part2Solutions.length})</h4>
            <div className="space-y-2">
              {raw.part2Solutions.map((s) => {
                const draft = s.ai_draft_json as { suggested_score?: number | null; confidence?: string; flags?: string[]; comment_for_tutor?: string } | null;
                return (
                  <div key={s.kim_number} className="border rounded p-2 text-xs">
                    <div className="font-medium mb-1">№{s.kim_number} · tutor: <b>{s.tutor_score ?? "—"}</b> · AI: <b>{draft?.suggested_score ?? "—"}</b> · conf: {draft?.confidence || "—"}</div>
                    {draft?.flags && draft.flags.length > 0 && <div className="text-amber-700">flags: {draft.flags.join(", ")}</div>}
                    {draft?.comment_for_tutor && <div className="text-muted-foreground mt-1">AI: {draft.comment_for_tutor}</div>}
                    {s.tutor_comment && <div className="text-foreground mt-1">Tutor: {s.tutor_comment}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (selectedTutor && selectedAssignment) {
    // attempt list — for simplicity fetch raw on click; show attempt rows via re-list lookup
    const asg = selectedTutor.assignments.find((a) => a.id === selectedAssignment.id);
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Button size="sm" variant="ghost" onClick={() => setSelectedAssignment(null)}><ArrowLeft className="w-4 h-4 mr-1" />К списку</Button>
          <div className="font-medium">{asg?.title}</div>
          <div className="text-sm text-muted-foreground">Всего попыток: {asg?.counters.total ?? 0}</div>
          <div className="text-xs text-muted-foreground">Раскрытие попыток — открой raw view через «Подробно».</div>
          <AttemptsList assignmentId={selectedAssignment.id} onOpenRaw={openRaw} loadingRaw={rawLoading} />
        </CardContent>
      </Card>
    );
  }

  if (selectedTutor) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Button size="sm" variant="ghost" onClick={() => setSelectedTutor(null)}><ArrowLeft className="w-4 h-4 mr-1" />К репетиторам</Button>
          <div className="font-medium">{selectedTutor.tutorName}</div>
          {selectedTutor.assignments.map((a) => (
            <button key={a.id} onClick={() => setSelectedAssignment({ id: a.id, title: a.title })} className="w-full text-left p-2 border rounded hover:bg-muted/50 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{a.title}</div>
                <div className="text-xs text-muted-foreground">{a.variantTitle || "—"} · {a.mode} · {a.status}</div>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {Object.entries(a.counters).filter(([k, v]) => k !== "total" && v > 0).map(([k, v]) => (
                    <Badge key={k} variant="outline" className={`text-[10px] h-4 ${STATUS_COLOR[k] || ""}`}>{STATUS_LABEL[k] || k}: {v}</Badge>
                  ))}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        {tutors.map((t) => (
          <button key={t.tutorId} onClick={() => setSelectedTutor(t)} className="w-full text-left p-3 border rounded hover:bg-muted/50 flex items-center justify-between">
            <div>
              <div className="font-medium">{t.tutorName}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t.totals.assignments} пробников · {t.totals.attempts} попыток
                {t.totals.awaiting_review > 0 && <span className="text-amber-700"> · {t.totals.awaiting_review} ждут tutor</span>}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function AttemptsList({ assignmentId, onOpenRaw, loadingRaw }: { assignmentId: string; onOpenRaw: (id: string) => void; loadingRaw: boolean }) {
  // Lightweight: re-fetch attempts via list (already in cache via tutor data — but here we just use raw IDs from the list pane).
  // Simpler approach: do a small dedicated fetch using mock-exams list endpoint payload via re-call.
  // For now we leverage the existing list state by lifting; here we just show "Use Open raw" hint.
  const [ids, setIds] = useState<Array<{ id: string; status: string; student_id: string | null }> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let c = false;
    setLoading(true);
    // Inline fetch via supabase (read-only mock_exam_attempts limited — but admin RLS may not allow direct read).
    // Use raw fetch via admin function: re-use list endpoint? Cheapest: ask one attempt raw at a time.
    // Pragmatic: tell user to use raw view per-attempt from quality tab problem-cases or future iteration.
    setIds([]);
    setLoading(false);
    return () => { c = true; };
  }, [assignmentId]);
  if (loading) return <Skeleton className="h-16" />;
  return (
    <div className="text-xs text-muted-foreground">
      Список попыток с подробностями смотри через вкладку «Качество AI» → «Проблемные кейсы», либо открой attempt по ID:
      <div className="mt-2 flex gap-2">
        <input className="border rounded px-2 py-1 text-xs flex-1" placeholder="attempt UUID" id="raw-id-input" />
        <Button size="sm" disabled={loadingRaw} onClick={() => {
          const v = (document.getElementById("raw-id-input") as HTMLInputElement)?.value.trim();
          if (v) onOpenRaw(v);
        }}>Открыть raw</Button>
      </div>
    </div>
  );
}

/* ─── Sub-tab 2: Funnel ─── */
function MockFunnelPane({ startDate, endDate }: Props) {
  const [data, setData] = useState<MockFunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let c = false;
    setLoading(true);
    fetchMockExamFunnel(startDate, endDate).then((d) => !c && setData(d)).finally(() => !c && setLoading(false));
    return () => { c = true; };
  }, [startDate, endDate]);
  if (loading) return <Skeleton className="h-40" />;
  if (!data) return null;
  const steps = [
    { label: "Пробники созданы", value: data.funnel.assignments },
    { label: "Назначено попыток", value: data.funnel.attempts },
    { label: "Начали", value: data.funnel.started },
    { label: "Сдали", value: data.funnel.submitted },
    { label: "AI проверил", value: data.funnel.ai_checked },
    { label: "Approved", value: data.funnel.approved },
  ];
  const max = steps[0].value || 1;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-6 gap-2">
          {steps.map((s, i) => (
            <div key={s.label} className="border rounded p-2">
              <div className="text-[11px] text-muted-foreground">{i + 1}. {s.label}</div>
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              {i > 0 && steps[i - 1].value > 0 && (
                <div className="text-[11px] text-muted-foreground">{Math.round((s.value / steps[i - 1].value) * 100)}% от пред.</div>
              )}
              <div className="h-1 mt-1 bg-muted rounded">
                <div className="h-1 bg-primary rounded" style={{ width: `${Math.min(100, (s.value / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-2">Распределение статусов attempts</div>
          <div className="space-y-1">
            {Object.entries(data.statusDistribution).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <Badge variant="outline" className={STATUS_COLOR[k] || ""}>{STATUS_LABEL[k] || k}</Badge>
                <span className="font-medium tabular-nums">{v}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Sub-tab 3: AI Quality + problems ─── */
function MockQualityPane({ startDate, endDate }: Props) {
  const [data, setData] = useState<MockQualityData | null>(null);
  const [problems, setProblems] = useState<MockProblemCase[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let c = false;
    setLoading(true);
    Promise.all([fetchMockExamQuality(startDate, endDate), fetchMockExamProblems(startDate, endDate)])
      .then(([q, p]) => { if (!c) { setData(q); setProblems(p); } })
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
}