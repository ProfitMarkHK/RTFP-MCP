// ESLint is wired for exactly one purpose: the complexity budget (gate 3b,
// strict max cyclomatic complexity 10 per function, tests excluded).
// General linting is oxlint's job (see package.json "lint").
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ...tseslint.configs.base, files: ["src/**/*.ts"] },
  {
    rules: {
      complexity: ["error", { max: 10 }],
    },
  },
);
