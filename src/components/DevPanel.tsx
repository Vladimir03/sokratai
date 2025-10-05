import { useState, useEffect } from "react";
import { PerformanceMonitor } from "@/utils/performanceMetrics";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Copy, TrendingUp, Wifi, AlertCircle, Activity } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "@/hooks/use-toast";

const DevPanel = () => {
  const [stats, setStats] = useState<any>(null);
  const [recentRequests, setRecentRequests] = useState<any[]>([]);
  const [connectionType, setConnectionType] = useState('unknown');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Check if debug mode is enabled via URL parameter
  const isDebugMode = new URLSearchParams(window.location.search).get('debug') === 'true';

  useEffect(() => {
    if (!isDebugMode) return;

    const updateData = () => {
      setStats(PerformanceMonitor.getSessionStats());
      setRecentRequests(PerformanceMonitor.getRecentRequests(10));
      setConnectionType(PerformanceMonitor.getConnectionType());
    };

    updateData();
    const interval = setInterval(updateData, 1000);

    return () => clearInterval(interval);
  }, [isDebugMode]);

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

  if (!isDebugMode) return null;

  const chartData = recentRequests.map((req, index) => {
    const totalTime = req.endTime ? (req.endTime - req.startTime) / 1000 : 0;
    return {
      name: `#${recentRequests.length - index}`,
      time: totalTime.toFixed(2),
    };
  }).reverse();

  const errorCount = stats?.errors || 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-h-[80vh] overflow-hidden">
      <Card className="bg-card/95 backdrop-blur-md border-border shadow-elegant">
        <div className="bg-card border-b border-border p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              Dev Panel
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <Button
              onClick={handleCopyReport}
              variant="ghost"
              size="sm"
              className="gap-2 h-8"
            >
              <Copy className="w-3 h-3" />
              Отчет
            </Button>
            <Button
              onClick={() => setIsCollapsed(!isCollapsed)}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              {isCollapsed ? "+" : "−"}
            </Button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="p-3 space-y-3 max-h-[calc(80vh-60px)] overflow-y-auto">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="p-2 bg-secondary/50 border-border">
                <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                  <TrendingUp className="w-3 h-3" />
                  Среднее
                </div>
                <div className="text-lg font-bold text-foreground">
                  {stats ? `${(stats.avgTotalTime / 1000).toFixed(1)}s` : 'N/A'}
                </div>
              </Card>

              <Card className="p-2 bg-secondary/50 border-border">
                <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                  <Activity className="w-3 h-3" />
                  Запросов
                </div>
                <div className="text-lg font-bold text-foreground">
                  {stats?.totalRequests || 0}
                </div>
              </Card>

              <Card className="p-2 bg-secondary/50 border-border">
                <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                  <AlertCircle className="w-3 h-3" />
                  Ошибок
                </div>
                <div className="text-lg font-bold text-destructive">
                  {errorCount}
                </div>
              </Card>

              <Card className="p-2 bg-secondary/50 border-border">
                <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                  <Wifi className="w-3 h-3" />
                  Сеть
                </div>
                <div className="text-lg font-bold text-foreground uppercase text-xs">
                  {connectionType}
                </div>
              </Card>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
              <Card className="p-3 bg-secondary/50 border-border">
                <h3 className="text-xs font-medium text-foreground mb-2">
                  📈 График времени ответов
                </h3>
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="name" 
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '10px' }}
                    />
                    <YAxis 
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '10px' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--foreground))',
                        fontSize: '11px'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="time" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))', r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* Recent Requests with Breakdown */}
            <Card className="p-3 bg-secondary/50 border-border">
              <h3 className="text-xs font-medium text-foreground mb-2">
                ⚡ Последние запросы
              </h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {recentRequests.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Нет данных
                  </p>
                ) : (
                  recentRequests.slice(0, 5).map((req, index) => {
                    const breakdown = req.breakdown;
                    const totalTime = req.endTime ? (req.endTime - req.startTime) / 1000 : 0;
                    
                    return (
                      <div
                        key={index}
                        className="p-2 bg-background rounded border border-border"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className={`text-sm ${req.success ? 'text-green-500' : 'text-destructive'}`}>
                              {req.success ? '✓' : '✗'}
                            </span>
                            <p className="text-xs text-foreground truncate flex-1">
                              {req.query || 'N/A'}
                            </p>
                          </div>
                          <span className="text-xs font-medium text-foreground ml-2">
                            {totalTime.toFixed(2)}s
                          </span>
                        </div>
                        
                        {breakdown && (
                          <div className="pl-6 space-y-0.5 mt-1 border-l-2 border-primary/30">
                            <div className="text-[10px] text-muted-foreground flex justify-between">
                              <span>→ First token:</span>
                              <span className="font-medium">{(breakdown.ttft / 1000).toFixed(2)}s</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground flex justify-between">
                              <span>→ Streaming:</span>
                              <span className="font-medium">{(breakdown.streamingTime / 1000).toFixed(2)}s</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground flex justify-between">
                              <span>→ DB save:</span>
                              <span className="font-medium">{(breakdown.dbSaveTime / 1000).toFixed(2)}s</span>
                            </div>
                            <div className={`text-[10px] font-semibold mt-1 ${
                              breakdown.bottleneck === 'api' ? 'text-orange-500' :
                              breakdown.bottleneck === 'streaming' ? 'text-yellow-500' :
                              breakdown.bottleneck === 'database' ? 'text-red-500' :
                              'text-green-500'
                            }`}>
                              ⚠️ {breakdown.bottleneck.toUpperCase()}: {breakdown.bottleneckDescription}
                            </div>
                          </div>
                        )}
                        
                        {req.error && (
                          <p className="text-[10px] text-destructive truncate mt-1 pl-6">
                            {req.error}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>
        )}
      </Card>
    </div>
  );
};

export default DevPanel;
