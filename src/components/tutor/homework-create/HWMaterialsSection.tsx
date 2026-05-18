import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, Paperclip, ExternalLink, Upload, X } from 'lucide-react';
import type { MaterialType } from '@/lib/tutorHomeworkApi';
import { type DraftMaterial, createEmptyMaterial } from './types';
import { usePasteImages } from '@/hooks/usePasteImages';

export interface HWMaterialsSectionProps {
  materials: DraftMaterial[];
  onChange: (m: DraftMaterial[]) => void;
}

export function HWMaterialsSection({ materials, onChange }: HWMaterialsSectionProps) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAddLink = useCallback(() => {
    onChange([...materials, { ...createEmptyMaterial(), type: 'link' }]);
    setOpen(true);
  }, [materials, onChange]);

  const handleAddFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === 'application/pdf';
    const type: MaterialType = isPdf ? 'pdf' : 'image';
    onChange([...materials, { ...createEmptyMaterial(), type, file, title: file.name }]);
    setOpen(true);
    if (fileRef.current) fileRef.current.value = '';
  }, [materials, onChange]);

  const handleUpdate = useCallback((idx: number, updated: DraftMaterial) => {
    const next = [...materials];
    next[idx] = updated;
    onChange(next);
  }, [materials, onChange]);

  const handleRemove = useCallback((idx: number) => {
    onChange(materials.filter((_, i) => i !== idx));
  }, [materials, onChange]);

  // Ctrl+V support — accepts both images (compressed) and PDFs (passthrough).
  // Auto-detect type from MIME, auto-expand accordion so tutor sees the new
  // material immediately. Generated filename for clipboard images (which have
  // no name in clipboard) — "Скриншот <timestamp>.jpg" after compression.
  const handlePaste = usePasteImages({
    acceptedTypes: ['image/', 'application/pdf'],
    compress: true,
    onImagePasted: (file: File) => {
      const isPdf = file.type === 'application/pdf';
      const type: MaterialType = isPdf ? 'pdf' : 'image';
      // Clipboard images often have generic names like "image.png" — give
      // them a friendlier title based on timestamp.
      const isClipboardImage = !isPdf && /^image\.\w+$/i.test(file.name);
      const title = isClipboardImage
        ? `Скриншот ${new Date().toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}`
        : file.name;
      onChange([...materials, { ...createEmptyMaterial(), type, file, title }]);
      setOpen(true);
    },
    telemetryTag: 'hw_materials_paste',
  });

  return (
    <div className="space-y-2" onPaste={handlePaste}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        <Paperclip className="h-4 w-4" />
        Материалы{materials.length > 0 ? ` (${materials.length})` : ''}
      </button>
      {open && (
        <div className="space-y-3 pl-2 border-l-2 border-muted">
          {materials.map((mat, idx) => {
            const isExisting = !!mat.id;
            return (
              <div key={mat.localId} className="flex items-start gap-2 p-2 border rounded-md bg-muted/30">
                <div className="flex-1 space-y-2 min-w-0">
                  <Input
                    placeholder="Название (например: Конспект урока)"
                    value={mat.title}
                    onChange={(e) => handleUpdate(idx, { ...mat, title: e.target.value })}
                    className="text-sm"
                    disabled={isExisting}
                  />
                  {mat.type === 'link' && (
                    <Input
                      placeholder="https://..."
                      value={mat.url}
                      onChange={(e) => handleUpdate(idx, { ...mat, url: e.target.value })}
                      className="text-sm"
                      disabled={isExisting}
                    />
                  )}
                  {mat.type !== 'link' && mat.file && (
                    <p className="text-xs text-muted-foreground truncate">{mat.file.name}</p>
                  )}
                  <span className="text-xs text-muted-foreground uppercase">{mat.type}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleRemove(idx)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={handleAddLink}>
              <ExternalLink className="h-3.5 w-3.5" />
              Ссылка
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Файл
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleAddFile}
            />
          </div>
          {materials.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Или вставь скриншот:{' '}
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
                Ctrl
              </kbd>
              +
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">
                V
              </kbd>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
