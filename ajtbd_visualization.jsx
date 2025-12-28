import React, { useState } from 'react';

const jobsData = {
  bigJob: {
    id: 'big-job',
    title: 'BIG JOB',
    subtitle: 'Набрать 80-100 баллов по профильным предметам',
    description: 'КОГДА: Я школьник 10-11 класса и понимаю, что школьной подготовки недостаточно\nХОЧУ: Набрать нужные баллы с минимальными затратами\nЧТОБЫ: Поступить в целевой вуз и чувствовать уверенность',
    color: '#DC2626',
    quotes: [
      'Считает, что подготовиться к ЕГЭ только учась в школе нельзя (14 из 17 респондентов)',
      'Идеальный сервис для подготовки к ЕГЭ: каждому ученику отдельный наставник'
    ]
  },
  churnReasons: [
    { reason: 'Забыли / сложно найти', count: '6 из 9', critical: true },
    { reason: 'Не хватило теории', count: '5 из 9', critical: true },
    { reason: 'Нет видео формата', count: '7 из 9', critical: false },
    { reason: 'Задания не как на ЕГЭ', count: '3 из 9', critical: false },
    { reason: 'Нет 2 части', count: '4 из 9', critical: false }
  ],
  coreJobs: [
    {
      id: 'job-1',
      number: 1,
      title: 'Набить руку на типовых заданиях',
      description: 'КОГДА: Знаю теорию, но при решении делаю ошибки\nХОЧУ: Прорешать много однотипных заданий\nЧТОБЫ: На экзамене решать первую часть быстро',
      color: '#2563EB',
      priority: 'high',
      source: 'both',
      quotes: [
        'Использовал тренажер именно как "тренажер" - чтобы "набить руку"',
        'Тренажер полезен тем, что это отработка заданий, а на ЕГЭ это самое главное'
      ]
    },
    {
      id: 'job-2',
      number: 2,
      title: 'Понять через объяснение (не текст!)',
      description: 'КОГДА: Читаю текстовое объяснение и не понимаю\nХОЧУ: Чтобы кто-то объяснил "как школьнику"\nЧТОБЫ: Реально понять, а не увидеть готовый ответ',
      color: '#DC2626',
      priority: 'critical',
      source: 'churned',
      isNew: true,
      quotes: [
        'Видео формат больше нравится — так лучше усваивается материал, когда кто-то объясняет',
        'Они пропускают действия, и я не до конца понимаю, как они к этому пришли'
      ]
    },
    {
      id: 'job-3',
      number: 3,
      title: '🔥 Уточнить непонятное у кого-то',
      description: 'КОГДА: Прочитал объяснение, но остались вопросы\nХОЧУ: Спросить "а почему так?" и получить ответ сразу\nЧТОБЫ: Не ждать репетитора',
      color: '#DC2626',
      priority: 'critical',
      source: 'churned',
      isNew: true,
      validation: true,
      quotes: [
        'Хотел бы, чтобы "онлайн репетитор" отвечал за пару минут',
        'Положительно оценивает возможность внедрения помощника/ИИ ассистента',
        'Мне кажется, надо чтобы связь с преподавателем или с кем-то была'
      ]
    },
    {
      id: 'job-4',
      number: 4,
      title: 'Отслеживать свой прогресс',
      description: 'КОГДА: Готовлюсь и не понимаю, насколько я готов\nХОЧУ: Видеть конкретные метрики прогресса\nЧТОБЫ: Чувствовать контроль над подготовкой',
      color: '#2563EB',
      priority: 'high',
      source: 'both',
      quotes: [
        'Это очень необходимо, потому что пока ты не будешь отслеживать прогресс, ты не будешь понимать',
        'Вообще главное — это дисциплина, второе — отслеживать свой прогресс'
      ]
    },
    {
      id: 'job-5',
      number: 5,
      title: 'Заниматься когда удобно',
      description: 'КОГДА: Плотный график, нет фиксированного времени\nХОЧУ: Доступ к подготовке в любой момент\nЧТОБЫ: Использовать "мёртвое время"',
      color: '#16A34A',
      priority: 'medium',
      source: 'active',
      quotes: [
        'Тренажер нравится тем, что он удобен, можно учиться в любое время',
        'Можешь его в любой момент в любом месте открыть'
      ]
    },
    {
      id: 'job-6',
      number: 6,
      title: 'Не забывать заниматься',
      description: 'КОГДА: Знаю что нужно, но забываю/откладываю\nХОЧУ: Чтобы система напоминала\nЧТОБЫ: Выработать привычку',
      color: '#F59E0B',
      priority: 'high',
      source: 'churned',
      quotes: [
        'Серия, наверное, тоже прикольная штука. Когда уже большое число, не хочется его нарушать',
        'Забыл про тренажер и легко про него забыть'
      ]
    },
    {
      id: 'job-7',
      number: 7,
      title: 'Готовиться близко к формату ЕГЭ',
      description: 'КОГДА: Боюсь неожиданностей на экзамене\nХОЧУ: Задания похожие на реальный ЕГЭ\nЧТОБЫ: На экзамене всё было знакомым',
      color: '#2563EB',
      priority: 'high',
      source: 'both',
      quotes: [
        'В тренажере нравится, что формат близок к формату ЕГЭ',
        'Смутило то, что некоторые задания не совпадали с заданиями ЕГЭ'
      ]
    }
  ],
  socialFeatures: {
    want: 6,
    dontWant: 8,
    insight: 'Хотят ПОМОЩЬ, не обязательно ОБЩЕНИЕ. AI закрывает потребность без социальной составляющей.'
  }
};

const insights = [
  {
    title: '🔥 ПРЯМАЯ ВАЛИДАЦИЯ SOCRAT',
    text: '7 из 9 оттекших явно просят возможность "спросить у кого-то". Это главная причина оттока из тренажеров.',
    action: 'AI-тьютор — это именно то, чего не хватает',
    critical: true
  },
  {
    title: 'Тренажер ≠ Репетитор',
    text: 'Школьники чётко разделяют. Тренажер — для практики. Репетитор — для объяснений.',
    action: 'Позиционировать Socrat как AI-РЕПЕТИТОР'
  },
  {
    title: 'Забывают + Сложно найти',
    text: 'Главная причина оттока — не проблема ценности, а проблема доступа.',
    action: 'Telegram решает обе проблемы — всегда на виду + push'
  },
  {
    title: 'Видео > Текст для объяснений',
    text: '7 из 9 оттекших предпочитают видео. Но причина — "когда кто-то объясняет".',
    action: 'AI объясняет "как человек" — компромисс видео + текст'
  },
  {
    title: 'Социальные функции — 50/50',
    text: 'Половина хотят общение, половина нет. Но все хотят ПОМОЩЬ.',
    action: 'AI лучше чата — помощь без навязчивого общения'
  }
];

export default function AJTBDMap() {
  const [selectedJob, setSelectedJob] = useState(null);
  const [activeTab, setActiveTab] = useState('churn');

  const JobCard = ({ job, isSelected, onClick }) => (
    <div
      onClick={() => onClick(job)}
      className={`p-4 rounded-lg cursor-pointer transition-all duration-200 border-2 ${
        isSelected 
          ? 'border-blue-500 shadow-lg scale-105' 
          : 'border-transparent hover:border-gray-300 hover:shadow-md'
      } ${job.validation ? 'ring-2 ring-red-400 ring-offset-2' : ''}`}
      style={{ backgroundColor: job.color + '15' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span 
          className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style={{ backgroundColor: job.color }}
        >
          {job.number || '★'}
        </span>
        <h3 className="font-semibold text-gray-800 text-sm">{job.title}</h3>
      </div>
      <div className="flex flex-wrap gap-1">
        {job.isNew && (
          <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">🆕 Из оттекших</span>
        )}
        {job.validation && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">✓ Валидация Socrat</span>
        )}
        {job.priority === 'critical' && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Критическая</span>
        )}
        {job.priority === 'high' && !job.validation && (
          <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700">Высокая</span>
        )}
      </div>
    </div>
  );

  const DetailPanel = ({ job }) => (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
      <div className="flex items-center gap-3 mb-4">
        <span 
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
          style={{ backgroundColor: job.color }}
        >
          {job.number || '★'}
        </span>
        <div>
          <h2 className="text-xl font-bold text-gray-800">{job.title}</h2>
          {job.validation && (
            <span className="text-sm text-red-600 font-medium">🔥 Прямая валидация Socrat!</span>
          )}
        </div>
      </div>
      
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="font-semibold text-gray-700 mb-2">Формулировка по AJTBD:</h4>
        <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans">{job.description}</pre>
      </div>
      
      {job.quotes && job.quotes.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2">💬 Цитаты из интервью:</h4>
          <div className="space-y-2">
            {job.quotes.map((quote, idx) => (
              <div key={idx} className="bg-blue-50 rounded-lg p-3 text-sm italic text-gray-700 border-l-4 border-blue-400">
                "{quote}"
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            📊 Карта работ AJTBD
          </h1>
          <p className="text-gray-600">
            Анализ 17 интервью: 8 активных + 9 оттекших | Методология Ивана Замесина
          </p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center gap-2 mb-6 flex-wrap">
          {[
            { id: 'churn', label: '🚨 Причины оттока' },
            { id: 'graph', label: '🗺️ Граф работ' },
            { id: 'insights', label: '💡 Инсайты' },
            { id: 'social', label: '🤝 Социальные функции' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Churn Tab */}
        {activeTab === 'churn' && (
          <div className="space-y-6">
            <div className="bg-red-50 rounded-xl p-6 border border-red-200">
              <h2 className="text-xl font-bold text-red-800 mb-4">🚨 Почему уходят из тренажера (9 оттекших)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {jobsData.churnReasons.map((item, idx) => (
                  <div 
                    key={idx}
                    className={`p-4 rounded-lg ${item.critical ? 'bg-red-100 border-2 border-red-300' : 'bg-white'}`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-gray-800">{item.reason}</span>
                      <span className={`text-sm font-bold ${item.critical ? 'text-red-600' : 'text-gray-500'}`}>
                        {item.count}
                      </span>
                    </div>
                    {item.critical && (
                      <span className="text-xs text-red-600">⚠️ Критическая причина</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-green-50 rounded-xl p-6 border border-green-200">
              <h2 className="text-xl font-bold text-green-800 mb-4">✅ Что могло бы вернуть (запросы оттекших)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg p-4 border-l-4 border-green-500">
                  <h3 className="font-bold text-gray-800 mb-2">🤖 AI-ассистент / онлайн репетитор</h3>
                  <p className="text-sm text-gray-600 italic">"Хотел бы, чтобы при подготовке онлайн репетитор отвечал за пару минут"</p>
                  <span className="text-xs text-green-600 font-semibold mt-2 block">7 из 9 оттекших!</span>
                </div>
                <div className="bg-white rounded-lg p-4 border-l-4 border-green-500">
                  <h3 className="font-bold text-gray-800 mb-2">🎬 Видео разборы</h3>
                  <p className="text-sm text-gray-600 italic">"Видео формат больше нравится — так лучше усваивается"</p>
                </div>
                <div className="bg-white rounded-lg p-4 border-l-4 border-green-500">
                  <h3 className="font-bold text-gray-800 mb-2">🔔 Напоминания</h3>
                  <p className="text-sm text-gray-600 italic">"Серия — прикольная штука. Не хочется её нарушать"</p>
                </div>
                <div className="bg-white rounded-lg p-4 border-l-4 border-green-500">
                  <h3 className="font-bold text-gray-800 mb-2">📝 Подробные объяснения</h3>
                  <p className="text-sm text-gray-600 italic">"Не до конца понимаю, как они к этому пришли"</p>
                </div>
              </div>
            </div>

            <div className="bg-purple-50 rounded-xl p-6 border border-purple-200">
              <h2 className="text-xl font-bold text-purple-800 mb-2">🎯 Вывод для Socrat</h2>
              <p className="text-lg text-purple-900">
                Оттекшие уходят не потому что тренажер плохой, а потому что <strong>не могут уточнить непонятное</strong>. 
                Socrat закрывает именно эту работу — это <strong>прямая валидация продукта</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Graph Tab */}
        {activeTab === 'graph' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Big Job */}
              <div className="bg-red-50 rounded-xl p-4 border-2 border-red-200">
                <h3 className="text-lg font-bold text-red-800 mb-3">🎯 BIG JOB (Главная работа)</h3>
                <JobCard 
                  job={jobsData.bigJob} 
                  isSelected={selectedJob?.id === jobsData.bigJob.id}
                  onClick={setSelectedJob}
                />
              </div>

              {/* Core Jobs */}
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-800 mb-3">🔵 CORE JOBS (Ключевые работы)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {jobsData.coreJobs.map(job => (
                    <JobCard 
                      key={job.id}
                      job={job} 
                      isSelected={selectedJob?.id === job.id}
                      onClick={setSelectedJob}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              {selectedJob ? (
                <DetailPanel job={selectedJob} />
              ) : (
                <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center text-gray-500">
                  <div className="text-4xl mb-3">👆</div>
                  <p>Выберите работу для просмотра деталей и цитат из интервью</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Insights Tab */}
        {activeTab === 'insights' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {insights.map((insight, idx) => (
              <div 
                key={idx}
                className={`bg-white rounded-xl p-6 shadow-lg border ${insight.critical ? 'border-red-300 ring-2 ring-red-200' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">💡</span>
                  <h3 className="text-lg font-bold text-gray-800">{insight.title}</h3>
                </div>
                <p className="text-gray-600 mb-4">{insight.text}</p>
                <div className={`rounded-lg p-3 ${insight.critical ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
                  <span className={`text-xs font-semibold uppercase ${insight.critical ? 'text-red-700' : 'text-green-700'}`}>
                    Для Socrat:
                  </span>
                  <p className={`font-medium mt-1 ${insight.critical ? 'text-red-800' : 'text-green-800'}`}>
                    {insight.action}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Social Tab */}
        {activeTab === 'social' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 shadow-lg">
              <h2 className="text-xl font-bold text-gray-800 mb-4">🤝 Отношение к социальным функциям</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-green-50 rounded-lg p-4">
                  <h3 className="font-bold text-green-800 mb-3">✅ Хотят общение ({jobsData.socialFeatures.want} из 17)</h3>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li>• Чат для взаимопомощи</li>
                    <li>• Возможность спросить совет</li>
                    <li>• Кооперативный режим с друзьями</li>
                  </ul>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                  <h3 className="font-bold text-red-800 mb-3">❌ Не хотят общение ({jobsData.socialFeatures.dontWant} из 17)</h3>
                  <ul className="space-y-2 text-sm text-gray-700">
                    <li>• "Подготовка — моё личное пространство"</li>
                    <li>• "Будет отвлекать от учёбы"</li>
                    <li>• "Для общения есть соцсети"</li>
                  </ul>
                </div>
              </div>

              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                <h3 className="font-bold text-purple-800 mb-2">🎯 Ключевой инсайт</h3>
                <p className="text-purple-900">{jobsData.socialFeatures.insight}</p>
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
              <h2 className="text-xl font-bold text-blue-800 mb-4">📊 Сводка по функциям</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-blue-200">
                      <th className="text-left py-2 px-3">Функция</th>
                      <th className="text-center py-2 px-3">За</th>
                      <th className="text-center py-2 px-3">Против</th>
                      <th className="text-left py-2 px-3">Рекомендация</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-blue-100">
                      <td className="py-2 px-3">Рейтинги/таблицы</td>
                      <td className="text-center py-2 px-3 text-green-600 font-bold">10</td>
                      <td className="text-center py-2 px-3 text-red-600 font-bold">4</td>
                      <td className="py-2 px-3">Делать опциональными</td>
                    </tr>
                    <tr className="border-b border-blue-100">
                      <td className="py-2 px-3">Общий чат</td>
                      <td className="text-center py-2 px-3 text-green-600 font-bold">6</td>
                      <td className="text-center py-2 px-3 text-red-600 font-bold">8</td>
                      <td className="py-2 px-3">Не приоритет</td>
                    </tr>
                    <tr className="border-b border-blue-100">
                      <td className="py-2 px-3">Помощь от других</td>
                      <td className="text-center py-2 px-3 text-green-600 font-bold">8</td>
                      <td className="text-center py-2 px-3 text-red-600 font-bold">3</td>
                      <td className="py-2 px-3 font-bold text-purple-600">→ Заменить AI-ассистентом!</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          Источник: 17 глубинных интервью с пользователями «Число Т» (август 2024)
        </div>
      </div>
    </div>
  );
}
