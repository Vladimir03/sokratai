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
        "pt-[110px] md:pt-[104px]",
        fullHeight && "min-h-screen",
        className
      )}
    >
      {children}
    </div>
  );
};
