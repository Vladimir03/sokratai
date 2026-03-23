import { cn } from "@/lib/utils";

interface PageContentProps {
  children: React.ReactNode;
  fullHeight?: boolean;
  className?: string;
}

export const PageContent = ({ 
  children, 
  fullHeight = false, 
  className = "" 
}: PageContentProps) => {
  return (
    <div 
      className={cn(
        "pt-2",
        fullHeight && "min-h-screen",
        className
      )}
    >
      {children}
    </div>
  );
};
