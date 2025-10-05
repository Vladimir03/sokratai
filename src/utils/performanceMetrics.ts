interface RequestMetrics {
  timestamp: number;
  startTime: number;
  firstTokenTime?: number;
  endTime?: number;
  dbSaveStart?: number;
  dbSaveEnd?: number;
  success: boolean;
  error?: string;
  query?: string;
}

interface DetailedBreakdown {
  ttft: number; // Time to first token
  streamingTime: number; // First token → Complete
  dbSaveTime: number; // DB save duration
  totalTime: number; // Complete request time
  bottleneck: 'api' | 'streaming' | 'database' | 'none';
  bottleneckDescription: string;
}

const METRICS_KEY = 'chat_performance_metrics';

export class PerformanceMonitor {
  private static currentRequest: RequestMetrics | null = null;
  private static timeoutId: NodeJS.Timeout | null = null;
  private static onSlowRequest: (() => void) | null = null;
  private static allMetrics: RequestMetrics[] = [];

  static startRequest(onSlowRequest?: () => void, query?: string) {
    this.currentRequest = {
      timestamp: Date.now(),
      startTime: Date.now(),
      success: false,
      query,
    };
    
    this.onSlowRequest = onSlowRequest || null;
    
    // Устанавливаем таймер для медленных запросов (5 секунд)
    this.timeoutId = setTimeout(() => {
      if (this.onSlowRequest) {
        this.onSlowRequest();
      }
      console.warn('⚠️ Slow request detected (>5s)');
    }, 5000);

    console.log('🚀 Request started');
  }

  static recordFirstToken() {
    if (!this.currentRequest) return;
    
    this.currentRequest.firstTokenTime = Date.now();
    const ttft = this.currentRequest.firstTokenTime - this.currentRequest.startTime;
    console.log(`⚡ TTFT: ${ttft}ms`);
    
    // Очищаем таймер медленного запроса
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    return ttft;
  }

  static startDbSave() {
    if (!this.currentRequest) return;
    this.currentRequest.dbSaveStart = Date.now();
    console.log('💾 DB save started');
  }

  static endDbSave() {
    if (!this.currentRequest || !this.currentRequest.dbSaveStart) return;
    
    this.currentRequest.dbSaveEnd = Date.now();
    const dbTime = this.currentRequest.dbSaveEnd - this.currentRequest.dbSaveStart;
    console.log(`💾 DB save completed: ${dbTime}ms`);
    
    return dbTime;
  }

  static endRequest(success: boolean, error?: string) {
    if (!this.currentRequest) return;
    
    this.currentRequest.endTime = Date.now();
    this.currentRequest.success = success;
    this.currentRequest.error = error;

    const totalTime = this.currentRequest.endTime - this.currentRequest.startTime;
    console.log(`${success ? '✅' : '❌'} Request ${success ? 'completed' : 'failed'}: ${totalTime}ms`);
    
    this.saveMetrics(this.currentRequest);
    
    this.currentRequest = null;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private static saveMetrics(metrics: RequestMetrics) {
    try {
      const stored = sessionStorage.getItem(METRICS_KEY);
      this.allMetrics = stored ? JSON.parse(stored) : [];
      
      // Храним только последние 50 запросов
      this.allMetrics.push(metrics);
      if (this.allMetrics.length > 50) {
        this.allMetrics.shift();
      }

      sessionStorage.setItem(METRICS_KEY, JSON.stringify(this.allMetrics));
    } catch (error) {
      console.error('Error saving metrics:', error);
    }
  }

  static calculateBreakdown(metric: RequestMetrics): DetailedBreakdown | null {
    if (!metric.firstTokenTime || !metric.endTime) return null;

    const ttft = metric.firstTokenTime - metric.startTime;
    const streamingTime = metric.endTime - metric.firstTokenTime;
    const dbSaveTime = metric.dbSaveEnd && metric.dbSaveStart 
      ? metric.dbSaveEnd - metric.dbSaveStart 
      : 0;
    const totalTime = metric.endTime - metric.startTime;

    // Определяем bottleneck
    let bottleneck: DetailedBreakdown['bottleneck'] = 'none';
    let bottleneckDescription = 'All systems operational';

    if (ttft > 3000) {
      bottleneck = 'api';
      bottleneckDescription = 'API/Prompt taking too long';
    } else if (streamingTime > 3000) {
      bottleneck = 'streaming';
      bottleneckDescription = 'Streaming is slow';
    } else if (dbSaveTime > 1000) {
      bottleneck = 'database';
      bottleneckDescription = 'Database save is slow';
    }

    return { ttft, streamingTime, dbSaveTime, totalTime, bottleneck, bottleneckDescription };
  }

  static getSessionStats() {
    try {
      const stored = sessionStorage.getItem(METRICS_KEY);
      if (!stored) return null;

      const metrics: RequestMetrics[] = JSON.parse(stored);
      const successfulRequests = metrics.filter(m => m.success && m.endTime);
      
      if (successfulRequests.length === 0) return null;

      const avgTotalTime = 
        successfulRequests.reduce((sum, m) => sum + (m.endTime! - m.startTime), 0) / 
        successfulRequests.length;

      const avgTTFT = successfulRequests
        .filter(m => m.firstTokenTime)
        .reduce((sum, m) => sum + (m.firstTokenTime! - m.startTime), 0) / 
        successfulRequests.length;

      const failureRate = 
        ((metrics.length - successfulRequests.length) / metrics.length) * 100;

      return {
        totalRequests: metrics.length,
        successfulRequests: successfulRequests.length,
        avgTotalTime: Math.round(avgTotalTime),
        avgTTFT: Math.round(avgTTFT),
        failureRate: failureRate.toFixed(1),
        errors: metrics.length - successfulRequests.length,
      };
    } catch (error) {
      console.error('Error getting session stats:', error);
      return null;
    }
  }

  static logSessionStats() {
    const stats = this.getSessionStats();
    if (!stats) {
      console.log('📊 No performance data available yet');
      return;
    }

    console.group('📊 Session Performance Stats');
    console.log(`Total requests: ${stats.totalRequests}`);
    console.log(`Successful: ${stats.successfulRequests}`);
    console.log(`Average TTFT: ${stats.avgTTFT}ms`);
    console.log(`Average total time: ${stats.avgTotalTime}ms`);
    console.log(`Failure rate: ${stats.failureRate}%`);
    console.groupEnd();
  }

  static clearMetrics() {
    sessionStorage.removeItem(METRICS_KEY);
    this.allMetrics = [];
    console.log('✨ Performance metrics cleared');
  }

  static getRecentRequests(limit: number = 10): (RequestMetrics & { breakdown?: DetailedBreakdown | null })[] {
    try {
      const stored = sessionStorage.getItem(METRICS_KEY);
      if (!stored) return [];

      const metrics: RequestMetrics[] = JSON.parse(stored);
      return metrics.slice(-limit).reverse().map(m => ({
        ...m,
        breakdown: this.calculateBreakdown(m)
      }));
    } catch (error) {
      console.error('Error getting recent requests:', error);
      return [];
    }
  }

  static getConnectionType(): string {
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      return connection?.effectiveType || 'unknown';
    }
    return 'unknown';
  }

  static generateReport(): string {
    const stats = this.getSessionStats();
    const recentRequests = this.getRecentRequests(10);
    
    if (!stats) {
      return '=== PERFORMANCE REPORT ===\nNo data available yet';
    }

    const slowestRequest = recentRequests.reduce((slowest, req) => {
      const currentTime = req.endTime ? req.endTime - req.startTime : 0;
      const slowestTime = slowest.endTime ? slowest.endTime - slowest.startTime : 0;
      return currentTime > slowestTime ? req : slowest;
    }, recentRequests[0]);

    const connectionType = this.getConnectionType();

    let report = '=== PERFORMANCE REPORT ===\n';
    report += `Avg Response: ${(stats.avgTotalTime / 1000).toFixed(1)}s\n`;
    report += `Avg TTFT: ${(stats.avgTTFT / 1000).toFixed(1)}s\n`;
    report += `Requests: ${stats.totalRequests}\n`;
    report += `Errors: ${stats.errors}\n`;
    report += `Connection: ${connectionType}\n`;
    
    if (slowestRequest && slowestRequest.breakdown) {
      const b = slowestRequest.breakdown;
      const query = slowestRequest.query 
        ? `"${slowestRequest.query.substring(0, 30)}${slowestRequest.query.length > 30 ? '...' : ''}"`
        : 'N/A';
      
      report += `\nSlowest: ${(b.totalTime / 1000).toFixed(1)}s (Query: ${query})\n`;
      report += `\n=== BREAKDOWN (Slowest Request) ===\n`;
      report += `Request sent → First token: ${(b.ttft / 1000).toFixed(1)}s\n`;
      report += `First token → Complete: ${(b.streamingTime / 1000).toFixed(1)}s\n`;
      report += `DB save: ${(b.dbSaveTime / 1000).toFixed(1)}s\n`;
      report += `TOTAL: ${(b.totalTime / 1000).toFixed(1)}s\n`;
      report += `BOTTLENECK: ${b.bottleneck.toUpperCase()} - ${b.bottleneckDescription}`;
    }

    return report;
  }
}

// Глобальная функция для доступа из DevTools
if (typeof window !== 'undefined') {
  (window as any).chatPerformance = {
    stats: () => PerformanceMonitor.logSessionStats(),
    clear: () => PerformanceMonitor.clearMetrics(),
  };
  
  console.log('💡 Performance monitoring available:');
  console.log('  - chatPerformance.stats() - view session statistics');
  console.log('  - chatPerformance.clear() - clear metrics');
}
