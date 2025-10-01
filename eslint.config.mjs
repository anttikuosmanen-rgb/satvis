import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";
import vueEslintParser from "vue-eslint-parser";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs["flat/recommended"],
  importPlugin.flatConfigs.recommended,
  prettierConfig,
  // Configuration for JavaScript files
  {
    files: ["src/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        cc: "readonly",
      },
      parser: vueEslintParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
      },
    },
    rules: {
      "no-console": "off",
      "no-param-reassign": ["error", { props: false }],
      "vue/no-unused-components": "off",
      "vue/component-name-in-template-casing": ["error", "kebab-case"],
      "vue/multi-word-component-names": "off",
      "import/extensions": [
        "error",
        "ignorePackages",
        {
          js: "never",
          ts: "never",
          vue: "always",
        },
      ],
      "import/prefer-default-export": "off",
      "import/no-extraneous-dependencies": "off",
      "import/namespace": "off",
      "import/default": "off",
      "import/named": "off",
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      "import/no-unresolved": [
        "error",
        {
          ignore: [
            "\\?raw$", // Ignore ?raw imports (Vite feature)
            "cesium", // Ignore cesium imports (handled by Vite)
            "^virtual:", // Ignore Vite virtual modules
          ],
        },
      ],
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        },
      ],
    },
  },
  // Configuration for TypeScript and Vue files with type-aware linting
  {
    files: ["src/**/*.{ts,vue}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        cc: "readonly",
      },
      parser: vueEslintParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
        parser: tseslint.parser,
        project: "./tsconfig.json",
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "no-console": "off",
      "no-param-reassign": ["error", { props: false }],
      "vue/no-unused-components": "off",
      "vue/component-name-in-template-casing": ["error", "kebab-case"],
      "vue/multi-word-component-names": "off",
      "import/extensions": [
        "error",
        "ignorePackages",
        {
          js: "never",
          ts: "never",
          vue: "always",
        },
      ],
      "import/prefer-default-export": "off",
      "import/no-extraneous-dependencies": "off",
      "import/namespace": "off",
      "import/default": "off",
      "import/named": "off",
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      "import/no-unresolved": [
        "error",
        {
          ignore: [
            "\\?raw$", // Ignore ?raw imports (Vite feature)
            "^virtual:", // Ignore Vite virtual modules
          ],
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        },
      ],
    },
  },
];
