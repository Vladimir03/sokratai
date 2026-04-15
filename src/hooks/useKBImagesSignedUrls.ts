import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getKBImageSignedUrl } from '@/lib/kbApi';

const DIRECT_IMAGE_URL_RE = /^(https?:\/\/|data:|blob:)/i;
const SIGNED_URL_STALE_TIME_MS = 55 * 60 * 1000;
const SIGNED_URL_GC_TIME_MS = 60 * 60 * 1000;

export function useKBImagesSignedUrls(
  refs: string[] | null | undefined,
  options?: { enabled?: boolean },
): {
  urls: Record<string, string>;
  isLoading: boolean;
} {
  const normalizedRefs = useMemo(() => {
    if (!refs?.length) return [];
    return Array.from(new Set(refs.map((ref) => ref.trim()).filter(Boolean)));
  }, [refs]);

  const directUrls = useMemo(() => {
    return normalizedRefs.reduce<Record<string, string>>((acc, ref) => {
      if (DIRECT_IMAGE_URL_RE.test(ref)) {
        acc[ref] = ref;
      }
      return acc;
    }, {});
  }, [normalizedRefs]);

  const storageRefs = useMemo(
    () => normalizedRefs.filter((ref) => !DIRECT_IMAGE_URL_RE.test(ref)),
    [normalizedRefs],
  );
  const queryEnabled = options?.enabled !== false;

  const results = useQueries({
    queries: storageRefs.map((ref) => ({
      queryKey: ['kb', 'signed-url', ref],
      queryFn: async () => {
        try {
          return await getKBImageSignedUrl(ref);
        } catch {
          return null;
        }
      },
      enabled: queryEnabled && Boolean(ref),
      staleTime: SIGNED_URL_STALE_TIME_MS,
      gcTime: SIGNED_URL_GC_TIME_MS,
    })),
  });

  const urls = useMemo(() => {
    return results.reduce<Record<string, string>>(
      (acc, result, index) => {
        const url = result.data;
        if (url) {
          acc[storageRefs[index]] = url;
        }
        return acc;
      },
      { ...directUrls },
    );
  }, [directUrls, results, storageRefs]);

  const isLoading =
    queryEnabled &&
    results.some((result, index) => {
      const ref = storageRefs[index];
      return Boolean(ref) && result.status === 'pending' && !urls[ref];
    });

  return { urls, isLoading };
}
