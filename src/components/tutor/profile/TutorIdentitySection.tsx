import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AvatarUpload } from '@/components/tutor/profile/AvatarUpload';
import {
  useRemoveAvatar,
  useUploadAvatar,
  useUpsertTutorProfile,
} from '@/hooks/useTutorProfile';
import type { TutorGender, TutorProfile } from '@/lib/tutorProfileApi';

/**
 * TutorIdentitySection — top block of /tutor/profile.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.2 §6)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-5
 * Depends: TASK-2 (useTutorProfile hooks), TASK-3 (UserAvatar), TASK-4 (AvatarUpload)
 *
 * Owns: name + gender form (dirty-tracked) + avatar upload/remove (own
 * mutations, immediate persist). `subjects` is intentionally NOT touched
 * here — TASK-13 (SubjectsMultiSelect) will mount as its own section and
 * use the same upsert mutation independently.
 */

export interface TutorIdentitySectionProps {
  profile: TutorProfile | null;
}

type GenderFormValue = 'male' | 'female' | 'unspecified';

const GENDER_TO_FORM: Record<'male' | 'female' | 'none', GenderFormValue> = {
  male: 'male',
  female: 'female',
  none: 'unspecified',
};

function genderToFormValue(value: TutorGender): GenderFormValue {
  if (value === 'male') return 'male';
  if (value === 'female') return 'female';
  return GENDER_TO_FORM.none;
}

function formValueToGender(value: GenderFormValue): TutorGender {
  return value === 'unspecified' ? null : value;
}

export function TutorIdentitySection({ profile }: TutorIdentitySectionProps) {
  const initialName = profile?.name ?? '';
  const initialGender = genderToFormValue(profile?.gender ?? null);
  const subjects = profile?.subjects ?? [];

  const [nameDraft, setNameDraft] = useState(initialName);
  const [genderDraft, setGenderDraft] = useState<GenderFormValue>(initialGender);

  // Re-sync the form when the underlying profile changes (after upload/refetch
  // or when the profile loads for the first time). Without this the form
  // would keep stale values across an empty → loaded transition.
  useEffect(() => {
    setNameDraft(profile?.name ?? '');
    setGenderDraft(genderToFormValue(profile?.gender ?? null));
  }, [profile?.name, profile?.gender]);

  const upsertMutation = useUpsertTutorProfile();
  const uploadMutation = useUploadAvatar();
  const removeMutation = useRemoveAvatar();

  const trimmedName = nameDraft.trim();
  const isDirty = useMemo(() => {
    return trimmedName !== initialName.trim() || genderDraft !== initialGender;
  }, [trimmedName, initialName, genderDraft, initialGender]);

  const isNameValid = trimmedName.length >= 2;
  const isSaving = upsertMutation.isPending;
  const isUploadBusy = uploadMutation.isPending || removeMutation.isPending;
  const canSubmit = isDirty && isNameValid && !isSaving;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    try {
      await upsertMutation.mutateAsync({
        name: trimmedName,
        gender: formValueToGender(genderDraft),
        // Preserve subjects untouched. TASK-13 owns subject editing in its
        // own section using the same mutation.
        subjects,
      });
      toast.success('Профиль сохранён');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить профиль';
      toast.error(message);
    }
  };

  const handleUpload = async (blob: Blob) => {
    await uploadMutation.mutateAsync(blob);
    toast.success('Фото обновлено');
  };

  const handleRemove = async () => {
    await removeMutation.mutateAsync();
    toast.success('Фото удалено');
  };

  return (
    <section
      aria-labelledby="tutor-identity-heading"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2 id="tutor-identity-heading" className="text-lg font-semibold text-slate-900">
        Кто вы для учеников
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Имя и фото видны ученикам в чате с домашним заданием.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[auto,1fr]"
      >
        <div>
          <AvatarUpload
            currentAvatarUrl={profile?.avatar_url ?? null}
            onUpload={handleUpload}
            onRemove={handleRemove}
            isLoading={isUploadBusy}
            gender={profile?.gender ?? null}
            name={profile?.name ?? trimmedName}
          />
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tutor-profile-name" className="text-sm font-medium text-slate-700">
              Имя для учеников
            </Label>
            <Input
              id="tutor-profile-name"
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Например, Вадим Коршунов"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              // text-base = 16px → no iOS Safari auto-zoom on focus.
              className="min-h-[44px] text-base"
              aria-describedby="tutor-profile-name-hint"
              disabled={isSaving}
            />
            <p id="tutor-profile-name-hint" className="text-xs text-slate-500">
              Видно ученикам в чате домашнего задания. Можно с отчеством.
            </p>
          </div>

          <fieldset className="flex flex-col gap-2" disabled={isSaving}>
            <legend className="text-sm font-medium text-slate-700">Пол</legend>
            <RadioGroup
              value={genderDraft}
              onValueChange={(value) => setGenderDraft(value as GenderFormValue)}
              className="flex flex-wrap gap-2"
              aria-label="Пол"
            >
              <GenderOption value="male" label="Мужской" />
              <GenderOption value="female" label="Женский" />
              <GenderOption value="unspecified" label="Не указано" />
            </RadioGroup>
            <p className="text-xs text-slate-500">
              Влияет только на placeholder-аватар, если фото не загружено.
            </p>
          </fieldset>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="submit"
              disabled={!canSubmit}
              className="min-h-[44px] gap-2 bg-accent text-white hover:bg-accent/90 sm:min-w-[160px]"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Сохранить
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

interface GenderOptionProps {
  value: GenderFormValue;
  label: string;
}

function GenderOption({ value, label }: GenderOptionProps) {
  const id = `tutor-profile-gender-${value}`;
  return (
    <Label
      htmlFor={id}
      className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-slate-700 transition-colors hover:border-accent has-[[data-state=checked]]:border-accent has-[[data-state=checked]]:bg-accent/10 has-[[data-state=checked]]:text-accent"
    >
      <RadioGroupItem id={id} value={value} />
      {label}
    </Label>
  );
}

export default TutorIdentitySection;
