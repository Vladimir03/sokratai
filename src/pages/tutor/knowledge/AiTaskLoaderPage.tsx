import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { KnowledgeBaseFrame } from '@/components/kb/KnowledgeBaseFrame';
import { AiTaskLoaderFlow } from '@/components/kb/AiTaskLoader/AiTaskLoaderFlow';
import type { AiLoaderDestination } from '@/components/kb/AiTaskLoader/reviewTypes';

/**
 * Страница AI-загрузки задач в Базу (`/tutor/knowledge/ai-loader?folder=`).
 *
 * Фаза 1 «один загрузчик — N назначений» (2026-07-20): вся оркестрация
 * (input → extract → ревью → commit) вынесена в shared `AiTaskLoaderFlow`;
 * страница — тонкая KB-обёртка (frame + back + заголовок) с назначением
 * `kb_folder`. hw-потребитель — `HWAiLoaderSheet` в конструкторе ДЗ.
 */
export default function AiTaskLoaderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFolderId = searchParams.get('folder') ?? '';

  const destination = useMemo<AiLoaderDestination>(
    () => ({ kind: 'kb_folder', initialFolderId }),
    [initialFolderId],
  );

  return (
    <KnowledgeBaseFrame>
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => navigate('/tutor/knowledge?tab=mybase')}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-socrat-primary transition-colors duration-200 hover:text-socrat-primary-dark"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Моя база
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-socrat-primary-light text-socrat-primary">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-foreground">AI-загрузка задач</h1>
            <p className="text-xs text-slate-500">
              Вставьте текст или фото — AI разложит задачи по полям, вы проверите и сохраните.
            </p>
          </div>
        </div>

        <AiTaskLoaderFlow destination={destination} />
      </div>
    </KnowledgeBaseFrame>
  );
}
