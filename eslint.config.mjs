import js from "@eslint/js";
import vue from "eslint-plugin-vue";
import importPlugin from "eslint-plugin-import";
import vueEslintParser from "vue-eslint-parser";
import babelParser from "@babel/eslint-parser";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  importPlugin.flatConfigs.recommended,
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
      "no-multi-spaces": ["error", { ignoreEOLComments: true }],
      "object-curly-newline": "off",
      "operator-linebreak": ["error", "after"],
      quotes: ["error", "double", { allowTemplateLiterals: true }],
      "max-len": [
        "error",
        170,
        2,
        {
          ignoreUrls: true,
          ignoreComments: false,
          ignoreRegExpLiterals: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
        },
      ],
      "vue/no-unused-components": "off",
      "vue/component-name-in-template-casing": ["error", "kebab-case"],
      "vue/max-attributes-per-line": [
        "warn",
        {
          singleline: { max: 8 },
          multiline: { max: 1 },
        },
      ],
      "vue/multi-word-component-names": "off",
      "vue/html-self-closing": [
        "error",
        {
          html: {
            void: "never",
            normal: "never",
            component: "always",
          },
          svg: "always",
          math: "always",
        },
      ],
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
