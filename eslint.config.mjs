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
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        },
      ],
    },
  },
  // Configuration for test files (must come last to override other configs)
  {
    files: ["src/test/**/*.js", "src/test/**/*.spec.js", "src/test/**/*.test.js", "src/test/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
        cc: "readonly",
        global: "readonly",
        Cesium: "readonly",
      },
      parser: vueEslintParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
      },
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "import/extensions": "off",
      "import/order": "off",
      "no-misleading-character-class": "off",
      "no-undef": "off",
    },
  },
];
