import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    // prototype/ is the visual and interaction reference (React 16 UMD).
    // It is deliberately excluded from production linting — see CLAUDE.md §3.
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/.next-remote/**",
      "**/.next-remote-e2e/**",
      "**/dist/**",
      "**/target/**",
      "**/coverage/**",
      "prototype/**",
      "reference/**",
      "apps/api/**",
      "services/**",
      // Runtime state: browser profiles, probe reports, caches. Gitignored, and it
      // contains third-party JavaScript that must never be linted or formatted.
      "var/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use a union type or const object instead of an enum.",
        },
      ],
    },
  },
  {
    // Tool configs authored in plain JS have no TypeScript program.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
