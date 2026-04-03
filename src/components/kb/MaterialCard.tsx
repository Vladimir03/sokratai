import { memo } from 'react';
import { FileText, Image, Link2, PanelsTopLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KBMaterial, MaterialType } from '@/types/kb';

const iconMap: Record<MaterialType, typeof FileText> = {
  file: FileText,
  link: Link2,
  media: Image,
  board: PanelsTopLeft,
};

const colorMap: Record<MaterialType, string> = {
  file: 'bg-socrat-primary-light text-socrat-primary',
  link: 'bg-socrat-folder-bg text-socrat-folder',
  media: 'bg-socrat-accent-light text-socrat-accent',
  board: 'bg-slate-100 text-slate-600',
};

interface MaterialCardProps {
  material: KBMaterial;
  className?: string;
}

export const MaterialCard = memo(function MaterialCard({
  material,
  className,
}: MaterialCardProps) {
  const materialType = material.type as MaterialType;
  const Icon = iconMap[materialType] ?? FileText;

  const content = (
    <>
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', colorMap[materialType] ?? colorMap.file)}>
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-900">{material.name}</div>
        <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
          {material.format ?? material.type}
        </div>
      </div>
    </>
  );

  if (material.url) {
    return (
      <a
        href={material.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'flex items-center gap-3 rounded-2xl border border-socrat-border bg-white px-4 py-3.5',
          'shadow-[0_14px_32px_-30px_rgba(15,23,42,0.28)] transition-all duration-200 hover:border-socrat-primary/20',
          className,
        )}
      >
        {content}
      </a>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-socrat-border bg-white px-4 py-3.5',
        'shadow-[0_14px_32px_-30px_rgba(15,23,42,0.28)]',
        className,
      )}
    >
      {content}
    </div>
  );
});
