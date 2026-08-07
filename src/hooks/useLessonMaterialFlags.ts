import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export interface LessonMaterialFlags {
  hasMaterials: boolean;
  hasHomework: boolean;
}

/**
 * Бейджи «МЗ»/«ДЗ» на ячейках расписания (Волна 1): ОДИН батч-запрос по видимым
 * занятиям недели вместо per-lesson похода в edge (тот остаётся для содержимого шторки).
 *
 * ⚠️ Колонки перечислены ЯВНО: на tutor_lesson_materials действует column-GRANT
 * (миграция 20260602140000) — select('*') упадёт (tutor_id/created_by не выданы
 * authenticated). RLS tlm_tutor_select пропускает свои строки, индекс idx_tlm_lesson
 * покрывает .in(). Display-only запрос (НЕ write-форма) → дефолтный
 * refetchOnWindowFocus допустим, smoke §8 не задет.
 *
 * Инвалидация: prefix ['tutor','lesson-material-flags'] — дёргается при закрытии
 * LessonMaterialsDrawer (там же, где refetchLessons).
 */
export function useLessonMaterialFlags(lessonIds: string[]) {
  // Стабильный ключ по составу занятий: сортировка отвязывает от порядка рендера.
  const idsKey = useMemo(() => [...lessonIds].sort().join('|'), [lessonIds]);

  const { data } = useQuery({
    queryKey: ['tutor', 'lesson-material-flags', idsKey],
    enabled: lessonIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, LessonMaterialFlags>> => {
      const { data: rows, error } = await supabase
        .from('tutor_lesson_materials')
        .select('lesson_id, material_kind')
        .in('lesson_id', lessonIds);

      if (error) {
        // Бейджи — прогрессивное улучшение: сбой не должен ронять сетку (rule 95 — тихо).
        console.error('Error fetching lesson material flags:', error);
        return new Map();
      }

      const map = new Map<string, LessonMaterialFlags>();
      for (const row of (rows ?? []) as { lesson_id: string; material_kind: string }[]) {
        const prev = map.get(row.lesson_id) ?? { hasMaterials: false, hasHomework: false };
        if (row.material_kind === 'homework_ref') prev.hasHomework = true;
        else prev.hasMaterials = true;
        map.set(row.lesson_id, prev);
      }
      return map;
    },
  });

  return data ?? EMPTY_FLAGS;
}

const EMPTY_FLAGS = new Map<string, LessonMaterialFlags>();
