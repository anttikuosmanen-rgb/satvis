import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import importPlugin from "eslint-plugin-import";
import vueEslintParser from "vue-eslint-parser";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  importPlugin.flatConfigs.recommended,
  prettierConfig,
  {
    files: ["src/**/*.{js,vue}"],
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
          ],
        },
      ],
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          //"newlines-between": "never"
        },
      ],
    },
  },
];
