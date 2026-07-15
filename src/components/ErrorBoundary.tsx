import React, { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, Copy, Check } from 'lucide-react';
import { reportClientError } from '@/lib/clientErrorReport';
import { copyTextToClipboard } from '@/lib/copyToClipboard';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkLoadError: boolean;
  showDetails: boolean;
  copied: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      isChunkLoadError: false,
      showDetails: false,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    // Check if it's a chunk loading error (common after deployments)
    const isChunkLoadError =
      error.message.includes('Failed to fetch dynamically imported module') ||
      error.message.includes('Loading chunk') ||
      error.message.includes('ChunkLoadError') ||
      error.message.includes('Loading CSS chunk') ||
      error.name === 'ChunkLoadError';

    return {
      hasError: true,
      error,
      isChunkLoadError,
      showDetails: false,
      copied: false,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Component stack:', errorInfo.componentStack);
    // PII-free репорт в analytics_events (→ /admin «Ошибки») — иначе о белых
    // экранах узнаём по скриншотам в TG через дни (инцидент Глеба 2026-07-15).
    reportClientError(error.message, 'screen');
  }

  buildSupportText = (): string => {
    const err = this.state.error;
    return [
      `Ошибка: ${err?.message ?? 'неизвестно'}`,
      `Страница: ${window.location.href}`,
      `Браузер: ${navigator.userAgent}`,
      `Время: ${new Date().toISOString()}`,
      err?.stack ? `Stack:\n${err.stack}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  handleCopyForSupport = async () => {
    const ok = await copyTextToClipboard(this.buildSupportText());
    if (ok) {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }
  };

  handleReload = () => {
    // Clear any potentially stale caches before reloading
    if ('caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => {
          caches.delete(name);
        });
      }).finally(() => {
        globalThis.location.reload();
      });
    } else {
      globalThis.location.reload();
    }
  };

  handleGoHome = () => {
    globalThis.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div 
          className="min-h-screen flex items-center justify-center p-4 bg-background"
          style={{ opacity: 1, visibility: 'visible' }}
        >
          <div 
            className="max-w-md w-full bg-card text-card-foreground rounded-lg border shadow-sm"
            style={{ opacity: 1, visibility: 'visible' }}
          >
            <div className="text-center p-6 pb-2">
              <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold">
                {this.state.isChunkLoadError 
                  ? 'Доступна новая версия' 
                  : 'Что-то пошло не так'}
              </h3>
              <p className="text-sm text-muted-foreground mt-1.5">
                {this.state.isChunkLoadError 
                  ? 'Приложение было обновлено. Пожалуйста, обновите страницу для загрузки новой версии.'
                  : 'Произошла ошибка при загрузке страницы. Попробуйте обновить страницу.'}
              </p>
            </div>
            <div className="p-6 pt-0 flex flex-col gap-3">
              <Button onClick={this.handleReload} className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" />
                Обновить страницу
              </Button>
              <Button variant="outline" onClick={this.handleGoHome} className="w-full">
                На главную
              </Button>
              {this.state.error && (
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground min-h-[44px]"
                      style={{ touchAction: 'manipulation' }}
                      aria-expanded={this.state.showDetails}
                    >
                      {this.state.showDetails ? 'Скрыть детали' : 'Показать детали'}
                    </button>
                    <button
                      type="button"
                      onClick={this.handleCopyForSupport}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground min-h-[44px]"
                      style={{ touchAction: 'manipulation' }}
                    >
                      {this.state.copied ? (
                        <>
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          Скопировано
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          Скопировать для поддержки
                        </>
                      )}
                    </button>
                  </div>
                  {this.state.showDetails && (
                    <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-32 whitespace-pre-wrap break-words">
                      {this.state.error.message}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
