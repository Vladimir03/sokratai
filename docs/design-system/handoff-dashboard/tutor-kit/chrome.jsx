/* global React */
// Tutor kit — chrome (AppFrame, SideNav, TopBar, PageHeader, Toolbar, BulkActionBar)

const { useState: _useState } = React;

function AppFrame({ side, top, children }) {
  return (
    <div className="t-app">
      <aside className="t-app__rail">{side}</aside>
      <header className="t-app__top">{top}</header>
      <main className="t-app__main">{children}</main>
    </div>
  );
}

function SideNav({ active, onNavigate }) {
  const groups = [
    { label: "Работа", items: [
      { id: "dashboard", icon: "layout-dashboard", label: "Главная" },
      { id: "schedule", icon: "calendar", label: "Расписание" },
      { id: "homework", icon: "clipboard-list", label: "Домашние задания", count: 12 },
    ]},
    { label: "Ученики", items: [
      { id: "students", icon: "users", label: "Все ученики", count: 28 },
      { id: "groups", icon: "users-round", label: "Группы", count: 3 },
    ]},
    { label: "Материалы", items: [
      { id: "taskbank", icon: "library", label: "База задач" },
      { id: "mytasks", icon: "folder", label: "Мои задачи" },
    ]},
    { label: "Финансы", items: [
      { id: "payments", icon: "wallet", label: "Платежи" },
      { id: "plans", icon: "credit-card", label: "Тарифы" },
    ]},
  ];
  return (
    <nav className="t-nav" aria-label="Разделы">
      <div className="t-nav__brand">
        <span className="t-nav__brand-mark">С</span>
        <span className="t-nav__brand-name">Сократ · Тьютор</span>
      </div>
      {groups.map(g => (
        <React.Fragment key={g.label}>
          <div className="t-nav__group-label">{g.label}</div>
          {g.items.map(it => (
            <a key={it.id}
               className={"t-nav__item" + (active === it.id ? " t-nav__item--active" : "")}
               onClick={e => { e.preventDefault(); onNavigate && onNavigate(it.id); }}
               href="#">
              <Icon name={it.icon} />
              <span>{it.label}</span>
              {typeof it.count === "number" && <span className="t-nav__count">{it.count}</span>}
            </a>
          ))}
        </React.Fragment>
      ))}
    </nav>
  );
}

function TopBar({ crumbs = [] }) {
  return (
    <>
      <div className="t-top__crumbs" aria-label="Навигация">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="t-top__crumb-sep">/</span>}
            <span className={i === crumbs.length - 1 ? "t-top__crumb-current" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="t-top__search">
        <span className="t-top__search-icon"><Icon name="search" size={16} /></span>
        <input type="search" placeholder="Поиск учеников, ДЗ, задач" aria-label="Глобальный поиск" />
        <span className="t-top__search-kbd"><KbdHint keys={["/"]} /></span>
      </div>
      <div className="t-top__account">
        <Tooltip label="Команды"><Button variant="ghost" size="sm" icon="command" iconOnly aria-label="Командная палитра" /></Tooltip>
        <Avatar name="Владимир Г." size={32} />
      </div>
    </>
  );
}

function PageHeader({ title, meta, primary }) {
  return (
    <div className="t-page-header">
      <div className="t-page-header__body">
        <h1 className="t-page-header__title">{title}</h1>
        {meta && <div className="t-page-header__meta">{meta}</div>}
      </div>
      {primary && <div className="t-page-header__actions">{primary}</div>}
    </div>
  );
}

function Toolbar({ children }) {
  return <div className="t-toolbar">{children}</div>;
}
function ToolbarSearch({ placeholder = "Поиск" }) {
  return (
    <div className="t-toolbar__search">
      <span className="t-toolbar__search-icon"><Icon name="search" size={15} /></span>
      <input type="search" placeholder={placeholder} />
    </div>
  );
}
function ToolbarViewSwitch({ value, onChange }) {
  return (
    <div className="t-toolbar__viewswitch" role="group" aria-label="Вид">
      <button aria-pressed={value === "table"} onClick={()=>onChange && onChange("table")} aria-label="Таблица"><Icon name="list" size={16} /></button>
      <button aria-pressed={value === "cards"} onClick={()=>onChange && onChange("cards")} aria-label="Карточки"><Icon name="layout-grid" size={16} /></button>
    </div>
  );
}

function BulkActionBar({ count, onClear, children }) {
  if (!count) return null;
  return (
    <div className="t-bulk" role="region" aria-label="Массовые действия">
      <span className="t-bulk__count">Выбрано: {count}</span>
      <Divider vertical />
      {children}
      <span className="t-bulk__spacer" />
      <Button variant="ghost" size="sm" icon="x" iconOnly onClick={onClear} aria-label="Снять выделение" />
    </div>
  );
}

Object.assign(window, { AppFrame, SideNav, TopBar, PageHeader, Toolbar, ToolbarSearch, ToolbarViewSwitch, BulkActionBar });
