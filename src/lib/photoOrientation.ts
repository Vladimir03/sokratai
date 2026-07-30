/**
 * Поворот фото на 90° (волна 1, план 1-ancient-quokka).
 *
 * Джоб (Ульяна, химия, U21/U22): фото решений приходят боком, и «его нельзя
 * развернуть». Угол хранится ПО storage-ref в `photo_orientations`, а не в
 * доменных таблицах — одна сущность на ДЗ, пробники, чат, Банк знаний и
 * материалы занятий (иначе шесть миграций и новые write-site там, где уже есть
 * двойной write-path, rule 40).
 *
 * ⚠️ Файл ученика НИКОГДА не перезаписывается: угол применяется transform'ом на
 * клиенте и запекается в пиксели только при рендере размеченной картинки
 * (волна 2). Перекодирование JPEG стоило бы 1,5–7 с ожидания на каждый поворот
 * и генерационной потери качества на рукописи с индексами.
 *
 * ⚠️ ANTI-LEAK: список ref'ов не отдаётся никому. Чтение — только пачкой уже
 * известных ref'ов через SECURITY DEFINER `photo_orientations_get`; прямых
 * GRANT'ов на таблицу у клиента нет.
 */

import { supabase } from '@/lib/supabaseClient';

/** Единственные допустимые значения — шаг 90°, как в CHECK-констрейнте. */
export type PhotoDegrees = 0 | 90 | 180 | 270;

/** Карта `storage-ref → угол`. Отсутствие ключа = 0°. */
export type OrientationMap = Record<string, PhotoDegrees>;

/**
 * Кап пачки повторяет серверный (`p_refs[1:200]`): если разойдутся, клиент
 * будет молча недополучать углы у хвоста списка.
 */
export const MAX_ORIENTATION_REFS = 200;

/**
 * Приводит любое целое к 0/90/180/270. Отрицательные и >360 нормализуются
 * (`-90 → 270`), дробные и мусор → 0. Зеркало серверной нормализации в
 * `photo_orientations_set`.
 */
export function normalizeDegrees(value: unknown): PhotoDegrees {
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw);
  const wrapped = ((rounded % 360) + 360) % 360;
  return wrapped === 90 || wrapped === 180 || wrapped === 270 ? wrapped : 0;
}

/** Следующий угол при повороте на `delta` градусов (± 90). */
export function rotateDegrees(current: PhotoDegrees, delta: number): PhotoDegrees {
  return normalizeDegrees(current + delta);
}

/**
 * Повёрнут ли кадр «на бок» — при 90/270 ширина и высота меняются местами,
 * и контейнер обязан пересчитать вписывание.
 */
export function isQuarterTurn(degrees: PhotoDegrees): boolean {
  return degrees === 90 || degrees === 270;
}

/**
 * Восстанавливает `storage://<bucket>/<path>` из подписанной ссылки Supabase.
 *
 * Зачем: часть поверхностей (пробники, материалы) получает с бэкенда УЖЕ
 * подписанный URL и storage-ref на клиенте не видит. Но ref в этой ссылке и
 * так лежит — путь `/storage/v1/object/sign/<bucket>/<path>`. Разбор избавляет
 * от прокидывания второго поля через edge ради поворота.
 *
 * Fail-safe: чужая ссылка (внешний сайт, blob:, data:) → null, и поворот
 * остаётся локальным для окна, а не привязывается к случайной строке.
 * ⚠️ Без lookbehind (rule 80: Safari < 16.4 роняет такой регэксп в рантайме).
 */
const STORAGE_URL_RE = /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/?#]+)\/([^?#]+)/;

export function storageRefFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('storage://')) return url;
  const match = STORAGE_URL_RE.exec(url);
  if (!match) return null;
  const bucket = match[1];
  const rawPath = match[2];
  if (!bucket || !rawPath) return null;
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // Битая percent-последовательность — берём как есть, ключ всё равно
    // останется стабильным для этого файла.
  }
  return `storage://${bucket}/${path}`;
}

/**
 * Сопоставляет каждому URL его storage-ref.
 *
 * ⚠️ Позиционный массив `refs` принимается ТОЛЬКО при совпадении длин.
 * Бэкенд подписывает ссылки через `createSignedStorageUrls`, а тот ВЫКИДЫВАЕТ
 * неподписавшиеся (файл удалён из хранилища): массив URL становится короче
 * массива ref'ов и позиционно с ним не совпадает. Сопоставив их по индексу, мы
 * записали бы поворот второго фото в ref первого — репетитор крутит B, боком
 * остаётся B, а неожиданно поворачивается A.
 *
 * Если длины разошлись, ref восстанавливается из самой подписанной ссылки:
 * там он лежит по построению, и перепутать его невозможно.
 */
export function resolveRefsForUrls(
  urls: string[],
  refs?: string[] | null,
): Array<string | null> {
  const aligned = refs && refs.length === urls.length ? refs : null;
  return urls.map((url, index) => aligned?.[index] ?? storageRefFromUrl(url));
}

// ─── Пакетирование запросов ──────────────────────────────────────────────────
//
// ⚠️ Каждая карточка Банка/лента ДЗ спрашивает углы для СВОЕГО набора ref'ов, и
// на теме из 200 карточек это были бы сотни отдельных RPC, стартующих
// одновременно. Под РФ-DPI они конкурируют с загрузкой самих signed URL, и
// часть картинок деградирует по сети из-за нашего же фонового трафика.
//
// Поэтому вызовы, случившиеся в одном тике, склеиваются в один запрос.
// Окно — микрозадача (не таймер): к моменту, когда React закончил коммит,
// все монтирующиеся карточки уже встали в очередь, а лишней задержки нет.

interface PendingBatch {
  refs: Set<string>;
  promise: Promise<OrientationMap>;
  resolve: (value: OrientationMap) => void;
}

let pendingBatch: PendingBatch | null = null;

async function runBatch(batch: PendingBatch): Promise<void> {
  const all = Array.from(batch.refs);
  const map: OrientationMap = {};

  // Кап пачки — серверный (`p_refs[1:200]`); при большем наборе режем сами,
  // иначе хвост списка молча остался бы без углов.
  for (let i = 0; i < all.length; i += MAX_ORIENTATION_REFS) {
    const chunk = all.slice(i, i + MAX_ORIENTATION_REFS);
    const { data, error } = await supabase.rpc('photo_orientations_get' as never, {
      p_refs: chunk,
    } as never);

    if (error) {
      // Fail-open: поворот — украшение поверх фото, и его недоступность не
      // должна прятать саму картинку.
      console.info('photo_orientations_get failed', error.message);
      continue;
    }

    const rows = (data ?? []) as unknown as Array<{ ref: string; degrees: number }>;
    for (const row of rows) {
      if (!row?.ref) continue;
      const normalized = normalizeDegrees(row.degrees);
      if (normalized !== 0) map[row.ref] = normalized;
    }
  }

  batch.resolve(map);
}

function enqueue(refs: string[]): Promise<OrientationMap> {
  if (!pendingBatch) {
    let resolve!: (value: OrientationMap) => void;
    const promise = new Promise<OrientationMap>((res) => {
      resolve = res;
    });
    const batch: PendingBatch = { refs: new Set(), promise, resolve };
    pendingBatch = batch;
    // Закрываем окно в микрозадаче и СРАЗУ отцепляем батч, чтобы вызовы
    // следующего тика начали новый, а не досыпали в уже улетевший.
    void Promise.resolve().then(() => {
      pendingBatch = null;
      void runBatch(batch);
    });
  }

  for (const ref of refs) pendingBatch.refs.add(ref);
  return pendingBatch.promise;
}

/**
 * Углы для набора ref'ов. Пустой массив → пустая карта без сетевого вызова.
 * Возвращается подмножество ровно по запрошенным ref'ам, даже если пачка
 * ушла общая с соседними компонентами.
 */
export async function fetchPhotoOrientations(refs: string[]): Promise<OrientationMap> {
  const unique = Array.from(
    new Set(refs.filter((ref) => typeof ref === 'string' && ref.length > 0)),
  );
  if (unique.length === 0) return {};

  const shared = await enqueue(unique);

  const mine: OrientationMap = {};
  for (const ref of unique) {
    const degrees = shared[ref];
    if (degrees !== undefined) mine[ref] = degrees;
  }
  return mine;
}

/**
 * Сохраняет угол. В отличие от чтения — бросает: репетитор должен узнать, что
 * поворот не доехал, иначе он уверен, что ученик видит фото как он.
 */
export async function savePhotoOrientation(
  ref: string,
  degrees: PhotoDegrees,
): Promise<PhotoDegrees> {
  const { data, error } = await supabase.rpc('photo_orientations_set' as never, {
    p_ref: ref,
    p_degrees: degrees,
  } as never);

  if (error) {
    throw new Error(error.message || 'Не удалось сохранить поворот фото.');
  }
  return normalizeDegrees(data);
}
