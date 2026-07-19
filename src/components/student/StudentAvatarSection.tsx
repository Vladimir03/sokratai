import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { AvatarUpload } from '@/components/common/AvatarUpload';
import {
  removeStudentAvatar,
  setStudentGender,
  uploadStudentAvatar,
  type StudentGender,
} from '@/lib/studentAvatarApi';

/**
 * Аватар ученика на /profile (запрос Елены 2026-07-13: «дети любят аватарки»).
 * Реюз shared AvatarUpload (кроп 512×512, сжатие ≤2МБ, Ctrl+V) + радио пола
 * (плейсхолдер мальчик/девочка, когда фото нет — mirror TutorIdentitySection).
 * Persist сразу при изменении, без кнопки «Сохранить». Аватар автоматически
 * виден репетитору и группе: чат/списки/ДЗ уже читают profiles.avatar_url.
 */

type GenderValue = StudentGender | 'unspecified';

export interface StudentAvatarSectionProps {
  avatarUrl: string | null;
  gender: StudentGender | null;
  name?: string;
  onAvatarChange: (url: string | null) => void;
  onGenderChange: (gender: StudentGender | null) => void;
}

export function StudentAvatarSection({
  avatarUrl,
  gender,
  name,
  onAvatarChange,
  onGenderChange,
}: StudentAvatarSectionProps) {
  const [savingGender, setSavingGender] = useState(false);

  const handleUpload = async (blob: Blob) => {
    const url = await uploadStudentAvatar(blob);
    onAvatarChange(url);
    toast.success('Аватар обновлён — репетитор и группа увидят его в чатах');
  };

  const handleRemove = async () => {
    await removeStudentAvatar();
    onAvatarChange(null);
    toast.success('Фото удалено');
  };

  const handleGenderChange = async (value: string) => {
    const next: StudentGender | null = value === 'male' || value === 'female' ? value : null;
    setSavingGender(true);
    try {
      await setStudentGender(next);
      onGenderChange(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSavingGender(false);
    }
  };

  const genderValue: GenderValue = gender ?? 'unspecified';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Аватар</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <AvatarUpload
          currentAvatarUrl={avatarUrl}
          onUpload={handleUpload}
          onRemove={handleRemove}
          gender={gender}
          name={name}
          pasteTelemetryTag="student_avatar_paste"
        />

        <fieldset className="flex min-w-0 flex-1 flex-col gap-2" disabled={savingGender}>
          <legend className="text-sm font-medium text-slate-700">Пол</legend>
          <RadioGroup
            value={genderValue}
            onValueChange={(value) => void handleGenderChange(value)}
            className="flex flex-col gap-1 sm:flex-row sm:gap-2"
            aria-label="Пол"
          >
            {(
              [
                ['male', 'Мужской'],
                ['female', 'Женский'],
                ['unspecified', 'Не указан'],
              ] as const
            ).map(([value, label]) => (
              <Label
                key={value}
                className={cn(
                  'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-normal',
                  // Подсветка выбранного через state, НЕ :has() (rule 80, Safari 15).
                  genderValue === value
                    ? 'border-accent bg-accent/5'
                    : 'border-slate-200',
                )}
                style={{ touchAction: 'manipulation' }}
              >
                <RadioGroupItem value={value} />
                {label}
              </Label>
            ))}
          </RadioGroup>
          <p className="text-xs text-slate-500">
            Влияет только на аватар по умолчанию, если фото не загружено.
          </p>
        </fieldset>
      </CardContent>
    </Card>
  );
}

export default StudentAvatarSection;
