/* global React */
// Tutor kit — Students workspace: roster → split-view statistics → drill-down
// Reuses primitives from primitives.jsx, chrome.jsx, workplace.jsx.
// Exported to window as: StudentsWorkspace.

const { useState: _useStateS, useEffect: _useEffectS, useMemo: _useMemoS, useRef: _useRefS } = React;

// ─── Sample data (stand-in; Claude Code will wire real data) ───
const STUDENTS_DATA = [
  { id:"s1", name:"Маша Коротаева", grade:10, stream:"ЕГЭ", subjects:["физика","математика"],
    tutor:"Владимир Г.", since:"сентябрь 2024",
    hwAvg:4.6, hwAvgDelta:+0.2, discipline:92, overdue:0, mockLast:78, mockDelta:+6, mockDate:"06.04",
    attention:false, nextLesson:"вт, 22.04 · 18:00", lessonsTotal:24,
    hwTrend:[4.2,4.4,4.5,4.3,4.6,4.8],
    mockTrend:[58,62,68,72,78],
    statusTone:"success", statusLabel:"активна", lastSession:"18.04 18:00" },
  { id:"s2", name:"Саша Петров", grade:11, stream:"ЕГЭ", subjects:["математика"],
    tutor:"Владимир Г.", since:"октябрь 2024",
    hwAvg:3.6, hwAvgDelta:-0.4, discipline:64, overdue:3, mockLast:52, mockDelta:-8, mockDate:"05.04",
    attention:true, attentionReason:"3 просроченных ДЗ · пробник −8 баллов",
    nextLesson:"ср, 23.04 · 17:00", lessonsTotal:18,
    hwTrend:[4.0,3.9,3.8,3.6,3.5,3.6],
    mockTrend:[60,62,58,60,52],
    statusTone:"warning", statusLabel:"долг по ДЗ", lastSession:"16.04 17:00" },
  { id:"s3", name:"Лена Иванова", grade:9, stream:"ОГЭ", subjects:["математика"],
    tutor:"Владимир Г.", since:"сентябрь 2024",
    hwAvg:4.3, hwAvgDelta:+0.1, discipline:88, overdue:0, mockLast:19, mockDelta:+2, mockDate:"08.04",
    attention:false, nextLesson:"чт, 24.04 · 16:00", lessonsTotal:22,
    hwTrend:[4.1,4.2,4.2,4.3,4.3,4.3],
    mockTrend:[14,16,17,17,19],
    statusTone:"success", statusLabel:"активна", lastSession:"17.04 16:00" },
  { id:"s4", name:"Артём Белов", grade:11, stream:"ЕГЭ", subjects:["физика"],
    tutor:"Владимир Г.", since:"март 2025",
    hwAvg:3.2, hwAvgDelta:-0.6, discipline:48, overdue:5, mockLast:41, mockDelta:-12, mockDate:"03.04",
    attention:true, attentionReason:"5 просроченных ДЗ · пробник в зоне риска",
    nextLesson:"пт, 25.04 · 19:00", lessonsTotal:6,
    hwTrend:[3.8,3.6,3.5,3.4,3.2,3.2],
    mockTrend:[55,53,50,48,41],
    statusTone:"danger", statusLabel:"просрочено", lastSession:"10.04 19:00" },
  { id:"s5", name:"Катя Морозова", grade:10, stream:"ЕГЭ", subjects:["физика","математика"],
    tutor:"Владимир Г.", since:"август 2024",
    hwAvg:4.9, hwAvgDelta:+0.1, discipline:98, overdue:0, mockLast:88, mockDelta:+4, mockDate:"07.04",
    attention:false, nextLesson:"вт, 22.04 · 17:00", lessonsTotal:28,
    hwTrend:[4.7,4.8,4.8,4.9,4.9,4.9],
    mockTrend:[78,80,84,84,88],
    statusTone:"success", statusLabel:"активна", lastSession:"18.04 17:00" },
  { id:"s6", name:"Никита Орлов", grade:9, stream:"ОГЭ", subjects:["математика"],
    tutor:"Владимир Г.", since:"ноябрь 2024",
    hwAvg:3.8, hwAvgDelta:-0.1, discipline:72, overdue:2, mockLast:15, mockDelta:-1, mockDate:"09.04",
    attention:true, attentionReason:"2 просроченных ДЗ · балл снижается",
    nextLesson:"сб, 26.04 · 12:00", lessonsTotal:14,
    hwTrend:[4.0,3.9,3.9,3.8,3.7,3.8],
    mockTrend:[13,14,16,16,15],
    statusTone:"warning", statusLabel:"на проверке", lastSession:"14.04 15:00" },
  { id:"s7", name:"Полина Сидорова", grade:11, stream:"ЕГЭ", subjects:["математика"],
    tutor:"Владимир Г.", since:"октябрь 2024",
    hwAvg:4.4, hwAvgDelta:+0.2, discipline:85, overdue:1, mockLast:72, mockDelta:+3, mockDate:"04.04",
    attention:false, nextLesson:"пн, 21.04 · 20:00", lessonsTotal:20,
    hwTrend:[4.2,4.3,4.2,4.4,4.4,4.4],
    mockTrend:[64,66,68,70,72],
    statusTone:"info", statusLabel:"назначено", lastSession:"17.04 20:00" },
  { id:"s8", name:"Данил Киселёв", grade:10, stream:"ЕГЭ", subjects:["физика"],
    tutor:"Владимир Г.", since:"сентябрь 2024",
    hwAvg:4.1, hwAvgDelta:0, discipline:80, overdue:1, mockLast:65, mockDelta:+1, mockDate:"05.04",
    attention:false, nextLesson:"чт, 24.04 · 18:00", lessonsTotal:19,
    hwTrend:[4.1,4.0,4.1,4.1,4.1,4.1],
    mockTrend:[60,62,63,64,65],
    statusTone:"success", statusLabel:"активен", lastSession:"17.04 18:00" },
  { id:"s9", name:"Вика Смирнова", grade:11, stream:"ЕГЭ", subjects:["математика","физика"],
    tutor:"Владимир Г.", since:"сентябрь 2024",
    hwAvg:4.7, hwAvgDelta:+0.3, discipline:94, overdue:0, mockLast:82, mockDelta:+7, mockDate:"06.04",
    attention:false, nextLesson:"ср, 23.04 · 19:00", lessonsTotal:26,
    hwTrend:[4.3,4.4,4.5,4.5,4.6,4.7],
    mockTrend:[70,72,76,78,82],
    statusTone:"success", statusLabel:"активна", lastSession:"17.04 19:00" },
  { id:"s10", name:"Егор Шубин", grade:9, stream:"ОГЭ", subjects:["математика"],
    tutor:"Владимир Г.", since:"февраль 2025",
    hwAvg:3.9, hwAvgDelta:+0.1, discipline:78, overdue:1, mockLast:16, mockDelta:+1, mockDate:"08.04",
    attention:false, nextLesson:"пт, 25.04 · 16:00", lessonsTotal:10,
    hwTrend:[3.8,3.8,3.9,3.8,3.9,3.9],
    mockTrend:[14,15,15,16,16],
    statusTone:"success", statusLabel:"активен", lastSession:"16.04 16:00" },
  { id:"s11", name:"Аня Иванова", grade:10, stream:"ЕГЭ", subjects:["физика"],
    tutor:"Владимир Г.", since:"20 апреля 2026",
    hwAvg:null, hwAvgDelta:null, discipline:null, overdue:0, mockLast:null, mockDelta:null, mockDate:null,
    attention:false, empty:true, nextLesson:"не назначено", lessonsTotal:0,
    hwTrend:[], mockTrend:[],
    statusTone:"neutral", statusLabel:"добавлен сегодня", lastSession:"—" },
  { id:"s12", name:"Тимур Ахметов", grade:11, stream:"ЕГЭ", subjects:["физика","математика"],
    tutor:"Владимир Г.", since:"январь 2025",
    hwAvg:4.2, hwAvgDelta:+0.1, discipline:82, overdue:0, mockLast:68, mockDelta:+2, mockDate:"07.04",
    attention:false, nextLesson:"вт, 22.04 · 20:00", lessonsTotal:12,
    hwTrend:[4.1,4.0,4.1,4.2,4.2,4.2],
    mockTrend:[62,64,66,66,68],
    statusTone:"success", statusLabel:"активен", lastSession:"15.04 20:00" },
  { id:"s13", name:"Юля Громова", grade:11, stream:"ЕГЭ", subjects:["математика"],
    tutor:"Владимир Г.", since:"сентябрь 2024",
    hwAvg:4.5, hwAvgDelta:+0.2, discipline:90, overdue:0, mockLast:75, mockDelta:+3, mockDate:"04.04",
    attention:false, nextLesson:"чт, 24.04 · 17:00", lessonsTotal:24,
    hwTrend:[4.3,4.3,4.4,4.4,4.5,4.5],
    mockTrend:[68,70,72,72,75],
    statusTone:"success", statusLabel:"активна", lastSession:"17.04 17:00" },
  { id:"s14", name:"Марк Левин", grade:9, stream:"ОГЭ", subjects:["математика"],
    tutor:"Владимир Г.", since:"октябрь 2024",
    hwAvg:4.0, hwAvgDelta:-0.2, discipline:75, overdue:1, mockLast:17, mockDelta:0, mockDate:"09.04",
    attention:false, nextLesson:"сб, 26.04 · 11:00", lessonsTotal:20,
    hwTrend:[4.2,4.1,4.1,4.0,4.0,4.0],
    mockTrend:[15,16,17,17,17],
    statusTone:"success", statusLabel:"активен", lastSession:"14.04 11:00" },
];

// Recent homework per student (small sample)
const HW_BY_STUDENT = {
  s1: [
    { id:"h1", title:"Кинематика 1D · §2.4", stream:"ЕГЭ", due:"16.04", submitted:"15.04 22:10", score:"8/8", tone:"success", label:"сдано" },
    { id:"h2", title:"Законы сохранения",    stream:"ЕГЭ", due:"12.04", submitted:"12.04 19:40", score:"6/8", tone:"warning", label:"частично" },
    { id:"h3", title:"Динамика · Ньютон",    stream:"ЕГЭ", due:"09.04", submitted:"09.04 20:55", score:"7/8", tone:"success", label:"сдано" },
    { id:"h4", title:"Тригонометрические тождества", stream:"ЕГЭ", due:"05.04", submitted:"05.04 18:20", score:"5/6", tone:"success", label:"сдано" },
    { id:"h5", title:"Импульс тела",         stream:"ЕГЭ", due:"02.04", submitted:"02.04 21:15", score:"6/7", tone:"success", label:"сдано" },
    { id:"h6", title:"Равноускоренное движение", stream:"ЕГЭ", due:"29.03", submitted:"29.03 19:00", score:"7/7", tone:"success", label:"сдано" },
  ],
  s4: [
    { id:"h1", title:"Кинематика 1D · §2.4", stream:"ЕГЭ", due:"16.04", submitted:"—", score:"—", tone:"danger", label:"просрочено" },
    { id:"h2", title:"Законы сохранения",    stream:"ЕГЭ", due:"12.04", submitted:"—", score:"—", tone:"danger", label:"просрочено" },
    { id:"h3", title:"Динамика · Ньютон",    stream:"ЕГЭ", due:"09.04", submitted:"—", score:"—", tone:"danger", label:"просрочено" },
    { id:"h4", title:"Тригонометрические тождества", stream:"ЕГЭ", due:"05.04", submitted:"06.04 23:45", score:"3/6", tone:"warning", label:"позже срока" },
    { id:"h5", title:"Импульс тела",         stream:"ЕГЭ", due:"02.04", submitted:"03.04 14:20", score:"4/7", tone:"warning", label:"позже срока" },
  ],
  s2: [
    { id:"h1", title:"Квадратные уравнения · §1.3", stream:"ЕГЭ", due:"16.04", submitted:"—", score:"—", tone:"danger", label:"просрочено" },
    { id:"h2", title:"Производная функции", stream:"ЕГЭ", due:"12.04", submitted:"—", score:"—", tone:"danger", label:"просрочено" },
    { id:"h3", title:"Логарифмы — базовый",  stream:"ЕГЭ", due:"09.04", submitted:"—", score:"—", tone:"danger", label:"просрочено" },
    { id:"h4", title:"Показательные уравнения", stream:"ЕГЭ", due:"05.04", submitted:"07.04 22:15", score:"3/6", tone:"warning", label:"позже срока" },
    { id:"h5", title:"Системы линейных уравнений", stream:"ЕГЭ", due:"02.04", submitted:"02.04 20:10", score:"5/6", tone:"success", label:"сдано" },
  ],
};
HW_BY_STUDENT.default = [
  { id:"h1", title:"Задание из базы знаний", stream:"ЕГЭ", due:"16.04", submitted:"15.04 19:50", score:"6/7", tone:"success", label:"сдано" },
  { id:"h2", title:"Задание из базы знаний", stream:"ЕГЭ", due:"12.04", submitted:"12.04 21:05", score:"5/6", tone:"success", label:"сдано" },
  { id:"h3", title:"Задание из базы знаний", stream:"ЕГЭ", due:"09.04", submitted:"09.04 18:20", score:"4/5", tone:"success", label:"сдано" },
];

// Mock exam history
const MOCK_HISTORY_BY_STUDENT = {
  s1: [
    { date:"06.04.26", score:78, delta:+6, part1:34, part2:44, variant:"Пр-24" },
    { date:"16.03.26", score:72, delta:+4, part1:32, part2:40, variant:"Пр-23" },
    { date:"24.02.26", score:68, delta:+6, part1:30, part2:38, variant:"Пр-22" },
    { date:"02.02.26", score:62, delta:+4, part1:28, part2:34, variant:"Пр-21" },
    { date:"12.01.26", score:58, delta:null,part1:26, part2:32, variant:"Пр-20" },
  ],
  s4: [
    { date:"03.04.26", score:41, delta:-12, part1:18, part2:23, variant:"Пр-24" },
    { date:"13.03.26", score:53, delta:+3,  part1:22, part2:31, variant:"Пр-23" },
    { date:"21.02.26", score:50, delta:-3,  part1:21, part2:29, variant:"Пр-22" },
    { date:"30.01.26", score:53, delta:-2,  part1:22, part2:31, variant:"Пр-21" },
    { date:"09.01.26", score:55, delta:null,part1:23, part2:32, variant:"Пр-20" },
  ],
  s2: [
    { date:"05.04.26", score:52, delta:-8, part1:22, part2:30, variant:"Пр-24" },
    { date:"15.03.26", score:60, delta:0,  part1:25, part2:35, variant:"Пр-23" },
    { date:"23.02.26", score:60, delta:-2, part1:25, part2:35, variant:"Пр-22" },
    { date:"01.02.26", score:62, delta:+2, part1:26, part2:36, variant:"Пр-21" },
    { date:"11.01.26", score:60, delta:null,part1:25, part2:35, variant:"Пр-20" },
  ],
};

// Weak topics per student
const WEAK_BY_STUDENT = {
  s1: [
    { topic:"Законы сохранения", formula:"p = mv, \\; E_k = \\tfrac{mv^2}{2}", accuracy:58, attempts:12, priority:"high" },
    { topic:"Сила трения",      formula:"F_{тр} = \\mu N",           accuracy:64, attempts:10, priority:"med" },
    { topic:"Тригонометрические тождества", formula:"\\sin^2\\alpha + \\cos^2\\alpha = 1", accuracy:72, attempts:9, priority:"med" },
    { topic:"Равновесие тел",   formula:"\\sum F_i = 0, \\; \\sum M_i = 0", accuracy:81, attempts:7,  priority:"low" },
    { topic:"Работа и энергия", formula:"A = F\\,s\\cos\\alpha",      accuracy:84, attempts:8,  priority:"low" },
  ],
  s4: [
    { topic:"Законы Ньютона",    formula:"\\vec{F} = m\\vec{a}",  accuracy:42, attempts:14, priority:"high" },
    { topic:"Кинематика · v(t)", formula:"v = v_0 + at",          accuracy:48, attempts:12, priority:"high" },
    { topic:"Сила трения",       formula:"F_{тр} = \\mu N",        accuracy:55, attempts:11, priority:"high" },
    { topic:"Наклонная плоскость", formula:"ma = F - \\mu m g \\cos\\alpha", accuracy:60, attempts:9,  priority:"med" },
    { topic:"Импульс тела",      formula:"p = mv",                accuracy:68, attempts:8,  priority:"med" },
  ],
  s2: [
    { topic:"Производная сложной функции", formula:"(f(g(x)))' = f'(g(x)) \\cdot g'(x)", accuracy:44, attempts:11, priority:"high" },
    { topic:"Логарифмы", formula:"\\log_a(xy) = \\log_a x + \\log_a y", accuracy:52, attempts:10, priority:"high" },
    { topic:"Показательные уравнения", formula:"a^{f(x)} = a^{g(x)} \\Rightarrow f(x) = g(x)", accuracy:60, attempts:9, priority:"med" },
    { topic:"Тригонометрические уравнения", formula:"\\sin x = a", accuracy:66, attempts:8, priority:"med" },
  ],
};
WEAK_BY_STUDENT.default = [
  { topic:"Базовые преобразования", formula:"a^n \\cdot a^m = a^{n+m}", accuracy:78, attempts:6, priority:"low" },
  { topic:"Линейные уравнения",     formula:"ax + b = 0",              accuracy:82, attempts:5, priority:"low" },
];

// ─── Little visual helpers used in this workspace only ───

// Sparkline (homework average trend)
function Sparkline({ values, height = 28, width = 72, stroke = "var(--sokrat-fg2)" }) {
  if (!values || values.length < 2) return <span className="t-muted" style={{fontSize:12}}>—</span>;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v,i) => `${i*step},${height - ((v-min)/range)*(height-4) - 2}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{display:"block"}}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(values.length-1)*step} cy={height - ((values[values.length-1]-min)/range)*(height-4) - 2} r="2" fill={stroke} />
    </svg>
  );
}

// Mini stacked bar for homework discipline
function DisciplineBar({ onTime, late, missed }) {
  const total = onTime + late + missed || 1;
  return (
    <div style={{display:"flex", height:8, borderRadius:4, overflow:"hidden", background:"var(--sokrat-border-light)"}}>
      <div style={{width:`${onTime/total*100}%`, background:"var(--sokrat-state-success-fg)"}}/>
      <div style={{width:`${late/total*100}%`,   background:"var(--sokrat-state-warning-fg)"}}/>
      <div style={{width:`${missed/total*100}%`, background:"var(--sokrat-state-danger-fg)"}}/>
    </div>
  );
}

// Trend chart (mock exams) — single line with target/threshold guides
function TrendChart({ values, target, threshold, ymin, ymax, height = 140, width = 640, stream = "ЕГЭ" }) {
  const W = width, H = height, padL = 32, padR = 12, padT = 14, padB = 22;
  if (!values || values.length === 0) return null;
  const lo = ymin ?? Math.min(...values, threshold ?? 0, target ?? 100) - 4;
  const hi = ymax ?? Math.max(...values, target ?? 0) + 4;
  const range = hi - lo || 1;
  const step = (W - padL - padR) / (values.length - 1 || 1);
  const y = v => padT + (1 - (v - lo)/range) * (H - padT - padB);
  const pts = values.map((v,i)=>`${padL + i*step},${y(v)}`);
  const lastIdx = values.length - 1;
  const declining = values[lastIdx] < values[lastIdx-1];
  const pointColor = declining ? "var(--sokrat-state-danger-fg)" : "var(--sokrat-green-700)";
  // Grid lines at every ~20%
  const yTicks = 4;
  const ticks = Array.from({length: yTicks+1}, (_,i) => lo + (range*i)/yTicks);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}} aria-label="Динамика пробников">
      {/* Grid */}
      {ticks.map((t,i)=>(
        <g key={i}>
          <line x1={padL} x2={W-padR} y1={y(t)} y2={y(t)} stroke="var(--sokrat-border-light)" strokeWidth="1" />
          <text x={padL-6} y={y(t)+3} textAnchor="end" fontSize="10" fill="var(--sokrat-fg3)" fontFamily="var(--sokrat-font)">{Math.round(t)}</text>
        </g>
      ))}
      {/* Target */}
      {target != null && (
        <g>
          <line x1={padL} x2={W-padR} y1={y(target)} y2={y(target)} stroke="var(--sokrat-green-700)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7"/>
          <text x={W-padR} y={y(target)-4} textAnchor="end" fontSize="10" fill="var(--sokrat-green-800)" fontWeight="600">цель {target}</text>
        </g>
      )}
      {/* Threshold */}
      {threshold != null && (
        <g>
          <line x1={padL} x2={W-padR} y1={y(threshold)} y2={y(threshold)} stroke="var(--sokrat-state-warning-fg)" strokeWidth="1" strokeDasharray="4 3" opacity="0.65"/>
          <text x={W-padR} y={y(threshold)+12} textAnchor="end" fontSize="10" fill="var(--sokrat-state-warning-fg)" fontWeight="600">порог {threshold}</text>
        </g>
      )}
      {/* Line */}
      <polyline points={pts.join(" ")} fill="none" stroke="var(--sokrat-fg1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Points */}
      {values.map((v,i)=>(
        <circle key={i} cx={padL+i*step} cy={y(v)} r={i===lastIdx?4:3}
          fill={i===lastIdx?pointColor:"var(--sokrat-card)"}
          stroke={i===lastIdx?pointColor:"var(--sokrat-fg1)"} strokeWidth="1.5" />
      ))}
      {/* X labels — only last 5 attempts */}
      {values.map((v,i)=>(
        <text key={`xt${i}`} x={padL+i*step} y={H-6} textAnchor="middle" fontSize="10" fill="var(--sokrat-fg3)">#{i+1}</text>
      ))}
    </svg>
  );
}

// Accuracy bar for weak-topic row
function AccuracyBar({ value }) {
  const tone = value < 60 ? "danger" : value < 75 ? "warning" : "success";
  const fg = `var(--sokrat-state-${tone}-fg)`;
  return (
    <div style={{display:"flex", alignItems:"center", gap:8, minWidth:160}}>
      <div style={{flex:1, height:6, background:"var(--sokrat-border-light)", borderRadius:3, overflow:"hidden"}}>
        <div style={{width:`${value}%`, height:"100%", background:fg}}/>
      </div>
      <span className="t-num" style={{fontSize:12, fontWeight:600, color:"var(--sokrat-fg1)", minWidth:34, textAlign:"right"}}>{value}%</span>
    </div>
  );
}

function DeltaPill({ value, unit = "" }) {
  if (value == null || value === 0) return <span className="t-muted t-num" style={{fontSize:12}}>—</span>;
  const positive = value > 0;
  const tone = positive ? "success" : "danger";
  const sign = positive ? "+" : "";
  return (
    <span className="t-num" style={{fontSize:12, fontWeight:600, color:`var(--sokrat-state-${tone}-fg)`}}>
      {sign}{value}{unit}
    </span>
  );
}

// ─── List view — компактная таблица с 1 KPI + сорт/фильтры ───
function StudentsListView({ students, onOpen, filters, setFilters, query, setQuery }) {
  const filtered = students.filter(s => {
    if (filters.attention && !s.attention) return false;
    if (filters.stream && s.stream !== filters.stream) return false;
    if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const needAttention = students.filter(s=>s.attention).length;

  return (
    <>
      <PageHeader
        title="Все ученики"
        meta={`${students.length} учеников · ${needAttention} требуют внимания · ${students.filter(s=>s.stream==='ЕГЭ').length} ЕГЭ · ${students.filter(s=>s.stream==='ОГЭ').length} ОГЭ`}
        primary={<Button variant="primary" size="md" icon="user-plus">Добавить ученика</Button>}
      />
      <Toolbar>
        <div className="t-toolbar__search">
          <span className="t-toolbar__search-icon"><Icon name="search" size={15}/></span>
          <input type="search" placeholder="Поиск по имени"
            value={query} onChange={e=>setQuery(e.target.value)} />
        </div>
        <Chip variant="filter" pressed={filters.attention} onClick={()=>setFilters({...filters, attention:!filters.attention})}>Внимание{needAttention>0 && <span className="t-chip t-chip--count" style={{marginLeft:6}}>{needAttention}</span>}</Chip>
        <Chip variant="filter" pressed={filters.stream==='ЕГЭ'} onClick={()=>setFilters({...filters, stream: filters.stream==='ЕГЭ' ? null : 'ЕГЭ'})}>ЕГЭ</Chip>
        <Chip variant="filter" pressed={filters.stream==='ОГЭ'} onClick={()=>setFilters({...filters, stream: filters.stream==='ОГЭ' ? null : 'ОГЭ'})}>ОГЭ</Chip>
        <span className="t-toolbar__spacer"/>
        <span className="t-muted" style={{fontSize:12}}>{filtered.length} из {students.length}</span>
      </Toolbar>

      <div className="t-table-wrap">
        <table className="t-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Поток</th>
              <th>Предметы</th>
              <th className="is-num">Ø балл ДЗ</th>
              <th>Тренд</th>
              <th className="is-num">Пробник</th>
              <th>Посл. занятие</th>
              <th>Статус</th>
              <th className="is-actions" aria-label="Действия"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} onClick={()=>onOpen(s.id)} style={{cursor:"pointer"}}
                tabIndex={0} onKeyDown={e=>{ if(e.key==="Enter") onOpen(s.id); }}>
                <td className="is-primary">
                  <span style={{display:"inline-flex", alignItems:"center", gap:8}}>
                    {s.attention && <span title={s.attentionReason}
                      style={{width:6, height:6, borderRadius:"50%", background:"var(--sokrat-state-warning-fg)", flex:"none"}}/>}
                    {!s.attention && <span style={{width:6, height:6, flex:"none"}}/>}
                    {s.name}
                  </span>
                </td>
                <td><Chip variant={s.stream==="ЕГЭ" ? "ege" : "oge"}>{s.stream}</Chip></td>
                <td className="t-muted">{s.subjects.join(", ")}</td>
                <td className="is-num">{s.hwAvg != null ? s.hwAvg.toFixed(1) : "—"}</td>
                <td style={{padding:"0 12px"}}>{s.hwTrend && s.hwTrend.length>1 ? <Sparkline values={s.hwTrend}/> : <span className="t-muted" style={{fontSize:12}}>—</span>}</td>
                <td className="is-num">{s.mockLast != null ? s.mockLast : "—"} <DeltaPill value={s.mockDelta}/></td>
                <td className="t-num t-muted">{s.lastSession}</td>
                <td><StatusDot tone={s.statusTone}>{s.statusLabel}</StatusDot></td>
                <td className="is-actions">
                  <div className="row-actions">
                    <Tooltip label="Открыть статистику"><Button variant="ghost" icon="chevron-right" iconOnly aria-label="Открыть" onClick={(e)=>{e.stopPropagation(); onOpen(s.id);}}/></Tooltip>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="t-muted" style={{fontSize:12, marginTop:10, padding:"0 4px"}}>
        Клик по строке открывает статистику ученика — список остаётся слева.
      </div>
    </>
  );
}

// ─── Left roster in split view — узкий список ───
function RosterPane({ students, selectedId, onSelect, filters, setFilters, query, setQuery }) {
  const filtered = students.filter(s => {
    if (filters.attention && !s.attention) return false;
    if (filters.stream && s.stream !== filters.stream) return false;
    if (query && !s.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const needAttention = students.filter(s=>s.attention).length;

  return (
    <aside className="stats-roster">
      <div className="stats-roster__head">
        <div className="t-toolbar__search" style={{maxWidth:"100%"}}>
          <span className="t-toolbar__search-icon"><Icon name="search" size={15}/></span>
          <input type="search" placeholder="Поиск"
            value={query} onChange={e=>setQuery(e.target.value)} />
        </div>
        <div style={{display:"flex", gap:6, flexWrap:"wrap", marginTop:8}}>
          <Chip variant="filter" pressed={filters.attention} onClick={()=>setFilters({...filters, attention:!filters.attention})}>
            Внимание{needAttention>0 && <span className="t-chip t-chip--count" style={{marginLeft:4}}>{needAttention}</span>}
          </Chip>
          <Chip variant="filter" pressed={filters.stream==='ЕГЭ'} onClick={()=>setFilters({...filters, stream: filters.stream==='ЕГЭ' ? null : 'ЕГЭ'})}>ЕГЭ</Chip>
          <Chip variant="filter" pressed={filters.stream==='ОГЭ'} onClick={()=>setFilters({...filters, stream: filters.stream==='ОГЭ' ? null : 'ОГЭ'})}>ОГЭ</Chip>
        </div>
        <div className="t-muted" style={{fontSize:11, marginTop:8, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600}}>
          {filtered.length} {filtered.length===1?"ученик":"учеников"}
        </div>
      </div>
      <div className="stats-roster__list">
        {filtered.map(s => {
          const active = s.id === selectedId;
          return (
            <button key={s.id} className={"stats-roster__row" + (active ? " is-active":"")}
              onClick={()=>onSelect(s.id)}>
              {s.attention
                ? <span style={{width:6, height:6, borderRadius:"50%", background:"var(--sokrat-state-warning-fg)", flex:"none"}}/>
                : <span style={{width:6, height:6, flex:"none"}}/>}
              <Avatar name={s.name} size={32} ring={s.stream==="ЕГЭ" ? "ege" : "oge"}/>
              <div style={{flex:1, minWidth:0}}>
                <div className="stats-roster__name">{s.name}</div>
                <div className="stats-roster__sub">
                  <span>{s.grade} кл · {s.stream}</span>
                </div>
              </div>
              <div style={{display:"flex", flexDirection:"column", alignItems:"flex-end", gap:2, flex:"none"}}>
                <span className="t-num" style={{fontSize:13, fontWeight:600, color:"var(--sokrat-fg1)"}}>
                  {s.hwAvg != null ? s.hwAvg.toFixed(1) : "—"}
                </span>
                <DeltaPill value={s.hwAvgDelta}/>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ─── Right preview — статистика выбранного ученика ───
function StudentStatsPreview({ student, onOpenDrill }) {
  if (!student) {
    return (
      <div className="t-section">
        <EmptyState title="Выберите ученика" body="Кликните на строку слева, чтобы увидеть статистику."/>
      </div>
    );
  }
  const hw = HW_BY_STUDENT[student.id] || HW_BY_STUDENT.default;
  const mockHistory = MOCK_HISTORY_BY_STUDENT[student.id] || [];
  const weak = WEAK_BY_STUDENT[student.id] || WEAK_BY_STUDENT.default;

  // empty state
  if (student.empty) {
    return <StudentStatsEmpty student={student}/>;
  }

  // Discipline breakdown
  const onTime = Math.round(hw.filter(h=>h.tone==="success" && h.label==="сдано").length);
  const late = hw.filter(h=>h.label==="позже срока" || h.label==="частично").length;
  const missed = hw.filter(h=>h.label==="просрочено").length;

  const target = student.stream === "ЕГЭ" ? 80 : 22;
  const threshold = student.stream === "ЕГЭ" ? 60 : 15;

  return (
    <div className="stats-preview">
      {/* Header */}
      <div className="stats-preview__header">
        <Avatar name={student.name} size={56} ring={student.stream==="ЕГЭ" ? "ege" : "oge"}/>
        <div style={{flex:1, minWidth:0}}>
          <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
            <h1 style={{margin:0, fontSize:20, fontWeight:600}}>{student.name}</h1>
            <Chip variant={student.stream==="ЕГЭ" ? "ege" : "oge"}>{student.stream}</Chip>
            <StatusDot tone={student.statusTone}>{student.statusLabel}</StatusDot>
          </div>
          <div className="t-muted" style={{fontSize:13, marginTop:4}}>
            {student.grade} класс · {student.subjects.join(", ")} · {student.lessonsTotal} занятий с {student.since}
          </div>
        </div>
        <div style={{display:"flex", gap:6, flex:"none"}}>
          <Button variant="ghost" size="sm" icon="message-circle">Написать</Button>
          <Button variant="outline" size="sm" icon="clipboard-plus">Назначить ДЗ</Button>
          <Button variant="primary" size="sm" icon="sparkles">Собрать план занятия</Button>
        </div>
      </div>

      {/* Attention banner */}
      {student.attention && (
        <div className="stats-attention">
          <Icon name="alert-triangle" size={18} style={{color:"var(--sokrat-state-warning-fg)", marginTop:1, flex:"none"}}/>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontWeight:600, fontSize:13, color:"var(--sokrat-fg1)", marginBottom:2}}>Требует внимания</div>
            <div className="t-muted" style={{fontSize:13, lineHeight:1.5}}>{student.attentionReason}</div>
          </div>
        </div>
      )}

      {/* 4-KPI strip */}
      <div className="t-stats">
        <div className="t-stats__cell">
          <div className="t-stats__label">Ø балл ДЗ</div>
          <div className="t-stats__value">{student.hwAvg.toFixed(1)}</div>
          <div className="t-stats__meta"><DeltaPill value={student.hwAvgDelta}/> к прошлому месяцу</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Дисциплина</div>
          <div className="t-stats__value">{student.discipline}%</div>
          <div className="t-stats__meta">сдано вовремя</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Просрочено</div>
          <div className="t-stats__value" style={{color: student.overdue>0 ? "var(--sokrat-state-danger-fg)" : "var(--sokrat-fg1)"}}>
            {student.overdue}
          </div>
          <div className="t-stats__meta">{student.overdue===0 ? "нет долгов" : "требуют досдачи"}</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Пробник</div>
          <div className="t-stats__value">{student.mockLast}</div>
          <div className="t-stats__meta">{student.mockDate} · <DeltaPill value={student.mockDelta}/></div>
        </div>
      </div>

      {/* Homework + Mocks 2-column */}
      <div className="t-grid-2">
        <section className="t-section">
          <div className="t-section__header">
            <h2>Домашние задания</h2>
            <span className="t-section__meta">за 30 дней</span>
            <div style={{marginLeft:"auto", display:"flex", gap:6}}>
              <Button variant="ghost" size="sm">Все</Button>
            </div>
          </div>
          <hr className="t-divider"/>
          <div style={{padding:"12px 16px"}}>
            <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:12, fontSize:12, color:"var(--sokrat-fg3)"}}>
              <span style={{display:"inline-flex", alignItems:"center", gap:6}}><span style={{width:8,height:8,borderRadius:2,background:"var(--sokrat-state-success-fg)"}}/> вовремя {onTime}</span>
              <span style={{display:"inline-flex", alignItems:"center", gap:6}}><span style={{width:8,height:8,borderRadius:2,background:"var(--sokrat-state-warning-fg)"}}/> позже {late}</span>
              <span style={{display:"inline-flex", alignItems:"center", gap:6}}><span style={{width:8,height:8,borderRadius:2,background:"var(--sokrat-state-danger-fg)"}}/> не сдано {missed}</span>
            </div>
            <DisciplineBar onTime={onTime} late={late} missed={missed}/>
          </div>
          <hr className="t-divider"/>
          <div>
            {hw.slice(0,6).map(h => (
              <div key={h.id} className="stats-hw-row">
                <StatusDot tone={h.tone}>{""}</StatusDot>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:600, color:"var(--sokrat-fg1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{h.title}</div>
                  <div className="t-muted" style={{fontSize:12}}>{h.label} · сдано {h.submitted}</div>
                </div>
                <span className="t-num t-muted" style={{fontSize:12}}>срок {h.due}</span>
                <span className="t-num" style={{fontSize:13, fontWeight:600, color:"var(--sokrat-fg1)", minWidth:40, textAlign:"right"}}>{h.score}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="t-section">
          <div className="t-section__header">
            <h2>Пробники</h2>
            <span className="t-section__meta">последние 5</span>
            <div style={{marginLeft:"auto"}}>
              <Button variant="ghost" size="sm">Все</Button>
            </div>
          </div>
          <hr className="t-divider"/>
          <div style={{padding:"14px 16px 8px"}}>
            <TrendChart values={mockHistory.slice().reverse().map(m=>m.score)}
              target={target} threshold={threshold} stream={student.stream}/>
          </div>
          <hr className="t-divider"/>
          <div>
            {mockHistory.slice(0,3).map(m => (
              <div key={m.date} className="stats-mock-row">
                <span className="t-num" style={{fontSize:13, fontWeight:600, color:"var(--sokrat-fg1)", minWidth:72}}>{m.date}</span>
                <span className="t-muted" style={{fontSize:12, flex:1}}>{m.variant} · ч.1 {m.part1} + ч.2 {m.part2}</span>
                <span className="t-num" style={{fontSize:14, fontWeight:600, color:"var(--sokrat-fg1)", minWidth:32, textAlign:"right"}}>{m.score}</span>
                <span style={{minWidth:48, textAlign:"right"}}><DeltaPill value={m.delta}/></span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Weak topics */}
      <section className="t-section">
        <div className="t-section__header">
          <h2>Слабые темы</h2>
          <span className="t-section__meta">по последним 6 ДЗ и пробникам</span>
        </div>
        <hr className="t-divider"/>
        <div>
          {weak.map((w,i)=>(
            <button key={i} className="stats-weak-row" onClick={()=>onOpenDrill(w)}>
              <div style={{flex:"0 0 220px", minWidth:0}}>
                <div style={{fontSize:13, fontWeight:600, color:"var(--sokrat-fg1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{w.topic}</div>
                <div className="t-muted" style={{fontSize:12}}>{w.attempts} попыток</div>
              </div>
              <div style={{flex:1, minWidth:0, overflow:"hidden"}}>
                <InlineMath tex={w.formula}/>
              </div>
              <AccuracyBar value={w.accuracy}/>
              <Icon name="chevron-right" size={16} style={{color:"var(--sokrat-fg3)", flex:"none"}}/>
            </button>
          ))}
        </div>
      </section>

      {/* Next action */}
      <section className="stats-next-action">
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:8}}>
          <span style={{fontSize:11, fontWeight:600, color:"var(--sokrat-green-800)", textTransform:"uppercase", letterSpacing:"0.06em"}}>Что дальше</span>
          <span className="t-muted" style={{fontSize:12}}>предложения системы</span>
        </div>
        <div style={{display:"flex", flexDirection:"column", gap:6}}>
          {(student.attention ? [
            `На занятии ${student.nextLesson} — разобрать «${weak[0]?.topic}».`,
            `Назначить короткое ДЗ на ${weak[1]?.topic} (3 задачи).`,
            `Написать родителям о ${student.overdue} просроченных ДЗ.`,
          ] : [
            `На занятии ${student.nextLesson} — закрепить «${weak[0]?.topic}».`,
            `Назначить пробник уровня ${student.mockLast + 5} к ${student.stream === "ЕГЭ" ? "началу мая" : "середине мая"}.`,
            `Добавить ${weak[1]?.topic} в план следующего занятия.`,
          ]).map((txt,i)=>(
            <div key={i} style={{fontSize:13, color:"var(--sokrat-fg1)", lineHeight:1.55, display:"flex", gap:8}}>
              <span style={{color:"var(--sokrat-green-700)", fontWeight:600, flex:"none", minWidth:16}}>—</span>
              <span style={{flex:1}}>{txt}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Sticky lesson footer */}
      <div className="stats-lesson-footer">
        <Icon name="calendar" size={16} style={{color:"var(--sokrat-fg3)"}}/>
        <span style={{fontSize:13, color:"var(--sokrat-fg2)"}}>Следующее занятие:</span>
        <span className="t-num" style={{fontSize:13, fontWeight:600, color:"var(--sokrat-fg1)"}}>{student.nextLesson}</span>
        <span style={{flex:1}}/>
        <Button variant="ghost" size="sm">Перенести</Button>
        <Button variant="outline" size="sm" icon="file-text">Подготовиться</Button>
      </div>
    </div>
  );
}

// Empty state — student added, no data yet
function StudentStatsEmpty({ student }) {
  return (
    <div className="stats-preview">
      <div className="stats-preview__header">
        <Avatar name={student.name} size={56} ring={student.stream==="ЕГЭ" ? "ege" : "oge"}/>
        <div style={{flex:1, minWidth:0}}>
          <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
            <h1 style={{margin:0, fontSize:20, fontWeight:600}}>{student.name}</h1>
            <Chip variant={student.stream==="ЕГЭ" ? "ege" : "oge"}>{student.stream}</Chip>
            <StatusDot tone="neutral">{student.statusLabel}</StatusDot>
          </div>
          <div className="t-muted" style={{fontSize:13, marginTop:4}}>
            {student.grade} класс · {student.subjects.join(", ")} · добавлен {student.since}
          </div>
        </div>
      </div>

      <section className="t-section">
        <div style={{padding:"32px 24px", display:"flex", flexDirection:"column", alignItems:"center", gap:20, textAlign:"center"}}>
          <div style={{fontSize:16, fontWeight:600, color:"var(--sokrat-fg1)"}}>Статистики пока нет</div>
          <div className="t-muted" style={{fontSize:13, lineHeight:1.55, maxWidth:440}}>
            Данные появятся после первых сданных ДЗ и первого пробного экзамена. Обычно это занимает 2–3 занятия.
          </div>
          <div style={{display:"flex", flexDirection:"column", gap:10, width:"100%", maxWidth:520, marginTop:8}}>
            {[
              { icon:"calendar-plus", title:"Назначьте первое занятие", body:"Выберите время в расписании — ученик получит уведомление в Telegram." },
              { icon:"clipboard-plus", title:"Назначьте диагностическое ДЗ", body:"6–8 задач по основным темам — чтобы понять начальный уровень." },
              { icon:"target", title:"Задайте цель по ЕГЭ", body:"Балл, к которому готовим. Появится пунктиром на графике пробников." },
            ].map((step,i)=>(
              <div key={i} style={{display:"flex", alignItems:"flex-start", gap:12, padding:"12px 14px", background:"var(--sokrat-surface)", borderRadius:"var(--sokrat-radius-sm)", textAlign:"left"}}>
                <span style={{width:28, height:28, borderRadius:"50%", background:"var(--sokrat-card)", border:"1px solid var(--sokrat-border-light)", display:"grid", placeItems:"center", fontSize:12, fontWeight:600, color:"var(--sokrat-fg2)", flex:"none"}}>{i+1}</span>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:600, color:"var(--sokrat-fg1)"}}>{step.title}</div>
                  <div className="t-muted" style={{fontSize:12, lineHeight:1.5, marginTop:2}}>{step.body}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex", gap:8, marginTop:4}}>
            <Button variant="outline" size="md" icon="calendar-plus">Назначить занятие</Button>
            <Button variant="primary" size="md" icon="clipboard-plus">Назначить первое ДЗ</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Drill-down: weak-topic deep dive ───
function TopicDrillDown({ student, topic, onBack }) {
  const attempts = [
    { id:1, date:"15.04", source:"ДЗ «Законы сохранения» · задача 04", verdict:"wrong", studentAnswer:"p = 12 \\,\\text{Н·с}", correct:"p = 24 \\,\\text{Н·с}", note:"Не учтён знак скорости при отражении" },
    { id:2, date:"12.04", source:"Пробник Пр-23 · часть 2, №18",       verdict:"partial", studentAnswer:"E_k = 80 \\,\\text{Дж}", correct:"E_k = 90 \\,\\text{Дж}", note:"Арифметическая ошибка в квадрате скорости" },
    { id:3, date:"09.04", source:"ДЗ «Импульс тела» · задача 06",     verdict:"wrong", studentAnswer:"\\Delta p = mv", correct:"\\Delta p = m(v_2 - v_1)", note:"Формула для изменения импульса" },
    { id:4, date:"05.04", source:"ДЗ «Импульс тела» · задача 03",     verdict:"right", studentAnswer:"p = 6 \\,\\text{кг·м/с}", correct:"p = 6 \\,\\text{кг·м/с}", note:"" },
    { id:5, date:"02.04", source:"Пробник Пр-22 · часть 1, №12",       verdict:"wrong", studentAnswer:"A = 200 \\,\\text{Дж}", correct:"A = 150 \\,\\text{Дж}", note:"Использована формула без учёта угла" },
    { id:6, date:"29.03", source:"ДЗ «Работа и энергия» · задача 02", verdict:"right", studentAnswer:"A = 45 \\,\\text{Дж}", correct:"A = 45 \\,\\text{Дж}", note:"" },
  ];
  const rightCount = attempts.filter(a=>a.verdict==="right").length;
  const partialCount = attempts.filter(a=>a.verdict==="partial").length;
  const wrongCount = attempts.filter(a=>a.verdict==="wrong").length;

  const toneFor = v => v==="right" ? "success" : v==="partial" ? "warning" : "danger";
  const labelFor = v => v==="right" ? "верно" : v==="partial" ? "частично" : "неверно";

  return (
    <div className="stats-preview">
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:12}}>
        <Button variant="ghost" size="sm" icon="arrow-left" onClick={onBack}>К статистике</Button>
        <span className="t-muted" style={{fontSize:12}}>·</span>
        <span className="t-muted" style={{fontSize:12}}>{student.name}</span>
        <span className="t-muted" style={{fontSize:12}}>·</span>
        <span style={{fontSize:13, color:"var(--sokrat-fg1)", fontWeight:600}}>{topic.topic}</span>
      </div>

      <section className="t-section" style={{marginBottom:12}}>
        <div style={{padding:"16px 20px", display:"flex", alignItems:"center", gap:16}}>
          <div style={{flex:1, minWidth:0}}>
            <div className="t-muted" style={{fontSize:11, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4}}>Тема</div>
            <div style={{fontSize:18, fontWeight:600, color:"var(--sokrat-fg1)", marginBottom:10}}>{topic.topic}</div>
            <FormulaBlock tex={topic.formula}/>
          </div>
          <div style={{display:"flex", gap:6, flex:"none"}}>
            <Button variant="outline" size="sm" icon="book-open">Материалы</Button>
            <Button variant="primary" size="sm" icon="clipboard-plus">ДЗ на эту тему</Button>
          </div>
        </div>
      </section>

      <div className="t-stats" style={{marginBottom:12}}>
        <div className="t-stats__cell">
          <div className="t-stats__label">Точность</div>
          <div className="t-stats__value" style={{color: topic.accuracy < 60 ? "var(--sokrat-state-danger-fg)" : topic.accuracy < 75 ? "var(--sokrat-state-warning-fg)" : "var(--sokrat-fg1)"}}>{topic.accuracy}%</div>
          <div className="t-stats__meta">по {topic.attempts} попыткам</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Верно</div>
          <div className="t-stats__value">{rightCount}</div>
          <div className="t-stats__meta">из {attempts.length} разобранных</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Ошибки</div>
          <div className="t-stats__value" style={{color:"var(--sokrat-state-danger-fg)"}}>{wrongCount}</div>
          <div className="t-stats__meta">+ {partialCount} частично</div>
        </div>
        <div className="t-stats__cell">
          <div className="t-stats__label">Средняя по ученикам</div>
          <div className="t-stats__value">72%</div>
          <div className="t-stats__meta">по 11 классу ЕГЭ</div>
        </div>
      </div>

      <section className="t-section" style={{marginBottom:12}}>
        <div className="t-section__header">
          <h2>Гипотеза ошибки</h2>
          <span className="t-section__meta">AI-анализ последних 6 попыток</span>
        </div>
        <hr className="t-divider"/>
        <div style={{padding:"14px 20px", fontSize:13, lineHeight:1.65, color:"var(--sokrat-fg2)"}}>
          Ученик путает <strong style={{color:"var(--sokrat-fg1)"}}>импульс p</strong> и <strong style={{color:"var(--sokrat-fg1)"}}>изменение импульса Δp</strong>: в 3 из 6 задач применяет <InlineMath tex="p = mv"/> там, где требуется <InlineMath tex="\\Delta p = m(v_2 - v_1)"/>.
          Рекомендуется вернуться к теме <em>«Импульс и его изменение»</em> на ближайшем занятии и дать 2–3 задачи на отражение и столкновения с явным указанием векторов скоростей.
        </div>
      </section>

      <section className="t-section">
        <div className="t-section__header">
          <h2>Попытки по теме</h2>
          <span className="t-section__meta">последние {attempts.length}</span>
        </div>
        <hr className="t-divider"/>
        <div className="t-table-wrap" style={{border:0, borderRadius:0}}>
          <table className="t-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Источник</th>
                <th>Ответ ученика</th>
                <th>Правильный ответ</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map(a => (
                <tr key={a.id}>
                  <td className="t-num t-muted">{a.date}</td>
                  <td>
                    <div style={{fontSize:13, color:"var(--sokrat-fg1)"}}>{a.source}</div>
                    {a.note && <div className="t-muted" style={{fontSize:12, marginTop:2}}>{a.note}</div>}
                  </td>
                  <td><InlineMath tex={a.studentAnswer}/></td>
                  <td><InlineMath tex={a.correct}/></td>
                  <td><StatusDot tone={toneFor(a.verdict)}>{labelFor(a.verdict)}</StatusDot></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ─── Main workspace orchestrator ───
function StudentsWorkspace({ initialView = "list", initialStudentId = null, onViewChange }) {
  const [view, setView] = _useStateS(initialView);           // "list" | "split"
  const [selectedId, setSelectedId] = _useStateS(initialStudentId);
  const [drillTopic, setDrillTopic] = _useStateS(null);
  const [filters, setFilters] = _useStateS({ attention:false, stream:null });
  const [query, setQuery] = _useStateS("");

  _useEffectS(()=>{ onViewChange && onViewChange(view, selectedId); }, [view, selectedId]);

  const selected = STUDENTS_DATA.find(s => s.id === selectedId);

  const open = (id) => { setSelectedId(id); setDrillTopic(null); setView("split"); };
  const backToList = () => { setView("list"); setSelectedId(null); setDrillTopic(null); };

  if (view === "list") {
    return (
      <StudentsListView
        students={STUDENTS_DATA}
        filters={filters} setFilters={setFilters}
        query={query} setQuery={setQuery}
        onOpen={open}
      />
    );
  }

  // split view
  return (
    <>
      <div className="stats-top">
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          <Button variant="ghost" size="sm" icon="arrow-left" onClick={backToList}>Все ученики</Button>
          <span className="t-muted" style={{fontSize:12}}>·</span>
          <span style={{fontSize:13, color:"var(--sokrat-fg1)", fontWeight:600}}>
            {selected ? selected.name : "Выберите ученика"}
          </span>
        </div>
        <div style={{display:"flex", gap:8}}>
          <Button variant="outline" size="sm" icon="download">Экспорт CSV</Button>
          <Button variant="primary" size="sm" icon="user-plus">Добавить ученика</Button>
        </div>
      </div>
      <div className="stats-split">
        <RosterPane
          students={STUDENTS_DATA}
          selectedId={selectedId}
          onSelect={id => { setSelectedId(id); setDrillTopic(null); }}
          filters={filters} setFilters={setFilters}
          query={query} setQuery={setQuery}
        />
        <div className="stats-preview-wrap">
          {drillTopic
            ? <TopicDrillDown student={selected} topic={drillTopic} onBack={()=>setDrillTopic(null)}/>
            : <StudentStatsPreview student={selected} onOpenDrill={setDrillTopic}/>}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { StudentsWorkspace, STUDENTS_DATA });
