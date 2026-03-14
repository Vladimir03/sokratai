import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  getKBImageSignedUrl,
  MAX_TASK_IMAGES,
  validateImageFile,
} from '@/lib/kbApi';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseImageUploadOptions {
  /** Maximum images allowed (defaults to MAX_TASK_IMAGES = 5). */
  maxImages?: number;
  /** When true, all user-facing handlers no-op. */
  disabled?: boolean;
  /** Existing storage refs to show (edit mode). Triggers signed URL loading. */
  initialRefs?: string[];
}

export interface UseImageUploadReturn {
  // State — new files added in this session
  files: File[];
  previewUrls: string[];

  // State — existing DB images (edit mode)
  existingRefs: string[];
  existingSignedUrls: Record<string, string>;

  // Drag
  isDragging: boolean;

  // Derived
  totalImages: number;
  canAddMore: boolean;

  // Event handlers
  handleFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleRemoveNew: (index: number) => void;
  handleRemoveExisting: (ref: string) => void;

  // Ref for hidden file input
  fileInputRef: React.RefObject<HTMLInputElement>;

  // For save logic — read synchronously from refs
  getNewFiles: () => File[];
  getExistingRefs: () => string[];
  getRemovedRefs: () => string[];
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useImageUpload(options: UseImageUploadOptions = {}): UseImageUploadReturn {
  const { maxImages = MAX_TASK_IMAGES, disabled = false, initialRefs } = options;

  // ── New files (create + edit) ─────────────────────────────────────────────
  const filesRef = useRef<File[]>([]);
  const blobUrlsRef = useRef<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  // ── Existing images (edit mode) ───────────────────────────────────────────
  const existingRefsRef = useRef<string[]>(initialRefs ?? []);
  const [existingRefs, setExistingRefs] = useState<string[]>(existingRefsRef.current);
  const [existingSignedUrls, setExistingSignedUrls] = useState<Record<string, string>>({});
  const removedRefsRef = useRef<string[]>([]);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalImages = existingRefs.length + files.length;
  const canAddMore = totalImages < maxImages;

  // ── Load signed URLs for existing refs ────────────────────────────────────
  useEffect(() => {
    const refs = initialRefs ?? [];
    if (refs.length === 0) return;
    let cancelled = false;

    void Promise.all(
      refs.map(async (ref) => {
        const url = await getKBImageSignedUrl(ref);
        return { ref, url };
      }),
    ).then((results) => {
      if (cancelled) return;
      const urlMap: Record<string, string> = {};
      for (const { ref, url } of results) {
        if (url) urlMap[ref] = url;
      }
      setExistingSignedUrls(urlMap);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount — initialRefs is a startup value, not reactive

  // ── Cleanup blob URLs on unmount ──────────────────────────────────────────
  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  // ── Core: add a single file ───────────────────────────────────────────────

  const handleFileSelect = useCallback(
    (file: File): boolean => {
      const error = validateImageFile(file);
      if (error) {
        toast.error(error);
        return false;
      }

      const currentTotal = existingRefsRef.current.length + filesRef.current.length;
      if (currentTotal >= maxImages) {
        toast.error(`Максимум ${maxImages} изображений`);
        return false;
      }

      const url = URL.createObjectURL(file);
      filesRef.current = [...filesRef.current, file];
      blobUrlsRef.current = [...blobUrlsRef.current, url];

      setFiles([...filesRef.current]);
      setPreviewUrls([...blobUrlsRef.current]);
      return true;
    },
    [maxImages],
  );

  // ── File input handler ────────────────────────────────────────────────────

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const inputFiles = e.target.files;
      if (!inputFiles?.length) return;

      for (const file of Array.from(inputFiles)) {
        handleFileSelect(file);
      }

      e.target.value = '';
    },
    [handleFileSelect, disabled],
  );

  // ── Remove handlers ───────────────────────────────────────────────────────

  const handleRemoveNew = useCallback((index: number) => {
    const urlToRevoke = blobUrlsRef.current[index];
    if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);

    filesRef.current = filesRef.current.filter((_, i) => i !== index);
    blobUrlsRef.current = blobUrlsRef.current.filter((_, i) => i !== index);

    setFiles([...filesRef.current]);
    setPreviewUrls([...blobUrlsRef.current]);
  }, []);

  const handleRemoveExisting = useCallback((ref: string) => {
    existingRefsRef.current = existingRefsRef.current.filter((r) => r !== ref);
    removedRefsRef.current = [...removedRefsRef.current, ref];
    setExistingRefs([...existingRefsRef.current]);
  }, []);

  // ── Paste handler (for textarea onPaste) ──────────────────────────────────

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            if (handleFileSelect(file)) {
              toast.success('Изображение вставлено');
            }
          }
          return;
        }
      }
      // Text paste — let default behavior proceed
    },
    [handleFileSelect, disabled],
  );

  // ── Drag-and-drop handlers ────────────────────────────────────────────────

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounterRef.current += 1;
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (disabled) return;

      const droppedFiles = e.dataTransfer?.files;
      if (!droppedFiles?.length) return;

      let added = 0;
      let skippedNonImage = false;

      for (const file of Array.from(droppedFiles)) {
        if (!file.type.startsWith('image/')) {
          skippedNonImage = true;
          continue;
        }
        if (handleFileSelect(file)) added++;
      }

      if (skippedNonImage && added === 0) {
        toast.error('Допустимы только изображения (JPG, PNG, GIF, WebP)');
      }

      if (added > 0) {
        toast.success(
          added === 1 ? 'Изображение добавлено' : `Добавлено изображений: ${added}`,
        );
      }
    },
    [handleFileSelect, disabled],
  );

  // ── Save accessors (synchronous reads from refs) ──────────────────────────

  const getNewFiles = useCallback(() => filesRef.current, []);
  const getExistingRefs = useCallback(() => existingRefsRef.current, []);
  const getRemovedRefs = useCallback(() => removedRefsRef.current, []);

  return {
    files,
    previewUrls,
    existingRefs,
    existingSignedUrls,
    isDragging,
    totalImages,
    canAddMore,
    handleFileInput,
    handlePaste,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleRemoveNew,
    handleRemoveExisting,
    fileInputRef,
    getNewFiles,
    getExistingRefs,
    getRemovedRefs,
  };
}
