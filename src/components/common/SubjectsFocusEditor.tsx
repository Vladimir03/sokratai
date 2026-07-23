/**
 * Предметы + экзамен-фокус ПО КАЖДОМУ предмету (subject-personalization Ф3,
 * 2026-07-23). Обёртка над SubjectsMultiSelect: под каждым ВЫБРАННЫМ
 * контент-предметом — чипы фокуса (ЕГЭ/ОГЭ/Школа/Олимпиады, мультивыбор).
 * Фокус пер-предметный (ревью A2 спеки — общий массив давал межпредметную
 * утечку «ЕГЭ во французскую форму»). Значение — карта
 * `tutors.exam_focus_by_subject`; снятие предмета вычищает его фокус.
 *
 * Потребители: TutorProfile (секция «Предметы») + SubjectsGateDialog.
 * Фокус опционален — prefill-сигнал (resolveTutorDefaultExam), не гейт.
 */
import { SubjectsMultiSelect } from '@/components/common/SubjectsMultiSelect';
import { getSubjectLabel } from '@/types/homework';
import { normalizeContentSubjects, type ExamFocusValue } from '@/lib/tutorSubjects';
import { cn } from '@/lib/utils';

const FOCUS_OPTIONS: { value: ExamFocusValue; label: string }[] = [
  { value: 'ege', label: 'ЕГЭ' },
  { value: 'oge', label: 'ОГЭ' },
  { value: 'school', label: 'Школьная программа' },
  { value: 'olympiad', label: 'Олимпиады' },
];

export interface SubjectsFocusEditorProps {
  subjects: string[];
  onSubjectsChange: (subjects: string[]) => void;
  focusMap: Record<string, ExamFocusValue[]>;
  onFocusMapChange: (map: Record<string, ExamFocusValue[]>) => void;
  hideLabel?: boolean;
}

export function SubjectsFocusEditor({
  subjects,
  onSubjectsChange,
  focusMap,
  onFocusMapChange,
  hideLabel = false,
}: SubjectsFocusEditorProps) {
  const contentSubjects = normalizeContentSubjects(subjects);

  const handleSubjectsChange = (next: string[]) => {
    onSubjectsChange(next);
    // Снятый предмет → вычищаем его фокус (не копить мусор в JSONB).
    const nextContent = new Set(normalizeContentSubjects(next));
    const pruned: Record<string, ExamFocusValue[]> = {};
    for (const [subj, values] of Object.entries(focusMap)) {
      if (nextContent.has(subj)) pruned[subj] = values;
    }
    if (Object.keys(pruned).length !== Object.keys(focusMap).length) {
      onFocusMapChange(pruned);
    }
  };

  const toggleFocus = (subjectId: string, value: ExamFocusValue) => {
    const current = focusMap[subjectId] ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    const nextMap = { ...focusMap };
    if (next.length > 0) nextMap[subjectId] = next;
    else delete nextMap[subjectId];
    onFocusMapChange(nextMap);
  };

  return (
    <div className="flex flex-col gap-3">
      <SubjectsMultiSelect value={subjects} onChange={handleSubjectsChange} hideLabel={hideLabel} />

      {contentSubjects.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-500">
            К чему готовите (по желанию) — настроит дефолты экзамена в формах:
          </span>
          {contentSubjects.map((subjectId) => (
            <div key={subjectId} className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-[120px] text-sm text-slate-700">
                {getSubjectLabel(subjectId)}:
              </span>
              <div
                role="group"
                aria-label={`Экзамен-фокус: ${getSubjectLabel(subjectId)}`}
                className="flex flex-wrap gap-1.5"
              >
                {FOCUS_OPTIONS.map((opt) => {
                  const active = (focusMap[subjectId] ?? []).includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleFocus(subjectId, opt.value)}
                      className={cn(
                        'min-h-[44px] rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 [touch-action:manipulation]',
                        active
                          ? 'bg-accent text-white hover:bg-accent/90'
                          : 'border border-slate-200 bg-white text-slate-600 hover:border-accent hover:text-slate-900',
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
