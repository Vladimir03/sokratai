interface RequestMetrics {
  timestamp: number;
  timeToFirstToken: number;
  totalTime: number;
  success: boolean;
  error?: string;
}

const METRICS_KEY = 'chat_performance_metrics';

export class PerformanceMonitor {
  private static requestStart: number | null = null;
  private static timeoutId: NodeJS.Timeout | null = null;
  private static onSlowRequest: (() => void) | null = null;

  static startRequest(onSlowRequest?: () => void) {
    this.requestStart = Date.now();
    this.onSlowRequest = onSlowRequest || null;
    
    // Устанавливаем таймер для медленных запросов (5 секунд)
    this.timeoutId = setTimeout(() => {
      if (this.onSlowRequest) {
        this.onSlowRequest();
      }
      console.warn('⚠️ Slow request detected (>5s)');
    }, 5000);
  }

  static recordFirstToken() {
    if (!this.requestStart) return;
    
    const timeToFirstToken = Date.now() - this.requestStart;
    console.log(`⚡ Time to first token: ${timeToFirstToken}ms`);
    
    // Очищаем таймер медленного запроса
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    return timeToFirstToken;
  }

  static endRequest(success: boolean, error?: string) {
    if (!this.requestStart) return;
    
    const totalTime = Date.now() - this.requestStart;
    const timeToFirstToken = this.recordFirstToken() || 0;

    const metrics: RequestMetrics = {
      timestamp: Date.now(),
      timeToFirstToken,
      totalTime,
      success,
      error,
    };

    this.saveMetrics(metrics);
    this.logMetrics(metrics);
    
    this.requestStart = null;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private static saveMetrics(metrics: RequestMetrics) {
    try {
      const stored = sessionStorage.getItem(METRICS_KEY);
      const allMetrics: RequestMetrics[] = stored ? JSON.parse(stored) : [];
      
      // Храним только последние 50 запросов
      allMetrics.push(metrics);
      if (allMetrics.length > 50) {
        allMetrics.shift();
      }

      sessionStorage.setItem(METRICS_KEY, JSON.stringify(allMetrics));
    } catch (error) {
      console.error('Error saving metrics:', error);
    }
  }

  private static logMetrics(metrics: RequestMetrics) {
    const { timeToFirstToken, totalTime, success, error } = metrics;
    
    if (!success) {
      console.error('❌ Request failed:', {
        timeToFirstToken: `${timeToFirstToken}ms`,
        totalTime: `${totalTime}ms`,
        error,
      });
    } else {
      console.log('✅ Request completed:', {
        timeToFirstToken: `${timeToFirstToken}ms`,
        totalTime: `${totalTime}ms`,
      });
    }
  }

  static getSessionStats() {
    try {
      const stored = sessionStorage.getItem(METRICS_KEY);
      if (!stored) return null;

      const metrics: RequestMetrics[] = JSON.parse(stored);
      const successfulRequests = metrics.filter(m => m.success);
      
      if (successfulRequests.length === 0) return null;

      const avgTimeToFirstToken = 
        successfulRequests.reduce((sum, m) => sum + m.timeToFirstToken, 0) / 
        successfulRequests.length;

      const avgTotalTime = 
        successfulRequests.reduce((sum, m) => sum + m.totalTime, 0) / 
        successfulRequests.length;

      const failureRate = 
        ((metrics.length - successfulRequests.length) / metrics.length) * 100;

      return {
        totalRequests: metrics.length,
        successfulRequests: successfulRequests.length,
        avgTimeToFirstToken: Math.round(avgTimeToFirstToken),
        avgTotalTime: Math.round(avgTotalTime),
        failureRate: failureRate.toFixed(1),
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
    console.log(`Average time to first token: ${stats.avgTimeToFirstToken}ms`);
    console.log(`Average total time: ${stats.avgTotalTime}ms`);
    console.log(`Failure rate: ${stats.failureRate}%`);
    console.groupEnd();
  }

  static clearMetrics() {
    sessionStorage.removeItem(METRICS_KEY);
    console.log('✨ Performance metrics cleared');
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
