import { dirname } from "path";
import { fileURLToPath } from "url";
import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15 still ships legacy eslintrc configs — `core-web-vitals`
// and `typescript` each export a bare `{ extends: [...] }` object, not a flat
// config array. Importing and spreading them directly (the previous setup)
// failed twice over: no "exports" map meant ERR_MODULE_NOT_FOUND without the
// .js extension, and once resolved the object is not iterable. FlatCompat is
// the supported bridge, so `npm run lint` actually starts now.
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
