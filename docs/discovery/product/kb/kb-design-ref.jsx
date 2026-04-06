import { useState } from "react";

// ═══════════════════════════════════════════════════
// SOCRAT KNOWLEDGE BASE MVP — Design Mockup v2
// Dual architecture: Каталог Сократа + Моя база (папки)
// ═══════════════════════════════════════════════════

const COLORS = {
  bg: "#F7F6F3", card: "#FFFFFF", cardHover: "#FAFAF8",
  primary: "#1B6B4A", primaryLight: "#E8F5EE", primaryDark: "#145236",
  accent: "#E8913A", accentLight: "#FFF3E6",
  text: "#1A1A1A", textSecondary: "#6B7280", textMuted: "#9CA3AF",
  border: "#E5E5E0", borderLight: "#F0EFEB",
  ege: "#1B6B4A", egeBg: "#E8F5EE", oge: "#5B5FC7", ogeBg: "#EEEFFE",
  my: "#E8913A", myBg: "#FFF3E6",
  danger: "#DC2626", success: "#059669", overlay: "rgba(0,0,0,0.4)",
  folder: "#5B5FC7", folderBg: "#EEEFFE",
};
const FONTS = {
  display: "'Georgia', 'Times New Roman', serif",
  body: "'Segoe UI', -apple-system, system-ui, sans-serif",
  mono: "'SF Mono', 'Fira Code', monospace",
};

const Badge = ({ children, color = COLORS.primary, bg = COLORS.primaryLight, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color, backgroundColor: bg, fontFamily: FONTS.body, ...style }}>{children}</span>
);

const Icon = ({ d, size = 18, color = COLORS.textSecondary, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...style }}><path d={d} /></svg>
);

const icons = {
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  book: "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 014 17V5a2 2 0 012-2h14v14H6.5",
  plus: "M12 5v14M5 12h14",
  check: "M20 6L9 17l-5-5",
  copy: "M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2v-2M16 4h2a2 2 0 012 2v2M8 4a2 2 0 012-2h4a2 2 0 012 2v0",
  sparkle: "M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z",
  chevron: "M9 18l6-6-6-6",
  close: "M18 6L6 18M6 6l12 12",
  folder: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z",
  folderPlus: "M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2zM12 11v6M9 14h6",
  file: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z",
  link: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71",
  image: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14",
  dots: "M12 5v.01M12 12v.01M12 19v.01",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7",
  trash: "M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6",
  arrow: "M19 12H5M12 19l-7-7 7-7",
  clock: "M12 6v6l4 2M22 12A10 10 0 1112 2a10 10 0 0110 10z",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
};

// ─── Data ───
const PHYSICS_TOPICS = [
  // ЕГЭ
  { id: 1, name: "Кинематика", section: "Механика", exam: "ЕГЭ", tasks: 42, materials: 6, subtopics: ["Равномерное движение", "Равноускоренное движение", "Движение по окружности", "Свободное падение"], lines: [1, 2, 26] },
  { id: 2, name: "Динамика", section: "Механика", exam: "ЕГЭ", tasks: 38, materials: 4, subtopics: ["Законы Ньютона", "Силы в природе", "Движение по наклонной"], lines: [2, 3, 26] },
  { id: 3, name: "Законы сохранения", section: "Механика", exam: "ЕГЭ", tasks: 31, materials: 5, subtopics: ["Импульс", "Энергия", "Работа и мощность"], lines: [3, 4, 27] },
  { id: 4, name: "Молекулярная физика", section: "МКТ и термодинамика", exam: "ЕГЭ", tasks: 35, materials: 3, subtopics: ["Основы МКТ", "Газовые законы", "Влажность"], lines: [7, 8, 9] },
  { id: 5, name: "Термодинамика", section: "МКТ и термодинамика", exam: "ЕГЭ", tasks: 28, materials: 4, subtopics: ["Первое начало", "Тепловые машины"], lines: [8, 9, 24] },
  { id: 6, name: "Электростатика", section: "Электродинамика", exam: "ЕГЭ", tasks: 33, materials: 3, subtopics: ["Закон Кулона", "Электрическое поле"], lines: [10, 11, 25] },
  { id: 7, name: "Постоянный ток", section: "Электродинамика", exam: "ЕГЭ", tasks: 29, materials: 5, subtopics: ["Закон Ома", "Цепи с резисторами"], lines: [11, 12, 25] },
  { id: 8, name: "Оптика", section: "Оптика", exam: "ЕГЭ", tasks: 22, materials: 3, subtopics: ["Геометрическая оптика", "Волновая оптика"], lines: [14, 15, 25] },
  // ОГЭ (своя нумерация КИМ)
  { id: 101, name: "Кинематика", section: "Механика", exam: "ОГЭ", tasks: 28, materials: 4, subtopics: ["Равномерное движение", "Равноускоренное движение", "Свободное падение"], lines: [1, 2] },
  { id: 102, name: "Динамика", section: "Механика", exam: "ОГЭ", tasks: 25, materials: 3, subtopics: ["Законы Ньютона", "Силы в природе"], lines: [3, 4] },
  { id: 103, name: "Законы сохранения", section: "Механика", exam: "ОГЭ", tasks: 18, materials: 3, subtopics: ["Импульс", "Энергия"], lines: [4, 5] },
  { id: 104, name: "Тепловые явления", section: "Тепловая физика", exam: "ОГЭ", tasks: 22, materials: 3, subtopics: ["Теплообмен", "Фазовые переходы", "Тепловые машины"], lines: [7, 8, 9] },
  { id: 105, name: "Электрические явления", section: "Электродинамика", exam: "ОГЭ", tasks: 30, materials: 4, subtopics: ["Закон Ома", "Цепи", "Работа и мощность тока"], lines: [10, 11, 12] },
  { id: 106, name: "Оптика", section: "Оптика", exam: "ОГЭ", tasks: 15, materials: 2, subtopics: ["Отражение", "Преломление", "Линзы"], lines: [13, 14] },
];

const CATALOG_TASKS = [
  { id: "t1", source: "socrat", topic: "Кинематика", subtopic: "Равноускоренное движение", line: 1, text: "Автомобиль начинает движение из состояния покоя и разгоняется с ускорением 2 м/с². Определите скорость автомобиля через 5 секунд после начала движения.", answer: "10 м/с", hasImage: false },
  { id: "t2", source: "socrat", topic: "Кинематика", subtopic: "Свободное падение", line: 2, text: "Камень бросили вертикально вверх с начальной скоростью 20 м/с. На какой высоте скорость камня будет равна 10 м/с? g = 10 м/с².", answer: "15 м", hasImage: false },
  { id: "t3", source: "socrat", topic: "Кинематика", subtopic: "Движение по окружности", line: 1, text: "Точка движется по окружности радиусом 4 м с постоянной скоростью. Период обращения 2 с. Определите центростремительное ускорение.", answer: "≈ 39.5 м/с²", hasImage: true },
  { id: "t4", source: "socrat", topic: "Кинематика", subtopic: "Равномерное движение", line: 2, text: "Два поезда движутся навстречу друг другу со скоростями 72 км/ч и 108 км/ч. Пассажир первого поезда замечает, что второй поезд проходит мимо него за 6 с. Какова длина второго поезда?", answer: "300 м", hasImage: false },
];

const SAMPLE_MATERIALS = [
  { id: "m1", type: "file", name: "Формулы кинематики.pdf", format: "PDF" },
  { id: "m2", type: "link", name: "Видеоразбор задачи №1 ЕГЭ 2025", format: "YouTube" },
  { id: "m3", type: "file", name: "Опорный конспект — равноускоренное движение", format: "JPG" },
  { id: "m4", type: "link", name: "Интерактивная модель — свободное падение", format: "PhET" },
];

const INITIAL_FOLDERS = [
  { id: "f1", name: "Физика 10кл", parentId: null, children: [
    { id: "f1a", name: "Кинематика", parentId: "f1", children: [
      { id: "f1a1", name: "Графики v(t)", parentId: "f1a", children: [], tasks: [
        { id: "mt1", source: "my", subtopic: "Графики v(t)", text: "По графику зависимости скорости от времени определите ускорение тела на участке AB.", answer: "2 м/с²", hasImage: true },
      ]},
      { id: "f1a2", name: "Свободное падение", parentId: "f1a", children: [], tasks: [] },
    ], tasks: [
      { id: "mt2", source: "my", subtopic: "Кинематика", text: "Тело брошено горизонтально с высоты 80 м. Начальная скорость 15 м/с. Определите дальность полёта. g = 10 м/с².", answer: "60 м", hasImage: false },
    ]},
    { id: "f1b", name: "Динамика", parentId: "f1", children: [], tasks: [] },
  ], tasks: [] },
  { id: "f2", name: "Физика ЕГЭ", parentId: null, children: [], tasks: [
    { id: "mt3", source: "my", subtopic: "ЕГЭ сборник", text: "Шарик массой 0.1 кг подвешен на нити длиной 1 м. Определите минимальную скорость в нижней точке, чтобы шарик описал полную окружность.", answer: "≈ 7 м/с", hasImage: false },
  ]},
  { id: "f3", name: "Математика 8кл", parentId: null, children: [
    { id: "f3a", name: "Алгебра", parentId: "f3", children: [], tasks: [] },
    { id: "f3b", name: "Геометрия", parentId: "f3", children: [], tasks: [] },
  ], tasks: [] },
  { id: "f4", name: "Олимпиады", parentId: null, children: [], tasks: [] },
];

// ═══════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════
export default function SocratKB() {
  const [mainTab, setMainTab] = useState("catalog");
  const [screen, setScreen] = useState("home");
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [folderPath, setFolderPath] = useState([]);
  const [currentFolderData, setCurrentFolderData] = useState(null);
  const [hwDrawerOpen, setHwDrawerOpen] = useState(false);
  const [hwTasks, setHwTasks] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [examFilter, setExamFilter] = useState("ЕГЭ");
  const [taskExpanded, setTaskExpanded] = useState(null);
  const [notification, setNotification] = useState(null);
  const [copyModal, setCopyModal] = useState(null);
  const [folders, setFolders] = useState(INITIAL_FOLDERS);

  const showNotification = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 2200); };

  const addToHW = (task) => {
    if (!hwTasks.find(t => t.taskId === task.id)) {
      setHwTasks([...hwTasks, { taskId: task.id, textSnapshot: task.text, answerSnapshot: task.answer, snapshotEdited: false, source: task.source, subtopic: task.subtopic }]);
      showNotification("Задача добавлена в ДЗ");
    }
  };
  const removeFromHW = (taskId) => setHwTasks(hwTasks.filter(t => t.taskId !== taskId));
  const updateSnapshot = (taskId, field, value) => setHwTasks(hwTasks.map(t => t.taskId === taskId ? { ...t, [field]: value, snapshotEdited: true } : t));

  const openTopic = (topic) => { setSelectedTopic(topic); setScreen("topic"); };
  const goHome = () => { setScreen("home"); setSelectedTopic(null); setFolderPath([]); setCurrentFolderData(null); setSearchQuery(""); };

  const openFolder = (folder, path) => { setCurrentFolderData(folder); setFolderPath(path); setScreen("folder"); };

  const navigateBreadcrumb = (index) => {
    if (index === -1) { goHome(); return; }
    const newPath = folderPath.slice(0, index + 1);
    let node = folders.find(f => f.id === newPath[0].id);
    for (let i = 1; i < newPath.length; i++) node = node.children.find(f => f.id === newPath[i].id);
    setFolderPath(newPath); setCurrentFolderData(node);
  };

  const copyTaskToFolder = (task, targetFolderId) => {
    const newTask = { ...task, id: "mt_" + Date.now(), source: "my" };
    const addToFolder = (items) => items.map(f => {
      if (f.id === targetFolderId) return { ...f, tasks: [...(f.tasks || []), newTask] };
      if (f.children?.length) return { ...f, children: addToFolder(f.children) };
      return f;
    });
    setFolders(addToFolder(folders)); setCopyModal(null); showNotification("Скопировано в папку");
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: COLORS.bg, fontFamily: FONTS.body, color: COLORS.text, position: "relative" }}>
      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, backgroundColor: "rgba(247,246,243,0.92)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${COLORS.border}`, padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {screen !== "home" && <button onClick={goHome} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4 }}><Icon d={icons.arrow} color={COLORS.primary} size={20} /></button>}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: COLORS.primary, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 14, fontFamily: FONTS.display }}>С</div>
            <span style={{ fontFamily: FONTS.display, fontWeight: 600, fontSize: 17, letterSpacing: -0.3 }}>База знаний</span>
          </div>
        </div>
        <button onClick={() => setHwDrawerOpen(true)} style={{ background: hwTasks.length > 0 ? COLORS.primaryLight : "none", border: hwTasks.length > 0 ? `1px solid ${COLORS.primary}33` : `1px solid ${COLORS.border}`, borderRadius: 10, padding: "6px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon d={icons.book} size={16} color={hwTasks.length > 0 ? COLORS.primary : COLORS.textSecondary} />
          <span style={{ fontSize: 13, fontWeight: 600, color: hwTasks.length > 0 ? COLORS.primary : COLORS.textSecondary }}>ДЗ{hwTasks.length > 0 && ` · ${hwTasks.length}`}</span>
        </button>
      </nav>

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px 100px" }}>
        {screen === "home" && (
          <>
            {/* TABS */}
            <div style={{ display: "flex", gap: 4, marginBottom: 24, backgroundColor: COLORS.borderLight, borderRadius: 12, padding: 4 }}>
              {[{ key: "catalog", label: "Каталог Сократа", icon: icons.grid }, { key: "mybase", label: "Моя база", icon: icons.folder }].map(tab => (
                <button key={tab.key} onClick={() => { setMainTab(tab.key); setSearchQuery(""); }} style={{ flex: 1, padding: "10px 16px", borderRadius: 10, border: "none", backgroundColor: mainTab === tab.key ? COLORS.card : "transparent", boxShadow: mainTab === tab.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 14, fontWeight: mainTab === tab.key ? 600 : 500, color: mainTab === tab.key ? COLORS.text : COLORS.textSecondary, fontFamily: FONTS.body, transition: "all 0.2s" }}>
                  <Icon d={tab.icon} size={16} color={mainTab === tab.key ? COLORS.primary : COLORS.textMuted} />{tab.label}
                </button>
              ))}
            </div>
            {mainTab === "catalog" && <CatalogHome searchQuery={searchQuery} setSearchQuery={setSearchQuery} examFilter={examFilter} setExamFilter={setExamFilter} topics={PHYSICS_TOPICS} onOpenTopic={openTopic} />}
            {mainTab === "mybase" && <MyBaseHome folders={folders} onOpenFolder={(f) => openFolder(f, [{ id: f.id, name: f.name }])} showNotification={showNotification} />}
          </>
        )}
        {screen === "topic" && selectedTopic && <CatalogTopicScreen topic={selectedTopic} tasks={CATALOG_TASKS} materials={SAMPLE_MATERIALS} taskExpanded={taskExpanded} setTaskExpanded={setTaskExpanded} hwTasks={hwTasks} onAddToHW={addToHW} onCopyToFolder={(task) => setCopyModal(task)} showNotification={showNotification} />}
        {screen === "folder" && currentFolderData && <FolderScreen folder={currentFolderData} path={folderPath} onNavigateBreadcrumb={navigateBreadcrumb} onOpenSubfolder={(sub) => openFolder(sub, [...folderPath, { id: sub.id, name: sub.name }])} onAddToHW={addToHW} hwTasks={hwTasks} taskExpanded={taskExpanded} setTaskExpanded={setTaskExpanded} showNotification={showNotification} />}
      </main>

      {copyModal && <CopyToFolderModal task={copyModal} folders={folders} onCopy={copyTaskToFolder} onClose={() => setCopyModal(null)} />}
      {hwDrawerOpen && <HWDrawer tasks={hwTasks} onClose={() => setHwDrawerOpen(false)} onRemove={removeFromHW} onUpdateSnapshot={updateSnapshot} onAddMore={() => setHwDrawerOpen(false)} showNotification={showNotification} />}
      {notification && <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", backgroundColor: COLORS.primaryDark, color: "#fff", padding: "10px 24px", borderRadius: 12, fontSize: 13, fontWeight: 500, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", zIndex: 1000, animation: "slideUp 0.3s ease", display: "flex", alignItems: "center", gap: 8 }}><Icon d={icons.check} size={16} color="#fff" />{notification}</div>}

      <style>{`
        @keyframes slideUp { from { opacity:0; transform:translateX(-50%) translateY(12px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes slideIn { from { transform:translateX(100%); } to { transform:translateX(0); } }
        * { box-sizing: border-box; } button:hover { filter: brightness(0.97); } input:focus,textarea:focus { outline: none; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #d1d1c7; border-radius: 3px; }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// CATALOG HOME (tab 1)
// ═══════════════════════════════════════════════════
function CatalogHome({ searchQuery, setSearchQuery, examFilter, setExamFilter, topics, onOpenTopic }) {
  const filtered = topics.filter(t => {
    const matchExam = t.exam === examFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch = !searchQuery || t.name.toLowerCase().includes(q) || t.section.toLowerCase().includes(q) || t.subtopics.some(s => s.toLowerCase().includes(q)) || CATALOG_TASKS.some(task => task.topic === t.name && task.text.toLowerCase().includes(q));
    return matchExam && matchSearch;
  });
  const sections = [...new Set(filtered.map(t => t.section))];
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: FONTS.display, fontSize: 24, fontWeight: 700, marginBottom: 4, letterSpacing: -0.3 }}>Каталог задач</h1>
        <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>Общая база · Копируйте нужные задачи к себе</p>
      </div>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Icon d={icons.search} size={18} color={COLORS.textMuted} style={{ position: "absolute", left: 14, top: 12 }} />
        <input type="text" placeholder="Поиск по темам, подтемам и задачам..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: "100%", padding: "10px 16px 10px 42px", border: `1.5px solid ${COLORS.border}`, borderRadius: 12, fontSize: 14, fontFamily: FONTS.body, backgroundColor: COLORS.card }} onFocus={(e) => e.target.style.borderColor = COLORS.primary} onBlur={(e) => e.target.style.borderColor = COLORS.border} />
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 24, backgroundColor: COLORS.borderLight, borderRadius: 12, padding: 4 }}>
        {[{ key: "ЕГЭ", label: "ЕГЭ Физика", color: COLORS.ege, bg: COLORS.egeBg }, { key: "ОГЭ", label: "ОГЭ Физика", color: COLORS.oge, bg: COLORS.ogeBg }].map(ex => (
          <button key={ex.key} onClick={() => setExamFilter(ex.key)} style={{ flex: 1, padding: "10px 18px", borderRadius: 10, fontSize: 14, fontWeight: examFilter === ex.key ? 600 : 500, border: "none", backgroundColor: examFilter === ex.key ? COLORS.card : "transparent", boxShadow: examFilter === ex.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none", color: examFilter === ex.key ? ex.color : COLORS.textSecondary, cursor: "pointer", fontFamily: FONTS.body, transition: "all 0.2s" }}>{ex.label}</button>
        ))}
      </div>
      {sections.map(section => (
        <div key={section} style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>{section}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.filter(t => t.section === section).map(topic => (
              <TopicCard key={topic.id} topic={topic} onOpen={() => onOpenTopic(topic)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TopicCard({ topic, onOpen }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={onOpen} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ backgroundColor: h ? COLORS.cardHover : COLORS.card, border: `1px solid ${h ? COLORS.primary + "33" : COLORS.border}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", transition: "all 0.2s", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{topic.name}</span>
          <Badge color={topic.exam === "ОГЭ" ? COLORS.oge : COLORS.ege} bg={topic.exam === "ОГЭ" ? COLORS.ogeBg : COLORS.egeBg}>{topic.exam}</Badge>
        </div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{topic.tasks} задач · {topic.materials} мат. · КИМ № {topic.lines.join(", ")}</div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 3 }}>{topic.subtopics.join(" · ")}</div>
      </div>
      <Icon d={icons.chevron} size={18} color={h ? COLORS.primary : COLORS.textMuted} />
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MY BASE HOME (tab 2) — folders
// ═══════════════════════════════════════════════════
function MyBaseHome({ folders, onOpenFolder, showNotification }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: FONTS.display, fontSize: 24, fontWeight: 700, marginBottom: 4, letterSpacing: -0.3 }}>Моя база</h1>
          <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>Ваши папки, задачи и материалы</p>
        </div>
        <button onClick={() => showNotification("Создание папки...")} style={{ padding: "8px 16px", borderRadius: 10, border: `1.5px solid ${COLORS.primary}33`, backgroundColor: COLORS.primaryLight, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: COLORS.primary, fontFamily: FONTS.body }}>
          <Icon d={icons.folderPlus} size={16} color={COLORS.primary} />Новая папка
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {folders.map(f => <FolderCard key={f.id} folder={f} onClick={() => onOpenFolder(f)} />)}
      </div>
      <button style={{ width: "100%", padding: "14px", marginTop: 12, border: `1.5px dashed ${COLORS.border}`, borderRadius: 12, backgroundColor: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, fontFamily: FONTS.body }}>
        <Icon d={icons.plus} size={16} color="currentColor" />Добавить задачу
      </button>
    </div>
  );
}

function FolderCard({ folder, onClick }) {
  const [h, setH] = useState(false);
  const subCount = folder.children?.length || 0;
  const countTasks = (f) => (f.tasks?.length || 0) + (f.children || []).reduce((s, c) => s + countTasks(c), 0);
  const totalTasks = countTasks(folder);
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ backgroundColor: h ? COLORS.cardHover : COLORS.card, border: `1px solid ${h ? COLORS.folder + "44" : COLORS.border}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.folderBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon d={icons.folder} size={20} color={COLORS.folder} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{folder.name}</div>
        <div style={{ fontSize: 12, color: COLORS.textSecondary }}>{subCount > 0 && `${subCount} папок · `}{totalTasks} задач</div>
      </div>
      <Icon d={icons.chevron} size={18} color={h ? COLORS.folder : COLORS.textMuted} />
    </div>
  );
}

// ═══════════════════════════════════════════════════
// FOLDER SCREEN — breadcrumbs + subfolders + tasks
// ═══════════════════════════════════════════════════
function FolderScreen({ folder, path, onNavigateBreadcrumb, onOpenSubfolder, onAddToHW, hwTasks, taskExpanded, setTaskExpanded, showNotification }) {
  return (
    <div>
      {/* Breadcrumbs */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => onNavigateBreadcrumb(-1)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: COLORS.primary, fontWeight: 500, padding: "2px 4px", fontFamily: FONTS.body }}>Моя база</button>
        {path.map((p, i) => (
          <span key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: COLORS.textMuted, fontSize: 12 }}>/</span>
            <button onClick={() => onNavigateBreadcrumb(i)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: i === path.length - 1 ? COLORS.text : COLORS.primary, fontWeight: i === path.length - 1 ? 600 : 500, padding: "2px 4px", fontFamily: FONTS.body }}>{p.name}</button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, margin: 0 }}>{folder.name}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => showNotification("Создание подпапки...")} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${COLORS.border}`, backgroundColor: "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, color: COLORS.textSecondary, fontFamily: FONTS.body }}><Icon d={icons.folderPlus} size={14} color={COLORS.textSecondary} />Подпапка</button>
          <button onClick={() => showNotification("Создание задачи...")} style={{ padding: "6px 14px", borderRadius: 8, border: "none", backgroundColor: COLORS.primary, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#fff", fontFamily: FONTS.body }}><Icon d={icons.plus} size={14} color="#fff" />Задача</button>
        </div>
      </div>
      {folder.children?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Папки</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {folder.children.map(sub => <FolderCard key={sub.id} folder={sub} onClick={() => onOpenSubfolder(sub)} />)}
          </div>
        </div>
      )}
      {folder.tasks?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Задачи</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {folder.tasks.map(task => <TaskCard key={task.id} task={task} isExpanded={taskExpanded === task.id} onToggle={() => setTaskExpanded(taskExpanded === task.id ? null : task.id)} inHW={hwTasks.some(t => t.taskId === task.id)} onAddToHW={() => onAddToHW(task)} isOwn={true} showNotification={showNotification} />)}
          </div>
        </div>
      )}
      {(!folder.children?.length && !folder.tasks?.length) && (
        <div style={{ textAlign: "center", padding: "48px 20px", color: COLORS.textMuted }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Папка пуста</div>
          <div style={{ fontSize: 13 }}>Добавьте подпапки или скопируйте задачи из Каталога</div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// CATALOG TOPIC SCREEN (read-only + copy)
// ═══════════════════════════════════════════════════
function CatalogTopicScreen({ topic, tasks, materials, taskExpanded, setTaskExpanded, hwTasks, onAddToHW, onCopyToFolder, showNotification }) {
  return (
    <div>
      <div style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: "20px 22px", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <h1 style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, margin: 0 }}>{topic.name}</h1>
              <Badge color={COLORS.ege} bg={COLORS.egeBg}>{topic.exam}</Badge>
              <Badge color={COLORS.textSecondary} bg={COLORS.borderLight} style={{ fontSize: 10 }}>Каталог</Badge>
            </div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 10 }}>{topic.section} · КИМ № {topic.lines.join(", ")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {topic.subtopics.map(s => <span key={s} style={{ padding: "3px 10px", borderRadius: 8, backgroundColor: COLORS.borderLight, fontSize: 12, color: COLORS.textSecondary, fontWeight: 500 }}>{s}</span>)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, textAlign: "center" }}>
            <div><div style={{ fontSize: 22, fontWeight: 700, color: COLORS.primary }}>{topic.tasks}</div><div style={{ fontSize: 11, color: COLORS.textSecondary }}>задач</div></div>
          </div>
        </div>
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Задачи</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        {tasks.map(task => <TaskCard key={task.id} task={task} isExpanded={taskExpanded === task.id} onToggle={() => setTaskExpanded(taskExpanded === task.id ? null : task.id)} inHW={hwTasks.some(t => t.taskId === task.id)} onAddToHW={() => onAddToHW(task)} isOwn={false} onCopyToFolder={() => onCopyToFolder(task)} showNotification={showNotification} />)}
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Материалы</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {materials.map(m => <MaterialCard key={m.id} material={m} />)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TASK CARD — unified
// ═══════════════════════════════════════════════════
function TaskCard({ task, isExpanded, onToggle, inHW, onAddToHW, isOwn, onCopyToFolder, showNotification }) {
  return (
    <div style={{ backgroundColor: COLORS.card, border: `1px solid ${inHW ? COLORS.primary + "44" : COLORS.border}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }} onClick={onToggle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Badge color={isOwn ? COLORS.my : COLORS.primary} bg={isOwn ? COLORS.myBg : COLORS.primaryLight}>{isOwn ? "Моя" : "Каталог"}</Badge>
            <span style={{ fontSize: 11, color: COLORS.textMuted }}>{task.subtopic}</span>
            {task.line && <span style={{ fontSize: 11, color: COLORS.textMuted }}>· КИМ № {task.line}</span>}
            {task.hasImage && <Icon d={icons.image} size={12} color={COLORS.textMuted} />}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, overflow: isExpanded ? "visible" : "hidden", display: isExpanded ? "block" : "-webkit-box", WebkitLineClamp: isExpanded ? "unset" : 2, WebkitBoxOrient: "vertical" }}>{task.text}</p>
          {isExpanded && task.answer && (
            <div style={{ marginTop: 10, padding: "8px 12px", backgroundColor: COLORS.bg, borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 2 }}>Ответ:</div>
              <div style={{ fontSize: 14, fontWeight: 600, fontFamily: FONTS.mono, color: COLORS.primary }}>{task.answer}</div>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {!isOwn && onCopyToFolder && (
            <button onClick={onCopyToFolder} style={{ padding: "6px 12px", borderRadius: 8, backgroundColor: COLORS.folderBg, color: COLORS.folder, border: `1px solid ${COLORS.folder}33`, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONTS.body, display: "flex", alignItems: "center", gap: 4 }}>
              <Icon d={icons.download} size={13} color={COLORS.folder} />К себе
            </button>
          )}
          <button onClick={onAddToHW} disabled={inHW} style={{ padding: "6px 12px", borderRadius: 8, backgroundColor: inHW ? COLORS.primaryLight : COLORS.primary, color: inHW ? COLORS.primary : "#fff", border: "none", fontSize: 12, fontWeight: 600, cursor: inHW ? "default" : "pointer", fontFamily: FONTS.body, display: "flex", alignItems: "center", gap: 4, opacity: inHW ? 0.7 : 1 }}>
            {inHW ? <><Icon d={icons.check} size={13} color={COLORS.primary} />В ДЗ</> : "В ДЗ"}
          </button>
          {isOwn && <button onClick={() => showNotification("Меню...")} style={{ padding: 6, borderRadius: 8, backgroundColor: "transparent", border: `1px solid ${COLORS.border}`, cursor: "pointer", display: "flex" }}><Icon d={icons.dots} size={14} color={COLORS.textSecondary} /></button>}
        </div>
      </div>
    </div>
  );
}

function MaterialCard({ material }) {
  const tc = { file: COLORS.primary, link: COLORS.oge, media: COLORS.accent };
  const ti = { file: icons.file, link: icons.link, media: icons.image };
  return (
    <div style={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: (tc[material.type] || COLORS.primary) + "15", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon d={ti[material.type] || icons.file} size={18} color={tc[material.type] || COLORS.primary} /></div>
      <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{material.name}</div><div style={{ fontSize: 11, color: COLORS.textMuted }}>{material.format}</div></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// COPY TO FOLDER MODAL
// ═══════════════════════════════════════════════════
function CopyToFolderModal({ task, folders, onCopy, onClose }) {
  const [selected, setSelected] = useState(null);
  const renderFolders = (items, depth = 0) => items.map(f => (
    <div key={f.id}>
      <button onClick={() => setSelected(f.id)} style={{ width: "100%", padding: "10px 14px", paddingLeft: 14 + depth * 20, display: "flex", alignItems: "center", gap: 10, border: "none", backgroundColor: selected === f.id ? COLORS.primaryLight : "transparent", cursor: "pointer", fontSize: 13, color: COLORS.text, fontFamily: FONTS.body, textAlign: "left", borderRadius: 8 }}>
        <Icon d={icons.folder} size={16} color={selected === f.id ? COLORS.primary : COLORS.folder} />
        <span style={{ fontWeight: selected === f.id ? 600 : 400 }}>{f.name}</span>
      </button>
      {f.children?.length > 0 && renderFolders(f.children, depth + 1)}
    </div>
  ));
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: COLORS.overlay, zIndex: 300, animation: "fadeIn 0.15s ease" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 380, maxHeight: "70vh", backgroundColor: COLORS.card, borderRadius: 16, boxShadow: "0 16px 48px rgba(0,0,0,0.18)", zIndex: 301, display: "flex", flexDirection: "column", animation: "fadeIn 0.2s ease" }}>
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Копировать в папку</h3>
          <p style={{ fontSize: 12, color: COLORS.textSecondary, margin: "4px 0 0", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{task.text}</p>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 6px" }}>{renderFolders(folders)}</div>
        <div style={{ padding: "14px 20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${COLORS.border}`, backgroundColor: "transparent", fontSize: 13, color: COLORS.textSecondary, cursor: "pointer", fontFamily: FONTS.body }}>Отмена</button>
          <button onClick={() => selected && onCopy(task, selected)} disabled={!selected} style={{ padding: "8px 18px", borderRadius: 8, border: "none", backgroundColor: selected ? COLORS.primary : COLORS.border, fontSize: 13, fontWeight: 600, color: "#fff", cursor: selected ? "pointer" : "default", fontFamily: FONTS.body }}>Скопировать</button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════
// HW DRAWER with snapshot editing
// ═══════════════════════════════════════════════════
function HWDrawer({ tasks, onClose, onRemove, onUpdateSnapshot, onAddMore, showNotification }) {
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const startEdit = (t) => { setEditingId(t.taskId); setEditText(t.textSnapshot); setEditAnswer(t.answerSnapshot || ""); };
  const saveEdit = (id) => { onUpdateSnapshot(id, "textSnapshot", editText); if (editAnswer) onUpdateSnapshot(id, "answerSnapshot", editAnswer); setEditingId(null); showNotification("Условие обновлено"); };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: COLORS.overlay, zIndex: 200, animation: "fadeIn 0.2s ease" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, maxWidth: "90vw", backgroundColor: COLORS.bg, zIndex: 201, boxShadow: "-8px 0 32px rgba(0,0,0,0.12)", animation: "slideIn 0.3s ease", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Домашнее задание</h2><p style={{ fontSize: 12, color: COLORS.textSecondary, margin: "2px 0 0" }}>{tasks.length} {tasks.length === 1 ? "задача" : tasks.length < 5 ? "задачи" : "задач"}</p></div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon d={icons.close} size={20} color={COLORS.textSecondary} /></button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {tasks.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", color: COLORS.textMuted }}><div style={{ fontSize: 40, marginBottom: 12 }}>📋</div><div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Пока пусто</div><div style={{ fontSize: 13 }}>Добавьте задачи из Каталога или Моей базы</div></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tasks.map((t, i) => (
                <div key={t.taskId} style={{ backgroundColor: COLORS.card, border: `1px solid ${editingId === t.taskId ? COLORS.primary + "55" : COLORS.border}`, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: COLORS.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: COLORS.primary, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <Badge color={t.source === "my" ? COLORS.my : COLORS.primary} bg={t.source === "my" ? COLORS.myBg : COLORS.primaryLight} style={{ fontSize: 10 }}>{t.source === "my" ? "Моя" : "Каталог"}</Badge>
                        <span style={{ fontSize: 11, color: COLORS.textMuted }}>{t.subtopic}</span>
                        {t.snapshotEdited && <Badge color={COLORS.accent} bg={COLORS.accentLight} style={{ fontSize: 9, padding: "1px 6px" }}>изменено</Badge>}
                      </div>
                      {editingId !== t.taskId ? (
                        <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.textSnapshot}</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                          <div><label style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 3, display: "block" }}>Условие</label><textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} style={{ width: "100%", padding: "8px 10px", fontSize: 12, border: `1.5px solid ${COLORS.primary}44`, borderRadius: 8, resize: "vertical", fontFamily: FONTS.body, lineHeight: 1.5 }} /></div>
                          <div><label style={{ fontSize: 11, color: COLORS.textSecondary, marginBottom: 3, display: "block" }}>Ответ</label><input value={editAnswer} onChange={(e) => setEditAnswer(e.target.value)} style={{ width: "100%", padding: "6px 10px", fontSize: 12, border: `1.5px solid ${COLORS.border}`, borderRadius: 8, fontFamily: FONTS.mono }} /></div>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button onClick={() => setEditingId(null)} style={{ padding: "5px 14px", borderRadius: 6, border: `1px solid ${COLORS.border}`, backgroundColor: "transparent", fontSize: 12, color: COLORS.textSecondary, cursor: "pointer", fontFamily: FONTS.body }}>Отмена</button>
                            <button onClick={() => saveEdit(t.taskId)} style={{ padding: "5px 14px", borderRadius: 6, border: "none", backgroundColor: COLORS.primary, fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer", fontFamily: FONTS.body }}>Сохранить</button>
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {editingId !== t.taskId && <button onClick={() => startEdit(t)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon d={icons.edit} size={13} color={COLORS.textMuted} /></button>}
                      <button onClick={() => onRemove(t.taskId)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Icon d={icons.close} size={14} color={COLORS.textMuted} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: "16px 20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={onAddMore} style={{ width: "100%", padding: "12px", border: `1.5px dashed ${COLORS.primary}44`, borderRadius: 10, backgroundColor: COLORS.primaryLight + "66", cursor: "pointer", fontSize: 13, fontWeight: 500, color: COLORS.primary, fontFamily: FONTS.body, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon d={icons.plus} size={15} color={COLORS.primary} />Добавить из Базы знаний</button>
          <button onClick={() => showNotification("ДЗ отправлено!")} style={{ width: "100%", padding: "12px", border: "none", borderRadius: 10, backgroundColor: tasks.length > 0 ? COLORS.primary : COLORS.border, cursor: tasks.length > 0 ? "pointer" : "default", fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: FONTS.body }}>Отправить ДЗ</button>
        </div>
      </div>
    </>
  );
}