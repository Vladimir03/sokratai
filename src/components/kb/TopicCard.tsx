import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { ExamBadge } from '@/components/kb/ui/ExamBadge';
import type { KBTopicWithCounts } from '@/types/kb';

interface TopicCardProps {
  topic: KBTopicWithCounts;
  onClick: () => void;
}

export const TopicCard = memo(function TopicCard({ topic, onClick }: TopicCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center justify-between rounded-[22px] border border-socrat-border bg-white px-5 py-4 text-left transition-all duration-200 hover:border-socrat-primary/25 hover:bg-socrat-surface"
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[1.05rem] font-semibold leading-none text-slate-950">{topic.name}</span>
          <ExamBadge exam={topic.exam} />
        </div>

        <div className="text-[13px] text-slate-600">
          {topic.task_count} задач · {topic.material_count} мат.
          {topic.kim_numbers.length > 0 && ` · КИМ № ${topic.kim_numbers.join(', ')}`}
        </div>

        {topic.subtopic_names.length > 0 && (
          <div className="mt-1 truncate text-xs text-slate-400">
            {topic.subtopic_names.join(' · ')}
          </div>
        )}
      </div>

      <ChevronRight className="ml-3 h-[18px] w-[18px] shrink-0 text-slate-400 transition-colors duration-200 group-hover:text-socrat-primary" />
    </button>
  );
});
