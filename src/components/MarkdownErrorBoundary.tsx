import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Plain-text содержимое сообщения — рендерится как fallback при краше markdown-рендера. */
  fallbackText: string;
}

interface State {
  hasError: boolean;
}

/**
 * Per-bubble предохранитель вокруг ReactMarkdown в чатах: любой сбой рендера
 * markdown (regex-несовместимость старого Safari, битый LaTeX, баг плагина)
 * деградирует ОДИН пузырь в plain text вместо того, чтобы уронить весь экран
 * в глобальный ErrorBoundary (инцидент Глеба, 2026-07-15, rule 80).
 */
class MarkdownErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('MarkdownErrorBoundary: markdown render failed:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return <p className="whitespace-pre-wrap break-words">{this.props.fallbackText}</p>;
    }
    return this.props.children;
  }
}

export default MarkdownErrorBoundary;
