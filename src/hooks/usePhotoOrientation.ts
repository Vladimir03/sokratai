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

import { useCallback, useMemo, useRef } from 'react';
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

interface RotateVars {
  ref: string;
  degrees: PhotoDegrees;
  /** Порядковый номер правки — по нему решаем, не устарел ли ответ/откат. */
  seq: number;
  /** Угол до правки: к нему возвращаемся, если сохранение не удалось. */
  previous: PhotoDegrees;
}

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

  /**
   * Последний СИНХРОННО применённый угол по ref и порядковый номер правки.
   *
   * ⚠️ Кэш React Query для этого не годится: оптимистичная запись из `onMutate`
   * происходит ПОСЛЕ `await cancelQueries`, поэтому два быстрых нажатия успели
   * бы прочитать одно и то же значение и оба отправили бы 90° вместо 90°→180°.
   * Ref обновляется в самом обработчике клика, до любого await.
   */
  const pendingRef = useRef(new Map<string, { degrees: PhotoDegrees; seq: number }>());
  const seqRef = useRef(0);
  /**
   * Очередь записи ПО КАЖДОМУ ref.
   *
   * ⚠️ Порядкового номера мало: он защищает клиентский кэш, но не сервер.
   * Два быстрых поворота уходят параллельно, и запрос «180°» может доехать
   * РАНЬШЕ более старого «90°» — на сервере осталось бы 90°, и после
   * перезагрузки репетитор увидел бы не то, что оставил, а ученик — тем более.
   * Поэтому записи одного и того же фото выстраиваются в цепочку.
   */
  const writeChainRef = useRef(new Map<string, Promise<unknown>>());

  const patchCaches = useCallback(
    (ref: string, degrees: PhotoDegrees) => {
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
    },
    [queryClient],
  );

  const mutation = useMutation({
    mutationFn: ({ ref, degrees }: RotateVars) => {
      const previousWrite = writeChainRef.current.get(ref) ?? Promise.resolve();
      // Ошибка предыдущей записи не должна рвать цепочку — её обработает свой
      // onError, а следующая правка обязана всё равно уехать.
      const next = previousWrite
        .catch(() => undefined)
        .then(() => savePhotoOrientation(ref, degrees));
      writeChainRef.current.set(ref, next.catch(() => undefined));
      return next;
    },

    onSuccess: (saved, { ref, seq }) => {
      // Ответ более старой мутации не должен перетирать более новый поворот.
      if (pendingRef.current.get(ref)?.seq !== seq) return;
      patchCaches(ref, saved);
    },

    onError: (error: unknown, { ref, seq, previous }) => {
      // Откатываем ТОЛЬКО если с тех пор не было нового поворота этого фото:
      // иначе провал первой мутации отменил бы успешную вторую.
      if (pendingRef.current.get(ref)?.seq === seq) {
        pendingRef.current.set(ref, { degrees: previous, seq });
        patchCaches(ref, previous);
      }
      // Показывать повёрнутым то, что на сервере не сохранилось, хуже, чем не
      // повернуть вовсе: репетитор был бы уверен, что ученик видит так же.
      const message =
        error instanceof Error ? error.message : 'Не удалось сохранить поворот фото.';
      toast.error(message);
    },
  });

  const { mutate } = mutation;

  const rotate = useCallback(
    (ref: string, delta: number) => {
      if (!ref) return;

      // Всё до `mutate` — СИНХРОННО, поэтому серия быстрых кликов складывается
      // (0 → 90 → 180), а не схлопывается.
      const cached = queryClient.getQueryData<OrientationMap>(queryKey);
      const previous = pendingRef.current.get(ref)?.degrees ?? cached?.[ref] ?? 0;
      const next = rotateDegrees(previous, delta);
      const seq = ++seqRef.current;

      pendingRef.current.set(ref, { degrees: next, seq });
      patchCaches(ref, next);

      mutate({ ref, degrees: next, seq, previous });
    },
    [mutate, patchCaches, queryClient, queryKey],
  );

  return { orientations, rotate, isSaving: mutation.isPending };
}
