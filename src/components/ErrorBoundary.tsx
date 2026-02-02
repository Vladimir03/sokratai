import React, { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isChunkLoadError: boolean;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null,
      isChunkLoadError: false 
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
      isChunkLoadError 
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Component stack:', errorInfo.componentStack);
  }

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
                <pre className="mt-4 p-3 bg-muted rounded text-xs overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
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
