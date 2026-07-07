/**
 * Онбординг-нудж «Какие предметы ведёте?» (2026-07-07).
 *
 * Кейс A иерархии дефолтов (самый частый): при регистрации предметы НЕ
 * спрашиваются → `tutors.subjects = {}` → персонализация кабинета (дефолт
 * предмета в Базе/конструкторе/AI-загрузчике) не работает. Баннер собирает
 * предметы там, где боль — прямо в «Базе задач», реюзом профильных чипов.
 *
 * Показ гейтится родителем (профиль загружен И subjects пуст) + dismiss в
 * localStorage (не назойливо: «Позже» скрывает навсегда до очистки браузера).
 */
import { useState } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { toast } from 'sonner';
import { SubjectsMultiSelect } from '@/components/tutor/profile/SubjectsMultiSelect';
import { useUpsertTutorProfile } from '@/hooks/useTutorProfile';
import type { TutorProfile } from '@/lib/tutorProfileApi';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'sokrat-subjects-nudge-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

interface SubjectsNudgeBannerProps {
  /** Загруженный профиль (родитель гарантирует profile.subjects.length === 0). */
  profile: TutorProfile;
}

export function SubjectsNudgeBanner({ profile }: SubjectsNudgeBannerProps) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [selected, setSelected] = useState<string[]>([]);
  const upsert = useUpsertTutorProfile();

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — скроется до перезагрузки */
    }
  };

  // Review P2 (2026-07-07): «Другое» — не контент-предмет (resolveTutorDefaultSubject
  // его игнорирует) → save только с ['other'] дал бы ЛОЖНУЮ персонализацию
  // («кабинет настроен», а дефолты остались physics). Требуем ≥1 реальный предмет.
  const hasContentSubject = selected.some((s) => s !== 'other');

  const handleSave = () => {
    if (!hasContentSubject || upsert.isPending) return;
    // Меняем ТОЛЬКО subjects; name/gender передаём текущие (контракт upsert).
    upsert.mutate(
      { name: profile.name, gender: profile.gender, subjects: selected },
      {
        onSuccess: () => {
          toast.success('Предметы сохранены — кабинет настроен под вас');
          // Баннер исчезнет сам: родитель гейтит по subjects.length === 0.
        },
        onError: () => toast.error('Не удалось сохранить предметы. Попробуйте ещё раз.'),
      },
    );
  };

  return (
    <div className="relative rounded-[22px] border border-socrat-border bg-white/80 px-5 py-4">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Скрыть"
        className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 [touch-action:manipulation]"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-socrat-primary-light text-socrat-primary">
          <GraduationCap className="h-4.5 w-4.5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-800">Какие предметы вы ведёте?</p>
          <p className="text-xs text-slate-500">
            Настроим кабинет: база задач, конструктор ДЗ и AI-загрузка будут открываться на вашем предмете.
          </p>
        </div>
      </div>

      <SubjectsMultiSelect value={selected} onChange={setSelected} />

      {selected.length > 0 && !hasContentSubject ? (
        <p className="mt-2 text-xs text-amber-600">
          Выберите хотя бы один конкретный предмет — «Другое» не настраивает кабинет.
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-700 [touch-action:manipulation]"
        >
          Позже
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasContentSubject || upsert.isPending}
          className={cn(
            'rounded-lg px-4 py-2 text-[13px] font-semibold text-white [touch-action:manipulation]',
            hasContentSubject && !upsert.isPending
              ? 'bg-socrat-primary'
              : 'cursor-default bg-socrat-border',
          )}
        >
          {upsert.isPending ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
