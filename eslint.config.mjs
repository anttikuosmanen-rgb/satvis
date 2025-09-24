import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import importPlugin from "eslint-plugin-import";
import vueEslintParser from "vue-eslint-parser";
import babelParser from "@babel/eslint-parser";
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
    files: ["**/*.js", "**/*.vue"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        cc: "readonly",
      },
      parser: vueEslintParser,
      parserOptions: {
        parser: babelParser,
        requireConfigFile: false,
        babelOptions: {
          presets: ["@babel/preset-env", "@babel/preset-typescript"],
        },
      },
    },
    plugins: {
      vue,
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
    },
  },
];
