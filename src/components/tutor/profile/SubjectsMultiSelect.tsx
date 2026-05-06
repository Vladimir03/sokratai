import type { KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';
import { SUBJECTS } from '@/types/homework';

export interface SubjectsMultiSelectProps {
  value: string[];
  onChange: (subjects: string[]) => void;
}

/**
 * Canonical-order subjects array so save state is deterministic regardless
 * of the user's toggle history. Without this, two users selecting the same
 * pair in different order would produce different `tutors.subjects` arrays
 * and the dirty-check in TutorProfile would falsely flag identical sets as
 * changed.
 */
function sortByCanonicalOrder(subjectIds: Iterable<string>): string[] {
  const set = new Set(subjectIds);
  return SUBJECTS.filter((subject) => set.has(subject.id)).map((subject) => subject.id);
}

export function SubjectsMultiSelect({ value, onChange }: SubjectsMultiSelectProps) {
  const selectedSubjects = new Set(value);

  const toggleSubject = (subjectId: string) => {
    const next = new Set(selectedSubjects);
    if (next.has(subjectId)) {
      next.delete(subjectId);
    } else {
      next.add(subjectId);
    }
    onChange(sortByCanonicalOrder(next));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, subjectId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    toggleSubject(subjectId);
  };

  return (
    <div className="flex flex-col gap-3">
      <span id="tutor-profile-subjects-label" className="text-sm font-medium text-slate-700">
        Предметы, которые я преподаю
      </span>

      <div
        role="group"
        aria-labelledby="tutor-profile-subjects-label"
        className="flex flex-wrap gap-2"
      >
        {SUBJECTS.map((subject) => {
          const isSelected = selectedSubjects.has(subject.id);

          return (
            <button
              key={subject.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggleSubject(subject.id)}
              onKeyDown={(event) => handleKeyDown(event, subject.id)}
              className={cn(
                'min-h-[44px] rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2',
                isSelected
                  ? 'bg-accent text-white hover:bg-accent/90'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-accent hover:text-slate-900',
              )}
            >
              {subject.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default SubjectsMultiSelect;
