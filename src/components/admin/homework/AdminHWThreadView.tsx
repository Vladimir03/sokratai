import { useEffect, useState, useMemo, lazy, Suspense, Component, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  fetchThreadDetails,
  type AdminThreadMessage,
  type AdminTaskState,
  type AdminThreadMeta,
  type AdminAssignmentMeta,
  type AdminTaskMeta,
} from "@/lib/adminHomeworkApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  User,
  Bot,
  MessageSquare,
  CheckCircle2,
  Clock,
  Lightbulb,
  AlertCircle,
  AlertTriangle,
  Copy,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Code2,
  Filter,
} from "lucide-react";
import { preprocessLatex } from "@/components/kb/ui/preprocessLatex";

// Lazy KaTeX CSS + ReactMarkdown — bundle-friendly.
const ReactMarkdown = lazy(() => import("react-markdown"));

export interface AdminThreadHeader {
  id: string;
  status: string;
  studentName: string;
  assignmentTitle: string;
  assignmentSubject: string;
}

const MESSAGE_KIND_LABELS: Record<string, { label: string; color: string }> = {
  system: { label: "Введение", color: "bg-blue-100 text-blue-700" },
  hint_request: { label: "Подсказка", color: "bg-amber-100 text-amber-700" },
  hint_reply: { label: "Ответ AI на подсказку", color: "bg-amber-50 text-amber-700" },
  check_result: { label: "Проверка", color: "bg-emerald-100 text-emerald-700" },
  ai_reply: { label: "Ответ AI", color: "bg-slate-100 text-slate-700" },
  question: { label: "Вопрос", color: "bg-purple-100 text-purple-700" },
  answer: { label: "Ответ ученика", color: "bg-emerald-50 text-emerald-700" },
  submission: { label: "Сдача задачи", color: "bg-indigo-100 text-indigo-700" },
  tutor_note: { label: "Заметка", color: "bg-rose-100 text-rose-700" },
};

/** Простая эвристика: содержит ли строка markdown или LaTeX, требующие рендеринга. */
function needsRichRender(text: string): boolean {
  return (
    text.includes("$") ||
    text.includes("\\(") ||
    text.includes("\\[") ||
    /[*_`~]/.test(text) ||
    /^\s*#{1,6}\s/m.test(text) ||
    /^\s*[-*+]\s/m.test(text)
  );
}

/** Lightweight rich renderer: ReactMarkdown + remarkMath + rehypeKatex.
 *  Catches render errors → отдаёт onError(err) + рендерит plain text fallback. */
function RichMarkdown({
  text,
  onError,
}: {
  text: string;
  onError?: (err: Error) => void;
}) {
  useEffect(() => {
    void import("katex/dist/katex.min.css");
  }, []);

  const processed = useMemo(() => {
    try {
      return preprocessLatex(text);
    } catch (e) {
      onError?.(e as Error);
      return text;
    }
  }, [text, onError]);

  return (
    <Suspense fallback={<div className="whitespace-pre-wrap break-words">{text}</div>}>
      <div className="prose prose-sm max-w-none break-words [&_p]:my-1 [&_p]:leading-relaxed [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:text-[0.85em] [&_strong]:font-semibold [&_em]:italic">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {processed}
        </ReactMarkdown>
      </div>
    </Suspense>
  );
}

/** Click-to-copy chip с UUID (для багрепортов). */
function CopyIdChip({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-slate-700 hover:bg-slate-100 transition-colors"
      title={`Copy ${label}`}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span>{value.slice(0, 8)}…{value.slice(-4)}</span>
      <Copy className="w-2.5 h-2.5 opacity-50" />
      {copied && <span className="text-emerald-600">✓</span>}
    </button>
  );
}

interface FullScreenImageProps {
  src: string;
  alt: string;
  onClose: () => void;
}

function FullScreenImage({ src, alt, onClose }: FullScreenImageProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Photo gallery — thumbnails + click-to-zoom. */
function PhotoGallery({ urls }: { urls: string[] }) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  if (urls.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="flex flex-wrap gap-1.5">
        {urls.map((url, i) => (
          <button
            key={url + i}
            type="button"
            onClick={() => setZoomed(url)}
            className="relative group rounded-md overflow-hidden border border-slate-200 hover:border-slate-400 transition-colors"
          >
            <img
              src={url}
              alt={`Фото ${i + 1}`}
              className="max-w-[200px] max-h-[120px] object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0.3";
              }}
            />
          </button>
        ))}
      </div>
      {zoomed && <FullScreenImage src={zoomed} alt="Фото в полном размере" onClose={() => setZoomed(null)} />}
    </div>
  );
}

/** Содержит ли сообщение признаки бага (для filter «только битые»). */
function isLikelyBroken(msg: AdminThreadMessage): boolean {
  if (!msg.content?.trim() && (msg.image_urls?.length ?? 0) === 0) return true;
  // Несбалансированный одиночный $ (не $$): чётность должна быть чётной для inline math.
  const inlineDollars = (msg.content.match(/(?<!\$)\$(?!\$)/g) || []).length;
  if (inlineDollars % 2 !== 0) return true;
  // Несбалансированный $$.
  const blockDollars = (msg.content.match(/\$\$/g) || []).length;
  if (blockDollars % 2 !== 0) return true;
  // Markdown bold mismatch (`**`).
  const stars = (msg.content.match(/\*\*/g) || []).length;
  if (stars % 2 !== 0) return true;
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Header sub-components
// ──────────────────────────────────────────────────────────────────────────────

function MetadataIdsPanel({
  thread,
  meta,
}: {
  thread: AdminThreadMeta | null | undefined;
  meta: AdminAssignmentMeta | undefined;
}) {
  if (!thread && !meta) return null;
  return (
    <details className="mt-3 group">
      <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
        <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
        Metadata IDs (click-to-copy)
      </summary>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <CopyIdChip label="thread" value={thread?.id} />
        <CopyIdChip label="student_assignment" value={meta?.student_assignment_id} />
        <CopyIdChip label="assignment" value={meta?.assignment_id} />
        <CopyIdChip label="student" value={meta?.student_id} />
        <CopyIdChip label="tutor" value={meta?.tutor_id} />
        <CopyIdChip label="current_task" value={thread?.current_task_id} />
      </div>
    </details>
  );
}

function TaskSummaryPanel({
  states,
  tasks,
}: {
  states: AdminTaskState[];
  tasks: AdminTaskMeta[];
}) {
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  if (states.length === 0) return null;
  return (
    <details className="mt-2 group">
      <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
        <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
        Сводка по задачам (детально)
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="text-xs w-full">
          <thead className="text-muted-foreground border-b">
            <tr>
              <th className="text-left p-1.5">№</th>
              <th className="text-left p-1.5">KIM</th>
              <th className="text-left p-1.5">kind / format</th>
              <th className="text-left p-1.5">Status</th>
              <th className="text-right p-1.5">Earned</th>
              <th className="text-right p-1.5">AI</th>
              <th className="text-right p-1.5">Tutor</th>
              <th className="text-right p-1.5">Avail</th>
              <th className="text-right p-1.5">Hints</th>
              <th className="text-right p-1.5">Wrong</th>
              <th className="text-right p-1.5">Attempts</th>
              <th className="text-left p-1.5">Force-cmpl</th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => {
              const t = tasksById.get(s.task_id);
              return (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="p-1.5 font-medium">№{t?.order_num ?? "?"}</td>
                  <td className="p-1.5 text-muted-foreground">{t?.kim_number ?? "—"}</td>
                  <td className="p-1.5 text-muted-foreground">
                    {t?.task_kind}/{t?.check_format}
                  </td>
                  <td className="p-1.5">{s.status}</td>
                  <td className="p-1.5 text-right tabular-nums">
                    {s.earned_score ?? "—"} / {t?.max_score ?? "?"}
                  </td>
                  <td className="p-1.5 text-right tabular-nums text-blue-700">{s.ai_score ?? "—"}</td>
                  <td className="p-1.5 text-right tabular-nums text-rose-700">
                    {s.tutor_score_override ?? "—"}
                  </td>
                  <td className="p-1.5 text-right tabular-nums text-muted-foreground">
                    {s.available_score ?? "—"}
                  </td>
                  <td className="p-1.5 text-right tabular-nums">{s.hint_count ?? 0}</td>
                  <td className="p-1.5 text-right tabular-nums">{s.wrong_answer_count ?? 0}</td>
                  <td className="p-1.5 text-right tabular-nums">{s.attempts ?? 0}</td>
                  <td className="p-1.5 text-xs text-muted-foreground">
                    {s.tutor_force_completed_at
                      ? format(parseISO(s.tutor_force_completed_at), "d MMM HH:mm", { locale: ru })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function ActivityTimeline({ messages }: { messages: AdminThreadMessage[] }) {
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    messages.forEach((m) => {
      const t = Date.parse(m.created_at);
      if (Number.isNaN(t) || t < thirtyDaysAgo) return;
      const day = m.created_at.slice(0, 10);
      counts.set(day, (counts.get(day) || 0) + 1);
    });
    // Build dense array of last 30 days.
    const arr: Array<{ day: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      arr.push({ day: key, count: counts.get(key) || 0 });
    }
    return arr;
  }, [messages]);

  const max = Math.max(1, ...days.map((d) => d.count));
  if (days.every((d) => d.count === 0)) return null;

  return (
    <details className="mt-2 group">
      <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
        <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
        Активность за 30 дней ({messages.length} сообщений всего)
      </summary>
      <div className="mt-2 flex items-end gap-[2px] h-12">
        {days.map((d) => (
          <div
            key={d.day}
            className="flex-1 bg-blue-200 hover:bg-blue-400 transition-colors min-w-[3px] rounded-t-sm relative group/bar"
            style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? "2px" : "0" }}
            title={`${d.day}: ${d.count} сообщ.`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>30 дн. назад</span>
        <span>сегодня</span>
      </div>
    </details>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Message bubble
// ──────────────────────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  showRawByDefault,
}: {
  msg: AdminThreadMessage;
  showRawByDefault: boolean;
}) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const isTutor = msg.role === "tutor";
  const kindInfo = msg.message_kind ? MESSAGE_KIND_LABELS[msg.message_kind] : null;
  const [renderError, setRenderError] = useState<Error | null>(null);
  const [showRaw, setShowRaw] = useState(showRawByDefault);
  const [showMeta, setShowMeta] = useState(false);

  useEffect(() => {
    setShowRaw(showRawByDefault);
  }, [showRawByDefault]);

  const broken = isLikelyBroken(msg);
  const useRich = needsRichRender(msg.content) && !showRaw;
  const images = msg.image_urls || [];

  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
          {isSystem ? (
            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
          ) : isTutor ? (
            <User className="w-3.5 h-3.5 text-rose-600" />
          ) : (
            <Bot className="w-3.5 h-3.5 text-primary" />
          )}
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-lg p-3 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isSystem
            ? "bg-muted/50 border border-dashed border-muted-foreground/20"
            : isTutor
            ? "bg-rose-50 border border-rose-200"
            : "bg-muted"
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          {kindInfo && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${kindInfo.color}`}>
              {kindInfo.label}
            </span>
          )}
          {!msg.visible_to_student && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 font-medium inline-flex items-center gap-0.5">
              <EyeOff className="w-2.5 h-2.5" /> Скрыто от ученика
            </span>
          )}
          {msg.task_order != null && (
            <span className={`text-[10px] ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
              Задача {msg.task_order}
            </span>
          )}
          {broken && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium inline-flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5" /> битый синтаксис
            </span>
          )}
          {msg.message_delivery_status && msg.message_delivery_status !== "delivered" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
              {msg.message_delivery_status}
            </span>
          )}
        </div>

        {/* Photo gallery */}
        {images.length > 0 && <PhotoGallery urls={images} />}
        {/* Fallback warning, если в БД есть image_url но не резолвилось ни одного signed URL */}
        {(msg.image_url || "").trim() !== "" && images.length === 0 && (
          <div className="mb-2 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            image_url есть в БД, но signed URL не резолвится. Возможно: orphan ref, удалён файл, или
            битый bucket name. Raw: <code className="break-all">{msg.image_url}</code>
          </div>
        )}

        {/* Content */}
        {renderError && (
          <div className="mb-2 px-2 py-1.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            Ошибка рендеринга: {renderError.message}. Ниже — сырой текст.
          </div>
        )}
        {showRaw || renderError ? (
          <pre
            className={`text-xs font-mono whitespace-pre-wrap break-words ${
              isUser ? "text-primary-foreground/90" : "text-foreground/90"
            } bg-black/5 rounded p-2 max-h-96 overflow-auto`}
          >
            {msg.content}
          </pre>
        ) : useRich ? (
          <ErrorBoundary onError={(e) => setRenderError(e)}>
            <RichMarkdown text={msg.content} onError={(e) => setRenderError(e)} />
          </ErrorBoundary>
        ) : (
          <div className={`text-sm break-words whitespace-pre-wrap ${isUser ? "text-primary-foreground" : ""}`}>
            {msg.content}
          </div>
        )}

        {/* Submission payload */}
        {msg.submission_payload && (
          <details className="mt-2 group/sub">
            <summary className={`text-[10px] cursor-pointer select-none flex items-center gap-1 ${
              isUser ? "text-primary-foreground/70" : "text-muted-foreground"
            }`}>
              <ChevronRight className="w-2.5 h-2.5 group-open/sub:rotate-90 transition-transform" />
              submission_payload (JSONB)
            </summary>
            <pre className={`text-[10px] mt-1 font-mono whitespace-pre-wrap break-words rounded p-2 ${
              isUser ? "bg-black/20 text-primary-foreground/90" : "bg-black/5 text-foreground/80"
            }`}>{JSON.stringify(msg.submission_payload, null, 2)}</pre>
          </details>
        )}

        {/* Footer: timestamp + meta toggle */}
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <div className={`text-xs ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
            {format(parseISO(msg.created_at), "d MMM yyyy, HH:mm:ss", { locale: ru })}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors inline-flex items-center gap-0.5 ${
                isUser
                  ? "border-primary-foreground/30 text-primary-foreground/90 hover:bg-primary-foreground/10"
                  : "border-slate-300 text-muted-foreground hover:bg-slate-100"
              }`}
              title="Toggle raw text view"
            >
              <Code2 className="w-2.5 h-2.5" /> {showRaw ? "rendered" : "raw"}
            </button>
            <button
              type="button"
              onClick={() => setShowMeta((v) => !v)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors inline-flex items-center gap-0.5 ${
                isUser
                  ? "border-primary-foreground/30 text-primary-foreground/90 hover:bg-primary-foreground/10"
                  : "border-slate-300 text-muted-foreground hover:bg-slate-100"
              }`}
              title="Toggle metadata view"
            >
              {showMeta ? "−" : "+"} мета
            </button>
          </div>
        </div>

        {/* Metadata expand */}
        {showMeta && (
          <div className={`mt-2 p-2 rounded text-[10px] font-mono space-y-0.5 ${
            isUser ? "bg-black/20 text-primary-foreground/90" : "bg-black/5 text-foreground/80"
          }`}>
            <div><span className="opacity-60">id:</span> {msg.id}</div>
            <div><span className="opacity-60">role:</span> {msg.role}</div>
            <div><span className="opacity-60">message_kind:</span> {msg.message_kind ?? "null"}</div>
            <div><span className="opacity-60">visible_to_student:</span> {String(msg.visible_to_student)}</div>
            <div><span className="opacity-60">task_id:</span> {msg.task_id ?? "null"}</div>
            <div><span className="opacity-60">task_order:</span> {msg.task_order ?? "null"}</div>
            <div><span className="opacity-60">author_user_id:</span> {msg.author_user_id ?? "null"}</div>
            <div><span className="opacity-60">created_at:</span> {msg.created_at}</div>
            <div><span className="opacity-60">image_url (raw):</span> {msg.image_url ?? "null"}</div>
            <div><span className="opacity-60">image_urls (resolved):</span> {images.length} файл(ов)</div>
            {msg.message_delivery_status && (
              <div><span className="opacity-60">delivery_status:</span> {msg.message_delivery_status}</div>
            )}
            <div><span className="opacity-60">content_length:</span> {msg.content?.length ?? 0} chars</div>
          </div>
        )}
      </div>
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 mt-1">
          <User className="w-3.5 h-3.5" />
        </div>
      )}
    </div>
  );
}

/** Простой error boundary для RichMarkdown failures. */
class ErrorBoundary extends Component<
  { children: ReactNode; onError?: (err: Error) => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

const MESSAGE_KIND_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "system", label: "Введение" },
  { value: "question", label: "Вопрос" },
  { value: "hint_request", label: "Запрос подсказки" },
  { value: "hint_reply", label: "Ответ на подсказку" },
  { value: "answer", label: "Ответ ученика" },
  { value: "submission", label: "Сдача" },
  { value: "check_result", label: "Проверка" },
  { value: "ai_reply", label: "Ответ AI" },
  { value: "tutor_note", label: "Заметка тутора" },
];

export function AdminHWThreadView({ thread }: { thread: AdminThreadHeader }) {
  const [messages, setMessages] = useState<AdminThreadMessage[]>([]);
  const [taskStates, setTaskStates] = useState<AdminTaskState[]>([]);
  const [threadMeta, setThreadMeta] = useState<AdminThreadMeta | null>(null);
  const [assignmentMeta, setAssignmentMeta] = useState<AdminAssignmentMeta | undefined>();
  const [tasks, setTasks] = useState<AdminTaskMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [taskFilter, setTaskFilter] = useState<number | "all">("all");
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const [brokenOnly, setBrokenOnly] = useState(false);
  const [showAllRaw, setShowAllRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetchThreadDetails(thread.id);
        if (!cancelled) {
          setMessages(res.messages || []);
          setTaskStates(res.taskStates || []);
          setThreadMeta(res.thread || null);
          setAssignmentMeta(res.assignmentMeta);
          setTasks(res.tasks || []);
        }
      } catch (err) {
        console.error("Error loading thread data:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [thread.id]);

  const completedTasks = taskStates.filter((ts) => ts.status === "completed").length;
  const totalTasks = taskStates.length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const filteredMessages = useMemo(() => {
    let result = messages;
    if (taskFilter !== "all") {
      result = result.filter((m) => m.task_order === taskFilter);
    }
    if (kindFilter.size > 0) {
      result = result.filter((m) => (m.message_kind ? kindFilter.has(m.message_kind) : false));
    }
    if (brokenOnly) {
      result = result.filter(isLikelyBroken);
    }
    return result;
  }, [messages, taskFilter, kindFilter, brokenOnly]);

  const taskOrders = useMemo(
    () =>
      Array.from(new Set(messages.map((m) => m.task_order).filter((n): n is number => n != null))).sort(
        (a, b) => a - b,
      ),
    [messages],
  );

  const toggleKind = (kind: string) => {
    setKindFilter((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const hasFilters = taskFilter !== "all" || kindFilter.size > 0 || brokenOnly;

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg">{thread.studentName}</CardTitle>
            <p className="text-sm text-muted-foreground truncate">
              {thread.assignmentTitle} • {thread.assignmentSubject}
            </p>
          </div>
          <Badge variant={thread.status === "active" ? "default" : "secondary"}>
            {thread.status === "active" ? "Активен" : "Завершён"}
          </Badge>
        </div>

        {totalTasks > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Прогресс задач</span>
              <span>
                {completedTasks}/{totalTasks}
              </span>
            </div>
            <Progress value={progressPct} className="h-2" />
            <div className="flex gap-2 flex-wrap mt-1">
              {taskStates.map((ts, i) => {
                const taskMeta = tasks.find((t) => t.id === ts.task_id);
                const order = taskMeta?.order_num ?? i + 1;
                return (
                  <Badge
                    key={ts.id}
                    variant="outline"
                    className={`text-[10px] h-5 cursor-pointer ${
                      ts.status === "completed"
                        ? "border-emerald-400 text-emerald-700"
                        : "border-muted-foreground/30"
                    } ${taskFilter === order ? "ring-2 ring-blue-400" : ""}`}
                    onClick={() => setTaskFilter(taskFilter === order ? "all" : order)}
                  >
                    {ts.status === "completed" ? (
                      <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    ) : (
                      <Clock className="w-3 h-3 mr-0.5" />
                    )}
                    №{order}
                    {ts.hint_count > 0 && (
                      <span className="ml-1 flex items-center">
                        <Lightbulb className="w-2.5 h-2.5" />
                        {ts.hint_count}
                      </span>
                    )}
                    {ts.wrong_answer_count > 0 && (
                      <span className="ml-1 flex items-center">
                        <AlertCircle className="w-2.5 h-2.5" />
                        {ts.wrong_answer_count}
                      </span>
                    )}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Header expandable sections */}
        <MetadataIdsPanel thread={threadMeta} meta={assignmentMeta} />
        <TaskSummaryPanel states={taskStates} tasks={tasks} />
        <ActivityTimeline messages={messages} />

        {/* Filters bar */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Фильтр:</span>
          <Button
            size="sm"
            variant={taskFilter === "all" ? "default" : "outline"}
            className="h-6 px-2 text-[11px]"
            onClick={() => setTaskFilter("all")}
          >
            все задачи
          </Button>
          {taskOrders.map((order) => (
            <Button
              key={order}
              size="sm"
              variant={taskFilter === order ? "default" : "outline"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setTaskFilter(taskFilter === order ? "all" : order)}
            >
              №{order}
            </Button>
          ))}
          <span className="mx-1 text-muted-foreground">·</span>
          {MESSAGE_KIND_FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              size="sm"
              variant={kindFilter.has(opt.value) ? "default" : "outline"}
              className="h-6 px-2 text-[11px]"
              onClick={() => toggleKind(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
          <span className="mx-1 text-muted-foreground">·</span>
          <Button
            size="sm"
            variant={brokenOnly ? "destructive" : "outline"}
            className="h-6 px-2 text-[11px]"
            onClick={() => setBrokenOnly((v) => !v)}
          >
            <AlertTriangle className="w-3 h-3 mr-1" />
            только битые
          </Button>
          <span className="mx-1 text-muted-foreground">·</span>
          <Button
            size="sm"
            variant={showAllRaw ? "default" : "outline"}
            className="h-6 px-2 text-[11px]"
            onClick={() => setShowAllRaw((v) => !v)}
            title="Показывать сырой текст всех сообщений"
          >
            <Code2 className="w-3 h-3 mr-1" />
            raw all
          </Button>
          {hasFilters && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px] text-muted-foreground"
              onClick={() => {
                setTaskFilter("all");
                setKindFilter(new Set());
                setBrokenOnly(false);
              }}
            >
              сброс
            </Button>
          )}
          <span className="ml-auto text-muted-foreground text-[10px]">
            {filteredMessages.length} / {messages.length}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {messages.length === 0 ? "Сообщений нет" : "Нет сообщений по выбранному фильтру"}
          </div>
        ) : (
          <ScrollArea className="h-[500px] md:h-[700px]">
            <div className="p-4 space-y-3">
              {filteredMessages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} showRawByDefault={showAllRaw} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
