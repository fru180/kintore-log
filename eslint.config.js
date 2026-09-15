import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", ".wrangler", "node_modules", "*.tsbuildinfo"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // API取得結果をeffect内でstateへ反映する画面構成のため許可する。
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["worker/**/*.js"],
    languageOptions: {
      globals: globals.worker,
    },
  },
  {
    files: ["*.config.{js,ts}", "scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
