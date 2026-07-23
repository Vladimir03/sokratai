/**
 * Умный селект предмета (subject-personalization Ф2, 2026-07-23).
 *
 * Нативный `<select>` с группировкой: `<optgroup «Ваши предметы»>` (предметы
 * профиля репетитора, канонический порядок) + `<optgroup «Другие предметы»>`.
 * НИКОГДА не прячет предметы — только группирует (решение владельца).
 * Профиль пуст → плоский список (как раньше).
 *
 * Rule 80 зашит в базу: font-size 16px (iOS auto-zoom) + touch-manipulation.
 * Визуальный хром — через `className` каждой поверхности (twMerge поверх базы).
 *
 * `overrideTracking` — PII-free телеметрия «предвыбранный дефолт vs ручная
 * смена» (`subject_default_overridden`, fire-once per mount): меряем, работает
 * ли персонализация дефолтов. Канонические id = категории, не PII.
 */
import { useRef } from 'react';
import { useTutorProfile } from '@/hooks/useTutorProfile';
import { SUBJECT_NAME_MAP, getSubjectLabel } from '@/types/homework';
import { groupSubjectsBySelection } from '@/lib/tutorSubjects';
import { postTrackEvent } from '@/lib/tutorProgressApi';
import { cn } from '@/lib/utils';

export interface SubjectSelectProps {
  value: string;
  onChange: (subjectId: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  ariaInvalid?: boolean;
  /** Спец-опция сверху («Все предметы» для фильтров / «Не выбран»). */
  topOption?: { value: string; label: string };
  /**
   * Override предметов профиля (когда родитель уже держит их — AddStudentDialog
   * через useTutor). Не задан → внутренний useTutorProfile() (тёплый кэш —
   * SideNav держит подписку на каждой странице кабинета).
   */
  profileSubjects?: readonly string[] | null;
  /**
   * Fire-once `subject_default_overridden` при ПЕРВОЙ ручной смене значения:
   * `from` = фактически показанный дефолт (текущий value на момент смены —
   * ревью P1: прошлый вариант с пропом defaultSubject расходился с реальным
   * префиллом, напр. subjectSnapshot корзины HWDrawer), `to` = выбор тутора.
   */
  overrideTracking?: { surface: string };
}

export function SubjectSelect({
  value,
  onChange,
  id,
  disabled = false,
  className,
  ariaInvalid,
  topOption,
  profileSubjects,
  overrideTracking,
}: SubjectSelectProps) {
  // Хук вызывается безусловно (rules of hooks); prop-override побеждает.
  const { data: internalProfile } = useTutorProfile();
  const subjects = profileSubjects !== undefined ? profileSubjects : internalProfile?.subjects;
  const { yours, others } = groupSubjectsBySelection(subjects);
  const grouped = yours.length > 0 && others.length > 0;

  const overrideTrackedRef = useRef(false);

  // Legacy-значение (math/rus/… из старых записей) — отдельной опцией сверху,
  // чтобы select не показывал пустоту и сохранение не теряло значение.
  const isLegacyValue =
    value !== '' && value !== topOption?.value && !SUBJECT_NAME_MAP[value];

  const handleChange = (next: string) => {
    if (
      overrideTracking &&
      !overrideTrackedRef.current &&
      next !== value &&
      next !== topOption?.value
    ) {
      overrideTrackedRef.current = true;
      postTrackEvent({
        event: 'subject_default_overridden',
        surface: overrideTracking.surface,
        from: value,
        to: next,
      });
    }
    onChange(next);
  };

  const renderOption = (s: { id: string; name: string }) => (
    <option key={s.id} value={s.id}>
      {s.name}
    </option>
  );

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      disabled={disabled}
      aria-invalid={ariaInvalid}
      className={cn('text-[16px] [touch-action:manipulation]', className)}
    >
      {topOption ? <option value={topOption.value}>{topOption.label}</option> : null}
      {isLegacyValue ? (
        <option value={value}>{getSubjectLabel(value)} (legacy)</option>
      ) : null}
      {grouped ? (
        <>
          <optgroup label="Ваши предметы">{yours.map(renderOption)}</optgroup>
          <optgroup label="Другие предметы">{others.map(renderOption)}</optgroup>
        </>
      ) : (
        [...yours, ...others].map(renderOption)
      )}
    </select>
  );
}
