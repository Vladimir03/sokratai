/**
 * Pyodide Service - выполнение Python кода в браузере
 * Используется для генерации графиков matplotlib
 */

// Типы для Pyodide
interface PyodideInterface {
  loadPackage: (packages: string | string[]) => Promise<void>;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: {
    get: (name: string) => unknown;
    set: (name: string, value: unknown) => void;
  };
  FS: {
    readFile: (path: string, options?: { encoding: string }) => string | Uint8Array;
    writeFile: (path: string, data: string | Uint8Array) => void;
  };
}

declare global {
  interface Window {
    loadPyodide: (config?: { indexURL?: string }) => Promise<PyodideInterface>;
  }
}

// Состояние сервиса
let pyodideInstance: PyodideInterface | null = null;
let isLoading = false;
let loadPromise: Promise<PyodideInterface> | null = null;

// Версия Pyodide CDN
const PYODIDE_VERSION = "0.26.4";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

/**
 * Загружает скрипт Pyodide в DOM
 */
async function loadPyodideScript(): Promise<void> {
  if (document.querySelector('script[data-pyodide]')) {
    return;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PYODIDE_CDN}pyodide.js`;
    script.setAttribute('data-pyodide', 'true');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Не удалось загрузить Pyodide'));
    document.head.appendChild(script);
  });
}

/**
 * Инициализирует Pyodide с необходимыми пакетами
 */
export async function initPyodide(): Promise<PyodideInterface> {
  // Если уже загружен, возвращаем
  if (pyodideInstance) {
    return pyodideInstance;
  }

  // Если загрузка в процессе, ждём
  if (loadPromise) {
    return loadPromise;
  }

  isLoading = true;

  loadPromise = (async () => {
    try {
      // Загружаем скрипт
      await loadPyodideScript();

      console.log('🐍 Инициализация Pyodide...');

      // Инициализируем Pyodide
      pyodideInstance = await window.loadPyodide({
        indexURL: PYODIDE_CDN,
      });

      // Загружаем matplotlib и numpy
      console.log('📦 Загрузка matplotlib и numpy...');
      await pyodideInstance.loadPackage(['matplotlib', 'numpy']);

      // Настраиваем matplotlib для работы без GUI
      await pyodideInstance.runPythonAsync(`
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import io
import base64

# Настройки по умолчанию для красивых графиков
plt.rcParams['figure.figsize'] = [10, 6]
plt.rcParams['figure.dpi'] = 100
plt.rcParams['font.size'] = 12
plt.rcParams['axes.grid'] = True
plt.rcParams['grid.alpha'] = 0.3

def save_plot_as_base64():
    """Сохраняет текущий график как base64 строку"""
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', facecolor='white', edgecolor='none')
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close()
    return img_base64
      `);

      console.log('✅ Pyodide готов к работе');
      return pyodideInstance;
    } catch (error) {
      console.error('❌ Ошибка инициализации Pyodide:', error);
      loadPromise = null;
      throw error;
    } finally {
      isLoading = false;
    }
  })();

  return loadPromise;
}

/**
 * Результат выполнения Python кода
 */
export interface PythonExecutionResult {
  success: boolean;
  output?: string;
  imageBase64?: string;
  error?: string;
}

/**
 * Выполняет Python код и возвращает результат
 * @param code - Python код для выполнения
 * @returns Результат выполнения с возможным изображением графика
 */
export async function executePythonCode(code: string): Promise<PythonExecutionResult> {
  try {
    const pyodide = await initPyodide();

    // Добавляем код для сохранения графика
    const wrappedCode = `
${code}

# Автоматически сохраняем график если он был создан
_result_image = None
if plt.get_fignums():
    _result_image = save_plot_as_base64()
_result_image
    `;

    const result = await pyodide.runPythonAsync(wrappedCode);

    return {
      success: true,
      imageBase64: result as string | undefined,
    };
  } catch (error) {
    console.error('❌ Ошибка выполнения Python:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Неизвестная ошибка',
    };
  }
}

/**
 * Извлекает Python код из markdown-блока
 * @param text - Текст с markdown-блоками кода
 * @returns Массив найденных Python-блоков
 */
export function extractPythonCode(text: string): string[] {
  const pythonBlocks: string[] = [];

  // Регулярка для поиска блоков ```python ... ```
  const regex = /```python\s*\n([\s\S]*?)```/gi;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1].trim();
    // Проверяем, что это код для графика (содержит plt или matplotlib)
    if (code.includes('plt.') || code.includes('matplotlib') || code.includes('np.')) {
      pythonBlocks.push(code);
    }
  }

  return pythonBlocks;
}

/**
 * Проверяет, содержит ли текст Python код для графиков
 */
export function hasGraphCode(text: string): boolean {
  return extractPythonCode(text).length > 0;
}

/**
 * Возвращает статус загрузки Pyodide
 */
export function getPyodideStatus(): {
  isLoaded: boolean;
  isLoading: boolean;
} {
  return {
    isLoaded: pyodideInstance !== null,
    isLoading,
  };
}

/**
 * Предзагрузка Pyodide в фоне
 * Вызывать при открытии чата для ускорения первого графика
 */
export function preloadPyodide(): void {
  if (!pyodideInstance && !isLoading) {
    initPyodide().catch(console.error);
  }
}
