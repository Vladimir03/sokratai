import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // .claude/worktrees — рабочие git-worktree'ы (полные копии репо). Без
      // этого исключения eslint линтил их наравне с основным деревом, и КАЖДАЯ
      // ошибка считалась трижды: 615 «проблем» вместо реальных 201, плюс
      // трёхкратное время прогона. Именно поэтому lint числился
      // «информационным» и его перестали читать.
      ".claude/worktrees/**",
      // Сгенерированные артефакты — не наш стиль-код.
      "supabase/functions/_shared/subjects.generated.ts",
      "src/lib/formulaEngine/formulas.generated.ts",
      // Авто-генерируется Vite-плагином @lovable.dev/mcp-js на КАЖДОЙ локальной
      // сборке (rule 20: после build его откатывают `git checkout --`). Линтить
      // чужой генерат бессмысленно — он же тянет node-глобали (`process`).
      "supabase/functions/mcp/index.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Deno-код edge-функций НЕ ПРОВЕРЯЕТСЯ НИЧЕМ ИНЫМ: `npm run build` — это vite
    // (только src/), `npx tsc -p tsconfig.app.json` — тоже только src/, а esbuild
    // необъявленные идентификаторы не ловит принципиально (он бандлер, не
    // тайп-чекер). Именно так в прод уехал P0 2026-08-04: чтение необъявленной
    // `resultHasBlocks` в mock-exam-student-api роняло страницу результата
    // пробника в 500 у ВСЕХ учеников (репорт Ульяны).
    //
    // `no-undef` выключен в tseslint.configs.recommended (для src/ его работу
    // делает tsc) — здесь возвращаем его обратно, потому что для Deno-путей
    // замены нет. Ловит ровно этот класс: identifier, которого нет ни в scope,
    // ни среди глобалей.
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.deno,
        Deno: "readonly",
        // Типы из TS-либ (не рантайм-значения): `no-undef` их не различает и
        // ругается на аннотации. Проще объявить, чем городить исключения.
        JsonWebKey: "readonly",
        RequestInit: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
    },
  },
);
