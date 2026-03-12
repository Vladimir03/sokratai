import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FolderIconProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: { container: "w-8 h-8 rounded-lg", icon: 16 },
  md: { container: "w-10 h-10 rounded-[10px]", icon: 20 },
  lg: { container: "w-12 h-12 rounded-xl", icon: 24 },
} as const;

export function FolderIcon({ size = "md", className }: FolderIconProps) {
  const s = sizeMap[size];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center bg-socrat-folder-bg",
        s.container,
        className,
      )}
    >
      <Folder size={s.icon} className="text-socrat-folder" />
    </div>
  );
}
