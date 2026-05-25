import { supabase } from "@/lib/supabaseClient";

export interface MockAssignmentSummary {
  id: string;
  title: string;
  variantTitle: string | null;
  mode: string;
  status: string;
  deadline: string | null;
  createdAt: string;
  counters: {
    total: number;
    in_progress: number;
    submitted: number;
    ai_checking: number;
    awaiting_review: number;
    approved: number;
    manually_entered: number;
  };
}

export interface MockTutorOverview {
  tutorId: string;
  tutorName: string;
  assignments: MockAssignmentSummary[];
  totals: { assignments: number; attempts: number; awaiting_review: number };
}

export interface MockFunnelData {
  funnel: {
    assignments: number;
    attempts: number;
    started: number;
    submitted: number;
    ai_checked: number;
    approved: number;
  };
  statusDistribution: Record<string, number>;
}

export interface MockQualityData {
  totalDrafts: number;
  lowConfidenceRate: number;
  overrideRate: number;
  avgAbsDelta: number;
  avgLatencyMs: number;
  stuckAiCheckingCount: number;
  flagCounts: Record<string, number>;
  kimConfidence: Record<number, { low: number; medium: number; high: number; total: number }>;
  ocrAttempted: number;
  ocrFailed: number;
}

export interface MockProblemCase {
  attemptId: string;
  assignmentId: string;
  reason: string;
  detail: string;
}

export interface MockAttemptRaw {
  attempt: Record<string, unknown> & { id: string; status: string; assignment_id: string };
  part1Answers: Array<{ kim_number: number; student_answer: string | null; earned_score: number | null; score_source: string | null; is_correct: boolean | null }>;
  part2Solutions: Array<{ kim_number: number; ai_draft_json: Record<string, unknown> | null; tutor_score: number | null; tutor_comment: string | null; status: string; updated_at: string }>;
  assignment: { id: string; title: string; mode: string; status: string; tutor_id: string } | null;
  studentName: string | null;
}

async function invokeMockExams<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-mock-exams", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const fetchMockExamList = (start: string, end: string) =>
  invokeMockExams<{ tutors: MockTutorOverview[] }>({ action: "list", start, end }).then((d) => d.tutors || []);

export const fetchMockExamFunnel = (start: string, end: string) =>
  invokeMockExams<MockFunnelData>({ action: "funnel", start, end });

export const fetchMockExamQuality = (start: string, end: string) =>
  invokeMockExams<MockQualityData>({ action: "quality", start, end });

export const fetchMockExamProblems = (start: string, end: string) =>
  invokeMockExams<{ cases: MockProblemCase[] }>({ action: "problems", start, end }).then((d) => d.cases || []);

export const fetchMockExamAttemptRaw = (attemptId: string) =>
  invokeMockExams<MockAttemptRaw | null>({ action: "attempt_raw", attemptId });