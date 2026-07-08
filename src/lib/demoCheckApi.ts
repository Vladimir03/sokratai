/**
 * Клиент демо-разбора «проверить свою задачу» (v2.1 W1-B).
 *
 * Бьёт в существующий homework-api route `POST /tutor/demo-check` (ядро
 * грейдинга `evaluateStudentAnswer` — без нового edge). Hardcoded
 * `api.sokratai.ru` (RU bypass, AGENTS.md). Ошибки homework-api — nested
 * `{error:{code,message}}`, парсим напрямую (rule 97).
 */
import { supabase, SUPABASE_PUBLISHABLE_KEY } from "@/lib/supabaseClient";
import type {
  HomeworkAiCriteriaItem,
  HomeworkFlowchartTrace,
} from "@/types/homework";

const HOMEWORK_API_URL = "https://api.sokratai.ru/functions/v1/homework-api";

export interface DemoCheckInput {
  subject: string;
  exam_type?: "ege" | "oge";
  task_text: string;
  answer_text: string;
  /** № КИМ (физика Часть 2 № 21-26 → блок-схема ФИПИ). */
  kim_number?: number | null;
  /** Макс. балл шкалы предмета (общество № 25 = 4 и т.п.). Дефолт 3. */
  max_score?: number | null;
}

export interface DemoCheckResult {
  verdict: string;
  feedback: string;
  ai_score: number | null;
  max_score: number;
  criteria_breakdown: HomeworkAiCriteriaItem[] | null;
  flowchart_trace: HomeworkFlowchartTrace | null;
}

export class DemoCheckError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DemoCheckError";
    this.status = status;
    this.code = code;
  }
}

async function postDemoCheck(body: unknown): Promise<Response> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new DemoCheckError(401, "UNAUTHORIZED", "Нет активной сессии");
  return fetch(`${HOMEWORK_API_URL}/tutor/demo-check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(body),
  });
}

function parseNestedError(
  errorBody: unknown,
  fallback: string,
): { code: string; message: string } {
  const e = (errorBody as { error?: { code?: string; message?: string } } | null)
    ?.error;
  return { code: e?.code ?? "ERROR", message: e?.message ?? fallback };
}

export async function runDemoCheck(input: DemoCheckInput): Promise<DemoCheckResult> {
  const resp = await postDemoCheck(input);
  if (!resp.ok) {
    let errorBody: unknown = {};
    try {
      errorBody = await resp.json();
    } catch {
      // ignore parse error
    }
    const { code, message } = parseNestedError(errorBody, `HTTP ${resp.status}`);
    throw new DemoCheckError(resp.status, code, message);
  }
  return resp.json() as Promise<DemoCheckResult>;
}

/**
 * Fire-and-forget beacon «открыл готовый пример разбора»
 * (funnel-событие tutor_demo_check_viewed, once-per-tutor server-side).
 */
export function logDemoCheckViewed(): void {
  void postDemoCheck({ action: "view" }).catch(() => {
    // best-effort: сбой телеметрии не влияет на UX
  });
}
