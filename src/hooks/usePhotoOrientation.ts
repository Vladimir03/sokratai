/**
 * Углы поворота фото для набора storage-ref'ов (волна 1, план 1-ancient-quokka).
 *
 * Читают ВСЕ (ученику фото должно показываться так же, как репетитору),
 * пишет только репетитор — гейт стоит в SECURITY DEFINER `photo_orientations_set`,
 * клиентский флаг лишь прячет кнопки.
 *
 * ⚠️ Оптимистичность обязательна: поворот обязан быть мгновенным. Именно
 * мгновенность — причина, по которой мы храним угол, а не перекодируем файл
 * (перезапись стоила бы 1,5–7 с ожидания на каждое фото и потери качества).
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  type OrientationMap,
  type PhotoDegrees,
  fetchPhotoOrientations,
  rotateDegrees,
  savePhotoOrientation,
} from '@/lib/photoOrientation';

/**
 * Общий префикс ключа. Мутация обновляет ВСЕ закэшированные наборы, содержащие
 * этот ref, — поэтому миниатюра в ленте поворачивается вместе с открытым фото
 * (репетитор видит результат, не открывая заново).
 */
export const PHOTO_ORIENTATION_KEY_ROOT = 'photo-orientations' as const;

/** Порядок ref'ов не влияет на ответ — ключ обязан быть стабильным. */
function orientationQueryKey(refs: string[]): [string, string] {
  return [PHOTO_ORIENTATION_KEY_ROOT, refs.slice().sort().join('|')];
}

/** Снимок всех затронутых кэшей — контекст отката для `onError`. */
type CacheSnapshot = Array<[readonly unknown[], OrientationMap | undefined]>;

export interface UsePhotoOrientationsResult {
  /** Отсутствие ключа = 0°. */
  orientations: OrientationMap;
  /** Поворот на ±90°. No-op при пустом ref. */
  rotate: (ref: string, delta: number) => void;
  isSaving: boolean;
}

export function usePhotoOrientations(
  refs: Array<string | null | undefined>,
  options: { enabled?: boolean } = {},
): UsePhotoOrientationsResult {
  const queryClient = useQueryClient();

  const cleanRefs = useMemo(
    () =>
      Array.from(
        new Set(refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)),
      ),
    [refs],
  );

  const enabled = (options.enabled ?? true) && cleanRefs.length > 0;
  const queryKey = useMemo(() => orientationQueryKey(cleanRefs), [cleanRefs]);

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchPhotoOrientations(cleanRefs),
    enabled,
    // Угол меняется редко и только руками репетитора, а мутация сама пишет во
    // все кэши — перезапрашивать нечего.
    staleTime: 10 * 60 * 1000,
    // Просмотр фото ведёт себя как write-форма: фокус-рефетч тут только мигал
    // бы картинкой (rule 40, гард smoke §8).
    refetchOnWindowFocus: false,
  });

  const orientations = useMemo(() => data ?? {}, [data]);

  const mutation = useMutation({
    mutationFn: ({ ref, degrees }: { ref: string; degrees: PhotoDegrees }) =>
      savePhotoOrientation(ref, degrees),

    // Оптимистично пишем во все наборы с этим префиксом и возвращаем снимок:
    // именно этот проход синхронизирует миниатюру в ленте с открытым просмотром.
    onMutate: async ({ ref, degrees }): Promise<CacheSnapshot> => {
      await queryClient.cancelQueries({ queryKey: [PHOTO_ORIENTATION_KEY_ROOT] });

      const snapshot = queryClient.getQueriesData<OrientationMap>({
        queryKey: [PHOTO_ORIENTATION_KEY_ROOT],
      }) as CacheSnapshot;

      queryClient.setQueriesData<OrientationMap>(
        { queryKey: [PHOTO_ORIENTATION_KEY_ROOT] },
        (current) => {
          if (!current) return current;
          const next = { ...current };
          if (degrees === 0) delete next[ref];
          else next[ref] = degrees;
          return next;
        },
      );

      return snapshot;
    },

    onError: (error: unknown, _vars, context) => {
      // Тихий откат. Показывать повёрнутым то, что на сервере осталось прежним,
      // хуже, чем не повернуть вовсе: репетитор был бы уверен, что ученик
      // видит фото так же, как он.
      for (const [key, value] of context ?? []) {
        queryClient.setQueryData(key, value);
      }
      const message =
        error instanceof Error ? error.message : 'Не удалось сохранить поворот фото.';
      toast.error(message);
    },
  });

  const { mutate } = mutation;

  const rotate = useCallback(
    (ref: string, delta: number) => {
      if (!ref) return;
      // Читаем текущий угол из кэша, а не из замыкания: два быстрых клика
      // подряд не должны схлопнуться в один поворот.
      const cached = queryClient.getQueryData<OrientationMap>(queryKey);
      const current = cached?.[ref] ?? 0;
      mutate({ ref, degrees: rotateDegrees(current, delta) });
    },
    [mutate, queryClient, queryKey],
  );

  return { orientations, rotate, isSaving: mutation.isPending };
}
