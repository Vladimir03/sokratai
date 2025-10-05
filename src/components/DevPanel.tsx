import { useState, useEffect } from "react";
import { PerformanceMonitor } from "@/utils/performanceMetrics";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Copy, TrendingUp, Wifi, AlertCircle, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "@/hooks/use-toast";

const DevPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [recentRequests, setRecentRequests] = useState<any[]>([]);
  const [connectionType, setConnectionType] = useState('unknown');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const updateData = () => {
      setStats(PerformanceMonitor.getSessionStats());
      setRecentRequests(PerformanceMonitor.getRecentRequests(10));
      setConnectionType(PerformanceMonitor.getConnectionType());
    };

    updateData();
    const interval = setInterval(updateData, 1000);

    return () => clearInterval(interval);
  }, [isOpen]);

  const handleCopyReport = async () => {
    const report = PerformanceMonitor.generateReport();
    try {
      await navigator.clipboard.writeText(report);
      toast({
        title: "Отчет скопирован",
        description: "Отчет о производительности скопирован в буфер обмена",
      });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось скопировать отчет",
        variant: "destructive",
      });
    }
  };

  if (!isOpen) return null;

  const chartData = recentRequests.map((req, index) => ({
    name: `#${recentRequests.length - index}`,
    time: (req.totalTime / 1000).toFixed(2),
  })).reverse();

  const errorCount = recentRequests.filter(r => !r.success).length;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-auto bg-card border-border shadow-elegant">
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">
              Панель разработчика
            </h2>
            <span className="text-xs text-muted-foreground">
              (Alt+Shift+D для закрытия)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleCopyReport}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <Copy className="w-4 h-4" />
              Копировать отчет
            </Button>
            <Button
              onClick={() => setIsOpen(false)}
              variant="ghost"
              size="icon"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-secondary/50 border-border">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                Среднее время
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats ? `${(stats.avgTotalTime / 1000).toFixed(1)}s` : 'N/A'}
              </div>
            </Card>

            <Card className="p-4 bg-secondary/50 border-border">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Activity className="w-4 h-4" />
                Запросов
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stats?.totalRequests || 0}
              </div>
            </Card>

            <Card className="p-4 bg-secondary/50 border-border">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <AlertCircle className="w-4 h-4" />
                Ошибок
              </div>
              <div className="text-2xl font-bold text-destructive">
                {errorCount}
              </div>
            </Card>

            <Card className="p-4 bg-secondary/50 border-border">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
                <Wifi className="w-4 h-4" />
                Соединение
              </div>
              <div className="text-2xl font-bold text-foreground uppercase">
                {connectionType}
              </div>
            </Card>
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <Card className="p-4 bg-secondary/50 border-border">
              <h3 className="text-sm font-medium text-foreground mb-4">
                📈 График времени ответов
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis 
                    dataKey="name" 
                    stroke="hsl(var(--muted-foreground))"
                    style={{ fontSize: '12px' }}
                  />
                  <YAxis 
                    stroke="hsl(var(--muted-foreground))"
                    style={{ fontSize: '12px' }}
                    label={{ value: 'секунды', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--foreground))'
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="time" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Recent Requests */}
          <Card className="p-4 bg-secondary/50 border-border">
            <h3 className="text-sm font-medium text-foreground mb-4">
              ⚡ Последние 10 запросов
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recentRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Нет данных о запросах
                </p>
              ) : (
                recentRequests.map((req, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-background rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`text-lg ${req.success ? 'text-green-500' : 'text-destructive'}`}>
                        {req.success ? '✓' : '✗'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">
                          {req.query || 'N/A'}
                        </p>
                        {req.error && (
                          <p className="text-xs text-destructive truncate">
                            {req.error}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      <p className="text-sm font-medium text-foreground">
                        {(req.totalTime / 1000).toFixed(2)}s
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(req.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );
};

export default DevPanel;
