import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChevronDown, ChevronUp, X } from "lucide-react";

interface TaskContextBannerProps {
  task: {
    task_number: string;
    condition_text: string | null;
    condition_photo_url: string | null;
    ai_analysis: any;
    homework_set: {
      subject: string;
      topic: string;
    };
  };
}

export function TaskContextBanner({ task }: TaskContextBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  return (
    <>
      {/* Модальное окно для просмотра фото на весь экран */}
      {task.condition_photo_url && (
        <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
          <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden">
            <button
              onClick={() => setImageModalOpen(false)}
              className="absolute top-4 right-4 z-50 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="w-full h-full flex items-center justify-center p-4">
              <img 
                src={task.condition_photo_url} 
                alt="Условие задачи (увеличенное)"
                className="max-w-full max-h-[90vh] object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
      
      <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-900 dark:text-blue-100 font-medium">
              <span>📌</span>
              <span>
                Контекст: {task.homework_set.subject}, {task.homework_set.topic}, Задача {task.task_number}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-blue-900 dark:text-blue-100"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Скрыть
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Показать условие
                </>
              )}
            </Button>
          </div>

          {isExpanded && (
            <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded-lg text-sm max-h-[400px] overflow-y-auto">
              {task.condition_text ? (
                <div className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {task.condition_text}
                </div>
              ) : task.condition_photo_url ? (
                <div>
                  <img 
                    src={task.condition_photo_url} 
                    alt="Условие задачи" 
                    className="max-w-full h-auto rounded cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setImageModalOpen(true)}
                  />
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400">
                  Условие не загружено
                </p>
              )}

              {task.ai_analysis && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-gray-600 dark:text-gray-300 font-medium mb-1">
                    🤖 AI Анализ:
                  </div>
                  {task.ai_analysis.type && (
                    <div className="text-gray-700 dark:text-gray-300">
                      Тип: {task.ai_analysis.type}
                    </div>
                  )}
                  {task.ai_analysis.solution_steps && (
                    <div className="mt-2">
                      <div className="text-gray-600 dark:text-gray-300 text-xs mb-1">
                        План решения:
                      </div>
                      <ul className="list-disc list-inside text-gray-700 dark:text-gray-300 text-xs space-y-1">
                        {task.ai_analysis.solution_steps.map((step: string, i: number) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
