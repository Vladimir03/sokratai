import { memo } from "react";

// Russian month names in genitive case
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

/**
 * Format date for display in Russian locale
 * Returns: "Сегодня", "Вчера", or "29 ноября"
 */
export const formatDateLabel = (isoString: string): string => {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // Check if same day
  const isSameDay = (d1: Date, d2: Date) => 
    d1.getDate() === d2.getDate() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getFullYear() === d2.getFullYear();
  
  if (isSameDay(date, today)) {
    return 'Сегодня';
  }
  
  if (isSameDay(date, yesterday)) {
    return 'Вчера';
  }
  
  // Format as "29 ноября" or "29 ноября 2023" if different year
  const day = date.getDate();
  const month = MONTHS_GENITIVE[date.getMonth()];
  const year = date.getFullYear();
  const currentYear = today.getFullYear();
  
  if (year === currentYear) {
    return `${day} ${month}`;
  }
  
  return `${day} ${month} ${year}`;
};

/**
 * Check if two dates are on different days
 */
export const isDifferentDay = (date1?: string, date2?: string): boolean => {
  if (!date1 || !date2) return false;
  
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  
  return d1.getDate() !== d2.getDate() ||
         d1.getMonth() !== d2.getMonth() ||
         d1.getFullYear() !== d2.getFullYear();
};

interface DateSeparatorProps {
  date: string;
}

/**
 * Telegram-style date separator between messages from different days
 */
const DateSeparator = memo(({ date }: DateSeparatorProps) => {
  const label = formatDateLabel(date);
  
  return (
    <div className="flex items-center justify-center my-6 px-4">
      <div className="flex-1 h-px bg-border/50" />
      <div className="px-4 py-1.5 text-muted-foreground text-xs font-medium">
        {label}
      </div>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
});

DateSeparator.displayName = "DateSeparator";

export default DateSeparator;


