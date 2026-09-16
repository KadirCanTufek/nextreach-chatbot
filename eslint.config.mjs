import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // beUI registry'sinden kopyalanan kütüphane dosyaları: bilinçli setState-in-effect kullanımı var.
  {
    files: ["src/components/motion/**", "src/lib/presence-gate.tsx", "src/lib/ease.ts"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
