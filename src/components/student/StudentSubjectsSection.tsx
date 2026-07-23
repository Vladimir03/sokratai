/**
 * «Мои предметы» в профиле ученика (subject-personalization Ф7, решение
 * владельца 2026-07-23: массив profiles.subjects).
 *
 * ИНВАРИАНТ (условие владельца): предметы профиля ученика — ТОЛЬКО для
 * свободного AI-чата и самостоятельной практики. В guided ДЗ и пробниках AI
 * всегда берёт предмет назначения/варианта (server-side wins) — этот массив
 * в grading-контекст НЕ попадает.
 *
 * Self-contained: свой fetch/persist (own-row RLS на profiles), страницу
 * Profile не связывает. difficult_subject (онбординг) живёт параллельно —
 * читатели предпочитают массив.
 */
import { useEffect, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SubjectsMultiSelect } from '@/components/common/SubjectsMultiSelect';
import { supabase } from '@/lib/supabaseClient';
import { normalizeStudentSubjects } from '@/lib/tutorSubjects';
import { useToast } from '@/hooks/use-toast';

export function StudentSubjectsSection() {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  // Ревью P2-3: сбой чтения (в т.ч. 42703 до применения миграции) → секцию
  // ПРЯЧЕМ, а не показываем пустую редактируемую форму с падающим «Сохранить».
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) {
          if (!cancelled) setLoadFailed(true);
          return;
        }
        const { data, error } = await supabase
          .from('profiles')
          .select('subjects, difficult_subject')
          .eq('id', uid)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setLoadFailed(true);
          return;
        }
        const row = data as { subjects?: unknown; difficult_subject?: unknown };
        // normalizeStudentSubjects: legacy-id (math/cs/rus) → канонические,
        // иначе чипы не подсветились бы (ревью 5.6 P2 №9).
        const arr = normalizeStudentSubjects(
          Array.isArray(row.subjects)
            ? (row.subjects as unknown[]).filter((s): s is string => typeof s === 'string')
            : typeof row.difficult_subject === 'string' && row.difficult_subject
              ? [row.difficult_subject]
              : [],
        );
        setSaved(arr);
        setDraft(arr);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) return;
      // narrow-cast до регенерации types.ts (колонка — миграция 20260723140000).
      const { error } = await supabase
        .from('profiles')
        .update({ subjects: draft } as never)
        .eq('id', uid);
      if (error) throw new Error(error.message);
      setSaved(draft);
      toast({ title: 'Предметы сохранены' });
    } catch {
      toast({ title: 'Не удалось сохранить предметы', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded || loadFailed) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-accent" aria-hidden="true" />
          Мои предметы
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Для самостоятельных занятий с Сократом (чат, практика). В домашках и
          пробниках предмет задаёт репетитор.
        </p>
        <SubjectsMultiSelect value={draft} onChange={setDraft} hideLabel />
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!isDirty || saving}
            onClick={handleSave}
            className="min-h-[44px] gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Сохранить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
