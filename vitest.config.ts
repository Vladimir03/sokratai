import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Конфиг unit-тестов — ОТДЕЛЬНЫЙ файл, а не секция в `vite.config.ts`.
 *
 * Почему отдельный: в `vite.config.ts` живут измеренные инварианты сборки
 * (`manualChunks` с задокументированной регрессией +265 КБ, `target: safari15`,
 * гейт `mcpPlugin` по mode). Чем меньше поводов туда заглядывать, тем меньше
 * шансов задеть их мимоходом.
 *
 * Окружение `node`, а не `jsdom`: тестируем чистую логику денег и грейдинга —
 * DOM ей не нужен, а лишняя зависимость замедляла бы прогон без пользы.
 * Понадобится тест React-компонента — добавить `environment: 'jsdom'` точечно
 * через `// @vitest-environment jsdom` в самом файле, а не глобально.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Deno-спецификатор → npm-пакет (волна 2, 2026-08-05): `import type`
      // стирается esbuild'ом и алиас не нужен, но RUNTIME-импорт supabase-js
      // в edge-модуле без этого алиаса делает модуль неимпортируемым в vitest.
      "npm:@supabase/supabase-js@2": "@supabase/supabase-js",
    },
  },
  test: {
    environment: "node",
    // Тесты лежат рядом с кодом, который проверяют: и во фронте (`src/`), и в
    // Deno-модулях (`supabase/functions/_shared/`). Второе важно — там живут
    // деньги и грейдинг, и именно туда tsc не заглядывает.
    include: ["src/**/*.test.ts", "supabase/functions/**/*.test.ts"],
    // `dist/` содержит собранные копии тех же модулей: без исключения раннер
    // подхватил бы их как отдельные тесты и врал бы про покрытие.
    exclude: ["node_modules/**", "dist/**", ".claude/**"],
    reporters: ["default"],
  },
});
