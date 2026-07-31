import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        // `text-base md:text-sm` — зеркало `ui/input.tsx`: на мобиле 16px, иначе
        // iOS зумит страницу при фокусе и не отматывает обратно (rule 80;
        // с 31.07 пинч-зум разрешён, и этот зум-на-фокус больше ничем не
        // подавлен). На десктопе размер прежний.
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm ring-offset-background transition-all duration-200 placeholder:text-muted-foreground hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
