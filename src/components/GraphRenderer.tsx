/**
 * GraphRenderer - компонент для рендеринга графиков из Python кода
 * Использует Pyodide для выполнения matplotlib в браузере
 */

import { useState, useEffect, useCallback, memo } from 'react';
import { Loader2, AlertCircle, RefreshCw, ZoomIn, Download, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { executePythonCode, getPyodideStatus } from '@/utils/pyodide';
import { cn } from '@/lib/utils';

interface GraphRendererProps {
  /** Python код для выполнения */
  code: string;
  /** Дополнительные CSS классы */
  className?: string;
  /** Автоматически выполнять код при монтировании */
  autoExecute?: boolean;
}

/**
 * Состояния рендеринга графика
 */
type RenderState = 'idle' | 'loading-pyodide' | 'executing' | 'success' | 'error';

const GraphRenderer = memo(function GraphRenderer({
  code,
  className,
  autoExecute = true,
}: GraphRendererProps) {
  const [state, setState] = useState<RenderState>('idle');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  /**
   * Выполняет Python код и получает график
   */
  const executeCode = useCallback(async () => {
    try {
      const pyodideStatus = getPyodideStatus();

      if (!pyodideStatus.isLoaded) {
        setState('loading-pyodide');
      } else {
        setState('executing');
      }

      const result = await executePythonCode(code);

      if (result.success && result.imageBase64) {
        setImageBase64(result.imageBase64);
        setState('success');
        setError(null);
      } else if (result.success && !result.imageBase64) {
        // Код выполнен, но график не создан
        setError('Код выполнен, но график не был создан');
        setState('error');
      } else {
        setError(result.error || 'Неизвестная ошибка');
        setState('error');
      }
    } catch (err) {
      console.error('GraphRenderer error:', err);
      setError(err instanceof Error ? err.message : 'Ошибка выполнения');
      setState('error');
    }
  }, [code]);

  // Автоматическое выполнение при монтировании
  useEffect(() => {
    if (autoExecute && state === 'idle') {
      executeCode();
    }
  }, [autoExecute, state, executeCode]);

  /**
   * Скачивает график как PNG файл
   */
  const downloadImage = useCallback(() => {
    if (!imageBase64) return;

    const link = document.createElement('a');
    link.href = `data:image/png;base64,${imageBase64}`;
    link.download = `график_${Date.now()}.png`;
    link.click();
  }, [imageBase64]);

  /**
   * Рендерит состояние загрузки
   */
  const renderLoading = () => (
    <div className="flex flex-col items-center justify-center py-8 px-4 bg-muted/30 rounded-lg border border-dashed">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
      <p className="text-sm text-muted-foreground text-center">
        {state === 'loading-pyodide'
          ? 'Загрузка Python окружения...'
          : 'Построение графика...'}
      </p>
      <p className="text-xs text-muted-foreground/70 mt-1">
        Первая загрузка может занять 10-15 секунд
      </p>
    </div>
  );

  /**
   * Рендерит ошибку
   */
  const renderError = () => (
    <div className="flex flex-col items-center justify-center py-6 px-4 bg-destructive/10 rounded-lg border border-destructive/20">
      <AlertCircle className="h-8 w-8 text-destructive mb-3" />
      <p className="text-sm text-destructive font-medium mb-2">
        Ошибка построения графика
      </p>
      <p className="text-xs text-muted-foreground text-center mb-4 max-w-xs">
        {error}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={executeCode}
        className="gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        Попробовать снова
      </Button>
    </div>
  );

  /**
   * Рендерит график
   */
  const renderGraph = () => (
    <div className="relative group">
      {/* Основное изображение */}
      <Dialog>
        <DialogTrigger asChild>
          <div className="cursor-zoom-in relative">
            <img
              src={`data:image/png;base64,${imageBase64}`}
              alt="Математический график"
              className="w-full rounded-lg border shadow-sm transition-shadow hover:shadow-md"
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10 rounded-lg">
              <ZoomIn className="h-8 w-8 text-white drop-shadow-lg" />
            </div>
          </div>
        </DialogTrigger>
        <DialogContent className="max-w-4xl p-2">
          <img
            src={`data:image/png;base64,${imageBase64}`}
            alt="Математический график (увеличено)"
            className="w-full rounded-lg"
          />
        </DialogContent>
      </Dialog>

      {/* Панель действий */}
      <div className="flex items-center gap-2 mt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={downloadImage}
          className="gap-1.5 text-xs h-7"
        >
          <Download className="h-3.5 w-3.5" />
          Скачать
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={executeCode}
          className="gap-1.5 text-xs h-7"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Перестроить
        </Button>
      </div>
    </div>
  );

  return (
    <div className={cn('my-4', className)}>
      {/* График или состояние загрузки */}
      {(state === 'loading-pyodide' || state === 'executing') && renderLoading()}
      {state === 'error' && renderError()}
      {state === 'success' && imageBase64 && renderGraph()}

      {/* Исходный код (сворачиваемый) */}
      <Collapsible open={showCode} onOpenChange={setShowCode} className="mt-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7 text-muted-foreground">
            <Code2 className="h-3.5 w-3.5" />
            {showCode ? 'Скрыть код' : 'Показать код'}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-x-auto">
            <code>{code}</code>
          </pre>
        </CollapsibleContent>
      </Collapsible>

      {/* Кнопка запуска для idle состояния */}
      {state === 'idle' && !autoExecute && (
        <Button
          variant="outline"
          size="sm"
          onClick={executeCode}
          className="gap-2"
        >
          <Code2 className="h-4 w-4" />
          Построить график
        </Button>
      )}
    </div>
  );
});

export default GraphRenderer;
