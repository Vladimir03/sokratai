import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, AlertTriangle, TrendingDown, Users, MessageSquare, Target } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Данные анализа
const categoryData = [
  { name: "C: Mismatch Expectations", value: 27, color: "#ef4444" },
  { name: "D: Успешный диалог", value: 11, color: "#22c55e" },
  { name: "B: UX проблемы", value: 10, color: "#f59e0b" },
  { name: "A: Технические ошибки", value: 2, color: "#6366f1" },
];

const subcategoryData = [
  { subcategory: "C1: Хотел готовый ответ", count: 18, percent: 36 },
  { subcategory: "C3: Диалог оборвался", count: 7, percent: 14 },
  { subcategory: "D1: Успешный диалог", count: 9, percent: 18 },
  { subcategory: "B2: Слишком длинный диалог", count: 8, percent: 16 },
  { subcategory: "D2: Тестирование системы", count: 2, percent: 4 },
  { subcategory: "C2: Хотел быстрое решение", count: 2, percent: 4 },
  { subcategory: "B3: Непонятные объяснения", count: 2, percent: 4 },
  { subcategory: "A3: Не понял вопрос", count: 2, percent: 4 },
];

const platformData = [
  { platform: "Telegram", churned: 40, total: 43, retentionD1: "7%" },
  { platform: "Web", churned: 10, total: 20, retentionD1: "50%" },
];

const correlationData = [
  { factor: "Длинный ответ (>300 символов)", churnRate: 72, impact: "high" },
  { factor: "2+ вопроса в ответе", churnRate: 68, impact: "high" },
  { factor: "Homework_help тип вопроса", churnRate: 85, impact: "critical" },
  { factor: "Первый ответ без решения", churnRate: 90, impact: "critical" },
];

const recommendations = [
  {
    id: 1,
    title: "Добавить режим 'Быстрый ответ' для срочных задач",
    problem: "C1: 36% пользователей хотят готовый ответ, а не диалог",
    impact: "high",
    complexity: "medium",
    description: "Детектировать слова 'срочно', 'реши', 'дай ответ' и предлагать сразу решение с пояснениями после",
    expectedImprovement: "+15-20% D1 retention"
  },
  {
    id: 2,
    title: "Сократить первый ответ до 150-200 символов",
    problem: "B2: Длинные ответы коррелируют с 72% churn",
    impact: "high",
    complexity: "easy",
    description: "Первый ответ должен быть кратким: подтвердить понимание задачи + один конкретный вопрос",
    expectedImprovement: "+10-15% D1 retention"
  },
  {
    id: 3,
    title: "Добавить онбординг про сократовский метод",
    problem: "C3: 14% пользователей не понимают концепцию и уходят",
    impact: "medium",
    complexity: "easy",
    description: "Перед первым диалогом показать: 'Я помогаю понять, а не списать. Если нужен ответ - скажи!'",
    expectedImprovement: "+5-10% D1 retention"
  },
  {
    id: 4,
    title: "Улучшить Telegram experience",
    problem: "Telegram retention 7% vs Web 50%",
    impact: "critical",
    complexity: "hard",
    description: "Telegram аудитория ожидает быстрых ответов. Добавить быстрые кнопки: [Покажи решение] [Дай подсказку] [Объясни]",
    expectedImprovement: "+20-30% D1 retention для Telegram"
  },
  {
    id: 5,
    title: "Детектировать 'застревание' и предлагать помощь",
    problem: "B2: 16% диалогов слишком длинные без результата",
    impact: "medium",
    complexity: "medium",
    description: "После 5 сообщений без прогресса предложить: 'Кажется, мы застряли. Хочешь, покажу решение?'",
    expectedImprovement: "+8-12% D1 retention"
  }
];

const RetentionAnalysis = () => {
  const handleDownloadCSV = () => {
    window.open('/churned_users_analysis.csv', '_blank');
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Анализ Retention: 50 Churned Users</h1>
            <p className="text-muted-foreground mt-2">
              Детальный анализ причин ухода пользователей с D1 retention = 0%
            </p>
          </div>
          <Button onClick={handleDownloadCSV} className="gap-2">
            <Download className="h-4 w-4" />
            Скачать CSV
          </Button>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">D1 Retention</p>
                  <p className="text-2xl font-bold text-red-600">5%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Главная причина</p>
                  <p className="text-lg font-bold">Mismatch (54%)</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Users className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Telegram vs Web</p>
                  <p className="text-lg font-bold">7% vs 50%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Target className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Потенциал роста</p>
                  <p className="text-lg font-bold">+40-60%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Распределение по категориям проблем</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name.split(':')[0]}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Bar Chart - Subcategories */}
          <Card>
            <CardHeader>
              <CardTitle>Топ подкатегорий проблем</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={subcategoryData} layout="vertical">
                  <XAxis type="number" />
                  <YAxis dataKey="subcategory" type="category" width={180} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Platform Comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Сравнение платформ: Telegram vs Web
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Платформа</TableHead>
                  <TableHead>Churned Users</TableHead>
                  <TableHead>Всего Users</TableHead>
                  <TableHead>D1 Retention</TableHead>
                  <TableHead>Разница</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platformData.map((row) => (
                  <TableRow key={row.platform}>
                    <TableCell className="font-medium">{row.platform}</TableCell>
                    <TableCell>{row.churned}</TableCell>
                    <TableCell>{row.total}</TableCell>
                    <TableCell>
                      <Badge variant={row.platform === "Telegram" ? "destructive" : "default"}>
                        {row.retentionD1}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.platform === "Telegram" ? (
                        <span className="text-red-600 font-semibold">-43% vs Web</span>
                      ) : (
                        <span className="text-green-600 font-semibold">Baseline</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-amber-800">
                <strong>Вывод:</strong> Telegram аудитория имеет критически низкий retention. 
                Гипотеза: Telegram пользователи ожидают быстрых ответов как от ChatGPT, 
                а получают длинные сократовские диалоги.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Correlations */}
        <Card>
          <CardHeader>
            <CardTitle>Корреляции с churn</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Фактор</TableHead>
                  <TableHead>Churn Rate</TableHead>
                  <TableHead>Impact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {correlationData.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{row.factor}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-red-500 rounded-full" 
                            style={{ width: `${row.churnRate}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{row.churnRate}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.impact === "critical" ? "destructive" : "secondary"}>
                        {row.impact}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Рекомендации по улучшению retention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recommendations.map((rec) => (
                <div 
                  key={rec.id} 
                  className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg font-semibold">#{rec.id}</span>
                        <h3 className="font-semibold">{rec.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        <strong>Проблема:</strong> {rec.problem}
                      </p>
                      <p className="text-sm">{rec.description}</p>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <div className="flex gap-2">
                        <Badge variant={rec.impact === "critical" ? "destructive" : rec.impact === "high" ? "default" : "secondary"}>
                          Impact: {rec.impact}
                        </Badge>
                        <Badge variant="outline">
                          Complexity: {rec.complexity}
                        </Badge>
                      </div>
                      <span className="text-sm text-green-600 font-semibold">
                        {rec.expectedImprovement}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Key Insights */}
        <Card className="border-2 border-primary">
          <CardHeader>
            <CardTitle>🔑 Ключевые инсайты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <h4 className="font-semibold text-red-800 mb-2">❌ Root Cause #1</h4>
                <p className="text-red-700">
                  <strong>54% пользователей (27 из 50)</strong> ушли из-за несоответствия ожиданий: 
                  хотели готовый ответ, получили сократовский метод с вопросами.
                </p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                <h4 className="font-semibold text-orange-800 mb-2">⚠️ Root Cause #2</h4>
                <p className="text-orange-700">
                  <strong>Telegram retention 7% vs Web 50%</strong> — разрыв в 7 раз. 
                  Telegram аудитория требует другого подхода.
                </p>
              </div>
              <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                <h4 className="font-semibold text-amber-800 mb-2">📊 Pattern</h4>
                <p className="text-amber-700">
                  <strong>90% churned диалогов</strong> оборвались после ответа Сократа с вопросом. 
                  Пользователь ожидал решения, получил вопрос — ушёл.
                </p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <h4 className="font-semibold text-green-800 mb-2">✅ Positive Signal</h4>
                <p className="text-green-700">
                  <strong>22% пользователей (11 из 50)</strong> — категория D: диалог прошёл хорошо, 
                  но не вернулись. Это потенциал для push-уведомлений и retention hooks.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle>📋 Сводка для Product Team</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none">
              <h4>Приоритет #1: Режим "Быстрый ответ"</h4>
              <p>
                Внедрение режима быстрого ответа для срочных запросов — критически важно. 
                Детектировать ключевые слова ("срочно", "дай ответ", "реши") и предлагать 
                сразу решение с последующим объяснением. Ожидаемый impact: +15-20% D1 retention.
              </p>
              
              <h4>Приоритет #2: Telegram Quick Buttons</h4>
              <p>
                Добавить интерактивные кнопки в Telegram: [Покажи решение] [Дай подсказку] [Объясни].
                Это позволит пользователям управлять глубиной помощи. Ожидаемый impact: +20-30% D1 для Telegram.
              </p>
              
              <h4>Приоритет #3: Онбординг про метод</h4>
              <p>
                Добавить короткое объяснение перед первым диалогом: "Я помогаю понять, а не просто списать. 
                Если нужен быстрый ответ — скажи 'реши задачу'". Ожидаемый impact: +5-10% D1.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default RetentionAnalysis;
