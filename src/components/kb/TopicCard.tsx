import { ChevronRight } from 'lucide-react';
import type { KBTopicWithCounts } from '@/types/kb';

interface TopicCardProps {
  topic: KBTopicWithCounts;
  onClick: () => void;
}

export function TopicCard({ topic, onClick }: TopicCardProps) {
  const isOge = topic.exam === 'oge';

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-xl border border-socrat-border bg-white p-3.5 text-left transition-colors hover:border-socrat-primary/30 hover:bg-[#FAFAF8]"
    >
      <div className="min-w-0 flex-1">
        {/* Row 1: name + exam badge */}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[15px] font-semibold">{topic.name}</span>
          <span
            className={
              isOge
                ? 'inline-flex items-center rounded-full bg-socrat-oge-bg px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-socrat-oge'
                : 'inline-flex items-center rounded-full bg-socrat-ege-bg px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-socrat-ege'
            }
          >
            {isOge ? 'ОГЭ' : 'ЕГЭ'}
          </span>
        </div>

        {/* Row 2: stats line */}
        <div className="text-xs text-muted-foreground">
          {topic.task_count} задач · {topic.material_count} мат.
          {topic.kim_numbers.length > 0 && ` · КИМ № ${topic.kim_numbers.join(', ')}`}
        </div>

        {/* Row 3: subtopics */}
        {topic.subtopic_names.length > 0 && (
          <div className="mt-0.5 truncate text-[11px] text-socrat-muted">
            {topic.subtopic_names.join(' · ')}
          </div>
        )}
      </div>

      <ChevronRight className="ml-2 h-[18px] w-[18px] shrink-0 text-socrat-muted" />
    </button>
  );
}
