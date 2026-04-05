import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { FormulaRoundScreen } from '@/components/homework/formula-round/FormulaRoundScreen';
import { RoundResultScreen } from '@/components/homework/formula-round/RoundResultScreen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFormulaRound, useSaveFormulaRoundResult } from '@/hooks/useFormulaRound';
import {
  generateRetryRound,
  generateRound,
  kinematicsFormulas,
  type FormulaQuestion,
  type RoundConfig,
  type RoundResult,
} from '@/lib/formulaEngine';
import type { FormulaRound } from '@/lib/formulaRoundApi';
import { supabase } from '@/lib/supabaseClient';

const PREVIEW_TESTER_PASSWORD = 'FormulaRound123!';

const PREVIEW_TESTERS = {
  '7f4c2e10-0000-4000-8000-000000000301': {
    id: '7f4c2e10-0000-4000-8000-000000000301',
    name: 'Тестировщик 1',
    email: 'formula-round+student1@sokratai.test',
  },
  '7f4c2e10-0000-4000-8000-000000000302': {
    id: '7f4c2e10-0000-4000-8000-000000000302',
    name: 'Тестировщик 2',
    email: 'formula-round+student2@sokratai.test',
  },
  '7f4c2e10-0000-4000-8000-000000000303': {
    id: '7f4c2e10-0000-4000-8000-000000000303',
    name: 'Тестировщик 3',
    email: 'formula-round+student3@sokratai.test',
  },
  '7f4c2e10-0000-4000-8000-000000000304': {
    id: '7f4c2e10-0000-4000-8000-000000000304',
    name: 'Тестировщик 4',
    email: 'formula-round+student4@sokratai.test',
  },
  '7f4c2e10-0000-4000-8000-000000000305': {
    id: '7f4c2e10-0000-4000-8000-000000000305',
    name: 'Тестировщик 5',
    email: 'formula-round+student5@sokratai.test',
  },
} as const;

type PreviewTester = (typeof PREVIEW_TESTERS)[keyof typeof PREVIEW_TESTERS];
type PreviewAuthStatus = 'idle' | 'loading' | 'ready' | 'error';

const PROD_HOSTNAMES = new Set(['sokratai.ru', 'www.sokratai.ru', 'sokratai.lovable.app']);

function isPreviewHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return true;
  }

  if (hostname.endsWith('.lovableproject.com')) {
    return true;
  }

  if (hostname.endsWith('.lovable.app')) {
    return !PROD_HOSTNAMES.has(hostname);
  }

  return !PROD_HOSTNAMES.has(hostname);
}

function getFormulaPool(section: string, formulaCount: number) {
  const normalizedSection = section.trim().toLowerCase();
  const sectionPools: Record<string, typeof kinematicsFormulas> = {
    kinematics: kinematicsFormulas,
    кинематика: kinematicsFormulas,
  };
  const basePool = sectionPools[normalizedSection] ?? kinematicsFormulas;
  const resolvedCount =
    Number.isInteger(formulaCount) && formulaCount > 0
      ? Math.min(formulaCount, basePool.length)
      : basePool.length;

  return basePool.slice(0, resolvedCount);
}

function toRoundConfig(round: FormulaRound): RoundConfig {
  return {
    section: round.section,
    questionCount: round.questions_per_round,
    lives: round.lives,
    formulaPool: getFormulaPool(round.section, round.formula_count),
  };
}

function buildQuestions(
  roundConfig: RoundConfig,
  weakFormulas: RoundResult['weakFormulas'] = [],
): FormulaQuestion[] {
  if (weakFormulas.length > 0) {
    const retryQuestions = generateRetryRound(weakFormulas, roundConfig);
    if (retryQuestions.length > 0) {
      return retryQuestions;
    }
  }

  return generateRound(roundConfig);
}

// Job: пройти раунд по формулам и сразу увидеть слабые места, чтобы понять, что повторить дальше.
const StudentFormulaRound = () => {
  const navigate = useNavigate();
  const { id = '', roundId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const previewStudentId = searchParams.get('student')?.trim() ?? '';
  const previewModeRequested = Boolean(previewStudentId);
  const previewHost = isPreviewHost();
  const previewTester = useMemo<PreviewTester | null>(
    () => PREVIEW_TESTERS[previewStudentId as keyof typeof PREVIEW_TESTERS] ?? null,
    [previewStudentId],
  );
  const previewModeEnabled = previewHost && previewModeRequested;
  const [previewAuthStatus, setPreviewAuthStatus] = useState<PreviewAuthStatus>(
    previewModeEnabled ? 'idle' : 'ready',
  );
  const [previewAuthError, setPreviewAuthError] = useState<string | null>(null);
  const roundQueryEnabled = previewAuthStatus === 'ready';
  const { data: round, isLoading, error } = useFormulaRound(
    roundQueryEnabled ? roundId : '',
  );
  const saveResultMutation = useSaveFormulaRoundResult();

  const [questions, setQuestions] = useState<FormulaQuestion[]>([]);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);

  const roundConfig = useMemo(
    () => (round ? toRoundConfig(round) : null),
    [round],
  );
  const assignmentMismatch = Boolean(round && id && round.assignment_id !== id);
  const roundScreenKey = useMemo(
    () => questions.map((question) => question.id).join(':'),
    [questions],
  );

  useEffect(() => {
    let cancelled = false;

    if (!previewModeEnabled) {
      setPreviewAuthStatus('ready');
      setPreviewAuthError(null);
      return () => {
        cancelled = true;
      };
    }

    if (!previewTester) {
      setPreviewAuthStatus('error');
      setPreviewAuthError('Неизвестный preview student в ссылке.');
      return () => {
        cancelled = true;
      };
    }

    const bootstrapPreviewSession = async () => {
      setPreviewAuthStatus('loading');
      setPreviewAuthError(null);

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (session?.user?.id === previewTester.id) {
          if (!cancelled) {
            setPreviewAuthStatus('ready');
          }
          return;
        }

        if (session?.user?.id && session.user.id !== previewTester.id) {
          const { error: signOutError } = await supabase.auth.signOut();
          if (signOutError) {
            throw signOutError;
          }
        }

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: previewTester.email,
          password: PREVIEW_TESTER_PASSWORD,
        });

        if (signInError) {
          throw signInError;
        }

        if (!cancelled) {
          setPreviewAuthStatus('ready');
        }
      } catch (authError) {
        if (!cancelled) {
          setPreviewAuthStatus('error');
          setPreviewAuthError(
            authError instanceof Error
              ? authError.message
              : 'Не удалось включить preview-режим для тестировщика.',
          );
        }
      }
    };

    void bootstrapPreviewSession();

    return () => {
      cancelled = true;
    };
  }, [previewModeEnabled, previewTester]);

  useEffect(() => {
    if (!round?.id || !roundConfig) {
      return;
    }

    setRoundResult(null);
    setQuestions(buildQuestions(roundConfig));
  }, [round?.id, roundConfig]);

  const handleRoundComplete = useCallback(
    (result: RoundResult) => {
      setRoundResult(result);
      saveResultMutation.mutate(
        { roundId, result },
        {
          onError: (mutationError) => {
            toast.error(
              mutationError instanceof Error
                ? mutationError.message
                : 'Не удалось сохранить результат раунда.',
            );
          },
        },
      );
    },
    [roundId, saveResultMutation],
  );

  const handleRetryErrors = useCallback(() => {
    if (!roundConfig || !roundResult) {
      return;
    }

    setQuestions(buildQuestions(roundConfig, roundResult.weakFormulas));
    setRoundResult(null);
  }, [roundConfig, roundResult]);

  const handleClose = useCallback(() => {
    navigate(id ? `/homework/${id}` : '/homework');
  }, [id, navigate]);

  const errorMessage = useMemo(() => {
    if (previewModeRequested && !previewHost) {
      return 'Preview-ссылка с ?student= работает только на preview/dev хосте.';
    }
    if (previewAuthError) {
      return previewAuthError;
    }
    if (assignmentMismatch) {
      return 'Этот раунд не относится к выбранной домашке.';
    }
    if (error instanceof Error) {
      return error.message;
    }
    if (!roundId) {
      return 'Не указан roundId.';
    }
    return 'Не удалось загрузить раунд.';
  }, [assignmentMismatch, error, previewAuthError, previewHost, previewModeRequested, roundId]);

  const pageContent = (
    <>
      {previewModeEnabled && previewTester ? (
        <div className="px-4 pt-4">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 shadow-sm">
            <Badge variant="secondary">Preview mode</Badge>
            <Badge variant="outline">{previewTester.name}</Badge>
            <span className="text-xs text-slate-600">{previewTester.id}</span>
          </div>
        </div>
      ) : null}

      {(previewAuthStatus === 'error' ||
        assignmentMismatch ||
        error ||
        !roundId ||
        !id ||
        (previewModeRequested && !previewHost)) &&
      !isLoading ? (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">
              Раунд недоступен
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {errorMessage}
            </p>
            <Button className="mt-6 w-full" onClick={handleClose}>
              Вернуться к домашке
            </Button>
          </div>
        </div>
      ) : null}

      {!assignmentMismatch &&
      !error &&
      id &&
      roundId &&
      previewAuthStatus === 'loading' ? (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="mt-4 text-sm text-slate-500">
              Входим как {previewTester?.name ?? 'тестировщик'}...
            </p>
          </div>
        </div>
      ) : null}

      {!assignmentMismatch &&
      !error &&
      id &&
      roundId &&
      isLoading &&
      previewAuthStatus === 'ready' ? (
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="mt-4 text-sm text-slate-500">Готовим раунд...</p>
          </div>
        </div>
      ) : null}

      {!assignmentMismatch &&
      !error &&
      id &&
      roundId &&
      !isLoading &&
      roundConfig &&
      roundResult ? (
        <RoundResultScreen
          result={roundResult}
          onRetryErrors={handleRetryErrors}
          onClose={handleClose}
        />
      ) : null}

      {!assignmentMismatch &&
      !error &&
      id &&
      roundId &&
      !isLoading &&
      roundConfig &&
      questions.length > 0 &&
      !roundResult ? (
        <FormulaRoundScreen
          key={roundScreenKey}
          roundConfig={roundConfig}
          questions={questions}
          onComplete={handleRoundComplete}
        />
      ) : null}
    </>
  );

  if (previewModeEnabled) {
    return (
      <>
        <Navigation />
        <div className="pt-14 pb-20 md:pb-4">
          {pageContent}
        </div>
      </>
    );
  }

  return <AuthGuard>{pageContent}</AuthGuard>;
};

export default StudentFormulaRound;
