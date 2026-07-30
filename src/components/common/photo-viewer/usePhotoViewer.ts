/**
 * Состояние «какое фото открыто» — чтобы каждая поверхность не заводила свой
 * `useState<number | null>` и не забывала закрывать просмотр при смене данных.
 */

import { useCallback, useState } from 'react';

export interface UsePhotoViewerResult {
  openIndex: number | null;
  open: (index: number) => void;
  close: () => void;
  navigate: (index: number) => void;
}

export function usePhotoViewer(): UsePhotoViewerResult {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const open = useCallback((index: number) => setOpenIndex(index), []);
  const close = useCallback(() => setOpenIndex(null), []);
  const navigate = useCallback((index: number) => setOpenIndex(index), []);

  return { openIndex, open, close, navigate };
}
