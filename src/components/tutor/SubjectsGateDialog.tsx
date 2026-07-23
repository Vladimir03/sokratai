/**
 * Гейт-диалог «Какие предметы вы ведёте?» (subject-personalization Ф1, 2026-07-23).
 *
 * Заменил мягкий SubjectsNudgeBanner (удалён): 75% репетиторов работали на
 * physics-дефолтах. Модальный, но НЕ тюрьма (решение владельца):
 *  - показывается при входе на 4 гейт-поверхности (База / создание ДЗ /
 *    ученики / пробники), когда контент-предметов в профиле 0;
 *  - «Позже»/overlay/Esc — один код-путь: гасит на всё непрерывное пребывание
 *    в гейт-зоне; повторный ВХОД в гейт-зону или reload показывает снова;
 *  - гаснет НАВСЕГДА только ДАННЫМИ (subjects непусты) — НИКАКОГО localStorage.
 *
 * Монтаж ОДИН раз в AppFrame (переживает route-changes и тихую ре-верификацию
 * TutorGuard, rule 96 §5a — выбранные чипы не теряются на tab-switch).
 * Fail-open: профиль не загружен / ошибка / нет строки → НЕ показывать
 * (ложный гейт на заполненном профиле хуже пропуска — поверхности перепокажут).
 *
 * Фаза 3 добавит сюда чипы экзамен-фокуса под выбранными предметами.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SubjectsMultiSelect } from '@/components/tutor/profile/SubjectsMultiSelect';
import { useTutorProfile, useUpsertTutorProfile } from '@/hooks/useTutorProfile';
import { normalizeContentSubjects } from '@/lib/tutorSubjects';
import { postTrackEvent } from '@/lib/tutorProgressApi';
import { cn } from '@/lib/utils';

/** Поверхность для телеметрии; null = не гейт-зона. */
function matchGateSurface(pathname: string): string | null {
  if (pathname.startsWith('/tutor/knowledge')) return 'knowledge';
  if (pathname === '/tutor/homework/create') return 'homework_create';
  if (/^\/tutor\/homework\/[^/]+\/edit$/.test(pathname)) return 'homework_create';
  if (pathname === '/tutor/students') return 'students';
  if (pathname.startsWith('/tutor/mock-exams')) return 'mock_exams';
  return null;
}

export function SubjectsGateDialog() {
  const location = useLocation();
  const { data: profile } = useTutorProfile();
  const upsert = useUpsertTutorProfile();
  const [selected, setSelected] = useState<string[]>([]);

  const surface = matchGateSurface(location.pathname);
  const needsSubjects =
    profile != null && normalizeContentSubjects(profile.subjects).length === 0;

  // «Позже» — state на непрерывное пребывание в гейт-зоне; вход (false→true
  // перехода matcher'а) сбрасывает. In-memory: reload/remount = новый показ.
  const [postponed, setPostponed] = useState(false);
  const prevInGateRef = useRef(false);
  useEffect(() => {
    const inGate = surface !== null;
    if (inGate && !prevInGateRef.current) setPostponed(false);
    prevInGateRef.current = inGate;
  }, [surface]);

  const open = needsSubjects && surface !== null && !postponed;

  // Телеметрия показа — один раз на каждый показ (false→true переход open).
  const shownTrackedRef = useRef(false);
  useEffect(() => {
    if (open && !shownTrackedRef.current) {
      shownTrackedRef.current = true;
      postTrackEvent({ event: 'subjects_gate_shown', surface });
    }
    if (!open) shownTrackedRef.current = false;
  }, [open, surface]);

  // Review P2 баннера (2026-07-07): «Другое» — не контент-предмет; save только
  // с ['other'] дал бы ложную персонализацию. Требуем ≥1 реальный предмет.
  const hasContentSubject = normalizeContentSubjects(selected).length > 0;

  const handlePostpone = () => {
    if (!open) return;
    setPostponed(true);
    postTrackEvent({ event: 'subjects_gate_postponed', surface });
  };

  const handleSave = () => {
    if (!hasContentSubject || upsert.isPending || !profile) return;
    // Меняем ТОЛЬКО subjects; name/gender передаём текущие (контракт upsert).
    upsert.mutate(
      { name: profile.name, gender: profile.gender, subjects: selected },
      {
        onSuccess: () => {
          toast.success('Предметы сохранены — кабинет настроен под вас');
          postTrackEvent({
            event: 'subjects_gate_saved',
            surface,
            count: selected.length,
          });
          // Диалог закроется сам: upsert сидирует кэш → needsSubjects = false.
        },
        onError: () => toast.error('Не удалось сохранить предметы. Попробуйте ещё раз.'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handlePostpone()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-socrat-primary-light text-socrat-primary">
              <GraduationCap className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="text-left">
              <DialogTitle className="text-base">Какие предметы вы ведёте?</DialogTitle>
              <DialogDescription className="text-xs">
                Настроим кабинет: база задач, конструктор ДЗ, пробники и AI-загрузка
                будут открываться на вашем предмете.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <SubjectsMultiSelect value={selected} onChange={setSelected} hideLabel />

        {selected.length > 0 && !hasContentSubject ? (
          <p className="text-xs text-amber-600">
            Выберите хотя бы один конкретный предмет — «Другое» не настраивает кабинет.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handlePostpone}
            className="min-h-[44px] rounded-lg px-3 py-2 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-700 [touch-action:manipulation]"
          >
            Позже
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasContentSubject || upsert.isPending}
            className={cn(
              'min-h-[44px] rounded-lg px-4 py-2 text-[13px] font-semibold text-white [touch-action:manipulation]',
              hasContentSubject && !upsert.isPending
                ? 'bg-socrat-primary'
                : 'cursor-default bg-socrat-border',
            )}
          >
            {upsert.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
