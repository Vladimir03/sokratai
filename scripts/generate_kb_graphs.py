"""
Генератор SVG-графиков для задач из базы знаний (KB).
Демидова ЕГЭ 2025 — Задание 1 (кинематика): 27 графиков.

Стиль:
  - Цвет линии: #1B6B4A (socrat green)
  - Подпись Y-оси ГОРИЗОНТАЛЬНО (rotation=0)
  - bbox_inches='tight' с padding — подписи не обрезаются
  - Точки-маркеры на ключевых координатах
  - Сетка: светло-серая
  - Фон: белый

Использование:
  pip install matplotlib
  python scripts/generate_kb_graphs.py

Результат: kb-graphs/z1_01.svg ... z1_27.svg
Далее: bash scripts/upload-kb-graphs.sh
"""

import os
import sys

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.ticker as mticker
except ImportError:
    print("pip install matplotlib")
    sys.exit(1)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'kb-graphs')

# ── Стиль Сократа ──────────────────────────────────────────────
SOCRAT_GREEN = '#1B6B4A'
SOCRAT_ORANGE = '#E8913A'
GRID_COLOR = '#d0d0d0'
AXIS_COLOR = '#333333'
FONT_SIZE_TICK = 11
FONT_SIZE_LABEL = 13
MARKER_SIZE = 5
LINE_WIDTH = 2


def setup_axes(ax, xlabel, ylabel, xticks, yticks):
    """Настройка осей в стиле учебника физики."""
    ax.set_xlabel(xlabel, fontsize=FONT_SIZE_LABEL, color=AXIS_COLOR)

    # Y-label ГОРИЗОНТАЛЬНО, над осью
    ax.set_ylabel(
        ylabel,
        fontsize=FONT_SIZE_LABEL,
        color=AXIS_COLOR,
        rotation=0,
        ha='right',
        va='bottom',
        labelpad=10,
    )

    ax.set_xticks(xticks)
    ax.set_yticks(yticks)
    ax.tick_params(axis='both', which='major',
                   labelsize=FONT_SIZE_TICK, colors=AXIS_COLOR,
                   direction='out', length=3.5, width=0.8)

    ax.grid(True, alpha=0.7, linewidth=0.6, color=GRID_COLOR)
    ax.set_axisbelow(True)

    for spine in ax.spines.values():
        spine.set_color(AXIS_COLOR)
        spine.set_linewidth(0.8)


def plot_line(ax, points, color=SOCRAT_GREEN, marker='o'):
    """Нарисовать ломаную линию с маркерами."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    ax.plot(xs, ys, color=color, linewidth=LINE_WIDTH, zorder=3)
    ax.plot(xs, ys, color=color, marker=marker,
            markersize=MARKER_SIZE, linewidth=0, zorder=4)


def save_svg(fig, name):
    """Сохранить SVG с tight bbox и padding."""
    path = os.path.join(OUTPUT_DIR, f'{name}.svg')
    fig.savefig(path, format='svg', bbox_inches='tight', pad_inches=0.15)
    plt.close(fig)
    size_kb = os.path.getsize(path) / 1024
    print(f'  {name}.svg  ({size_kb:.1f} KB)')


def make_figure():
    """Создать figure стандартного размера."""
    fig, ax = plt.subplots(figsize=(5.3, 3.5))
    return fig, ax


# ══════════════════════════════════════════════════════════════
# ДАННЫЕ ГРАФИКОВ
# Извлечены из оригинальных SVG pixel-координат + seed-миграции
# ══════════════════════════════════════════════════════════════

GRAPHS = {
    # ── S(t) графики (путь от времени) ─────────────────────
    'z1_01': {
        'xlabel': 't, с', 'ylabel': 'S, м',
        'xticks': list(range(0, 101, 10)),
        'yticks': list(range(0, 351, 50)),
        'lines': [[(0, 0), (50, 200), (70, 350), (100, 350)]],
    },
    'z1_02': {
        'xlabel': 't, с', 'ylabel': 'S, м',
        'xticks': list(range(0, 6)),
        'yticks': list(range(0, 8)),
        'lines': [[(0, 0), (1, 0), (3, 5), (5, 7)]],
    },
    'z1_03': {
        'xlabel': 't, с', 'ylabel': 'S, м',
        'xticks': list(range(0, 11)),
        'yticks': list(range(0, 21, 5)),
        'lines': [[(0, 0), (5, 5), (7, 15), (10, 21)]],
    },

    # ── x(t) графики (координата от времени) ───────────────
    'z1_04': {
        'xlabel': 't, с', 'ylabel': 'x, м',
        'xticks': list(range(0, 61, 10)),
        'yticks': list(range(0, 161, 20)),
        'lines': [[(0, 0), (30, 60), (50, 160), (60, 160)]],
    },
    'z1_05': {
        'xlabel': 't, с', 'ylabel': 'x, м',
        'xticks': list(range(0, 61, 10)),
        'yticks': list(range(200, 321, 20)),
        'lines': [[(0, 200), (30, 320), (50, 220), (60, 220)]],
    },

    # ── Два тела ───────────────────────────────────────────
    'z1_06': {
        'xlabel': 't, с', 'ylabel': 'S, м',
        'xticks': list(range(0, 11)),
        'yticks': list(range(0, 31, 5)),
        'lines': [
            [(0, 0), (10, 20)],   # тело 1
            [(0, 0), (10, 30)],   # тело 2
        ],
        'labels': ['тело 1', 'тело 2'],
    },

    # ── Автобус A→Б→A ─────────────────────────────────────
    'z1_07': {
        'xlabel': 't, мин', 'ylabel': 'x, км',
        'xticks': list(range(0, 73, 12)),
        'yticks': list(range(0, 31, 5)),
        'lines': [[(0, 0), (30, 30), (36, 30), (72, 0)]],
    },

    # ── Расстояние между автомобилями ─────────────────────
    'z1_08': {
        'xlabel': 't, с', 'ylabel': 'd, м',
        'xticks': list(range(0, 21, 5)),
        'yticks': list(range(0, 501, 100)),
        'lines': [[(0, 500), (20, 0)]],
    },

    # ── v_x(t) графики (проекция скорости) ─────────────────
    'z1_09': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 16)),
        'yticks': list(range(0, 21, 5)),
        'lines': [[(0, 0), (10, 20), (15, 20)]],
    },
    'z1_10': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 11)),
        'yticks': list(range(0, 31, 5)),
        'lines': [[(0, 5), (5, 30), (10, 5)]],
    },

    # ── v(t) графики (скорость) ────────────────────────────
    'z1_11': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 6)),
        'yticks': list(range(0, 31, 5)),
        'lines': [[(0, 0), (5, 30)]],
    },
    'z1_12': {
        'xlabel': 't, с', 'ylabel': '|v|, м/с',
        'xticks': list(range(0, 5)),
        'yticks': list(range(0, 21, 5)),
        'lines': [[(0, 0), (2, 15), (4, 20)]],
    },
    'z1_13': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 4)),
        'yticks': list(range(0, 31, 5)),
        'lines': [[(0, 30), (3, 0)]],
    },
    'z1_14': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 6)),
        'yticks': list(range(0, 41, 10)),
        'lines': [[(0, 0), (5, 40)]],
    },
    'z1_15': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 5)),
        'yticks': list(range(0, 33, 8)),
        'lines': [[(0, 0), (1, 0), (3, 32), (4, 32)]],
    },

    # ── v(t) для расчёта пути/ускорения ────────────────────
    'z1_16': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 31, 5)),
        'yticks': list(range(0, 31, 5)),
        'lines': [[(0, 0), (10, 20), (20, 30), (30, 30)]],
    },
    'z1_17': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 31, 5)),
        'yticks': list(range(0, 31, 5)),
        'lines': [[(0, 0), (10, 20), (20, 30), (30, 30)]],
    },
    'z1_18': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 16)),
        'yticks': list(range(0, 21, 5)),
        'lines': [[(0, 0), (10, 20), (15, 20)]],
    },
    'z1_19': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 51, 10)),
        'yticks': [0, 5, 7.5, 10, 15],
        'lines': [[(0, 15), (20, 15), (40, 7.5), (50, 7.5)]],
    },
    'z1_20': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 26, 5)),
        'yticks': list(range(0, 21, 5)),
        'lines': [[(0, 20), (10, 20), (20, 10), (25, 10)]],
    },
    'z1_21': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 31, 5)),
        'yticks': list(range(0, 21, 5)),
        'lines': [[(0, 20), (10, 20), (10, 15), (20, 15), (20, 10), (30, 10)]],
    },
    'z1_22': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 5)),
        'yticks': list(range(0, 11, 2)),
        'lines': [[(0, 0), (1, 10), (3, 10), (4, 10)]],
    },

    # ── v_x(t) с отрицательными значениями ─────────────────
    'z1_23': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 6)),
        'yticks': [-1, 0, 1, 2, 3],
        'lines': [[(0, 0), (2, 3), (4, 0), (5, -1)]],
    },
    'z1_24': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 11)),
        'yticks': list(range(0, 11, 2)),
        'lines': [[(0, 10), (4, 10), (4, 0), (6, 0), (6, 5), (10, 5)]],
    },
    'z1_25': {
        'xlabel': 't, с', 'ylabel': '$v_x$, м/с',
        'xticks': list(range(0, 7)),
        'yticks': [-5, 0, 5, 10],
        'lines': [[(0, 10), (3, 10), (3, -5), (6, -5)]],
    },
    'z1_26': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 7)),
        'yticks': list(range(0, 11, 2)),
        'lines': [[(0, 10), (3, 10), (3, 4), (6, 4)]],
    },
    'z1_27': {
        'xlabel': 't, с', 'ylabel': 'v, м/с',
        'xticks': list(range(0, 51, 10)),
        'yticks': [0, 2, 4, 5, 6, 8, 10],
        'lines': [[(0, 5), (10, 5), (10, 10), (30, 10), (30, 5), (50, 5)]],
    },
}


def generate_all():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    colors = [SOCRAT_GREEN, SOCRAT_ORANGE]

    for name, data in sorted(GRAPHS.items()):
        fig, ax = make_figure()

        for i, line_pts in enumerate(data['lines']):
            color = colors[i % len(colors)]
            plot_line(ax, line_pts, color=color)

        setup_axes(ax, data['xlabel'], data['ylabel'],
                   data['xticks'], data['yticks'])

        # Легенда для графиков с несколькими линиями
        if 'labels' in data and len(data['labels']) > 1:
            for i, label in enumerate(data['labels']):
                ax.plot([], [], color=colors[i % len(colors)],
                        linewidth=LINE_WIDTH, label=label)
            ax.legend(fontsize=FONT_SIZE_TICK - 1, loc='best',
                      framealpha=0.9, edgecolor=GRID_COLOR)

        # Ось X через y=0 для графиков с отрицательными значениями
        ymin = data['yticks'][0]
        if ymin < 0:
            ax.axhline(y=0, color=AXIS_COLOR, linewidth=0.8, zorder=1)

        save_svg(fig, name)

    print(f'\nГотово: {len(GRAPHS)} графиков в {OUTPUT_DIR}/')
    print('Далее: bash scripts/upload-kb-graphs.sh')


if __name__ == '__main__':
    generate_all()
