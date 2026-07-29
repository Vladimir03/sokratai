// Картинки доски (Фаза 2а, W2.1): загрузка в bucket `board-images` и кэш
// signed URL. Модель хранит только `storage://board-images/<path>` — URL
// резолвится здесь и живёт SIGNED_TTL_SEC.
//
// RU-bypass бесплатно: supabaseClient захардкожен на api.sokratai.ru, поэтому
// signed URL приходят сразу с RU-safe хостом — rewriteToProxy не нужен (rule 96).

import { supabase } from '@/lib/supabaseClient';
import { compressForUpload } from '@/lib/imageCompression';

export const BOARD_IMAGE_BUCKET = 'board-images';
/** Кап картинок на ЛИСТ (решение владельца 2026-07-29: PDF не должен раздуваться). */
export const MAX_IMAGES_PER_PAGE = 5;
/** Кап исходника до компрессии; bucket-лимит 10 МБ — страховка сверху. */
export const MAX_IMAGE_SOURCE_BYTES = 10 * 1024 * 1024;

const SIGNED_TTL_SEC = 3600;
/** Обновляем заранее: подпись, истекающая во время урока, — это исчезнувшая картинка. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class BoardImageError extends Error {}

interface CachedUrl {
  url: string;
  expiresAt: number;
}

const urlCache = new Map<string, CachedUrl>();

function parseBoardImageRef(ref: string): string | null {
  const prefix = `storage://${BOARD_IMAGE_BUCKET}/`;
  if (!ref.startsWith(prefix)) return null;
  const objectPath = ref.slice(prefix.length);
  return objectPath.length > 0 ? objectPath : null;
}

/**
 * Signed URL для ref (с кэшем). null — ref битый или подпись не удалась;
 * вызывающий показывает плейсхолдер (rule 40), не пустой <image>.
 */
export async function resolveBoardImageUrl(ref: string): Promise<string | null> {
  const cached = urlCache.get(ref);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.url;
  }
  const objectPath = parseBoardImageRef(ref);
  if (!objectPath) return null;
  const { data, error } = await supabase.storage
    .from(BOARD_IMAGE_BUCKET)
    .createSignedUrl(objectPath, SIGNED_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  urlCache.set(ref, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_TTL_SEC * 1000 });
  return data.signedUrl;
}

export interface UploadedBoardImage {
  ref: string;
  /** Естественные размеры сжатого файла, px — для начального размера на листе. */
  naturalWidth: number;
  naturalHeight: number;
}

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new BoardImageError('Не удалось прочитать изображение'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Компрессия (обязательна на клиентском upload для последующего PDF, rule 40)
 * → загрузка в `tutor/{uid}/{boardId}/{id}.jpg` → ref + натуральные размеры.
 */
export async function uploadBoardImage(file: File, boardId: string): Promise<UploadedBoardImage> {
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    throw new BoardImageError('Файл больше 10 МБ. Сожмите изображение и попробуйте снова.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new BoardImageError('Нет активной сессии. Войдите снова.');

  // 1600px по длинной стороне: скриншот задачи читаем, страница PDF не пухнет.
  const compressed = await compressForUpload(file, { maxBytes: 4 * 1024 * 1024, maxLongSide: 1600 });
  const { width, height } = await readImageSize(compressed);

  // НЕ crypto.randomUUID — Safari < 15.4 (rule 80); паттерн lessonMaterialsApi.
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ext = compressed.type === 'image/png' ? 'png' : 'jpg';
  const objectPath = `tutor/${uid}/${boardId}/${fileId}.${ext}`;

  const { error } = await supabase.storage
    .from(BOARD_IMAGE_BUCKET)
    .upload(objectPath, compressed, { contentType: compressed.type, upsert: false });
  if (error) {
    throw new BoardImageError(`Не удалось загрузить изображение: ${error.message}`);
  }

  return {
    ref: `storage://${BOARD_IMAGE_BUCKET}/${objectPath}`,
    naturalWidth: width,
    naturalHeight: height,
  };
}

/**
 * data:-URL всех картинок страниц — для встраивания в PDF. Fail-closed: битая
 * картинка валит экспорт с русской фразой, а не отдаёт ученику конспект с
 * пустыми рамками (тот же принцип, что со шрифтом — ревью 5.6).
 */
export async function resolveImagesAsDataUrls(refs: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(refs));
  const out: Record<string, string> = {};
  for (let i = 0; i < unique.length; i++) {
    const signed = await resolveBoardImageUrl(unique[i]);
    if (!signed) {
      throw new BoardImageError('Не удалось получить одну из картинок доски. Проверьте сеть и повторите.');
    }
    const resp = await fetch(signed);
    if (!resp.ok) {
      throw new BoardImageError('Не удалось скачать одну из картинок доски. Проверьте сеть и повторите.');
    }
    const blob = await resp.blob();
    out[unique[i]] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new BoardImageError('Не удалось обработать картинку доски.'));
      reader.readAsDataURL(blob);
    });
  }
  return out;
}
