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
);
