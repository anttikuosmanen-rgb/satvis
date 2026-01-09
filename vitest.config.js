import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    globalSetup: ["./src/test/global-setup.js"],
    setupFiles: ["./src/test/setup.js"],
    // Don't fail on unhandled rejections from Cesium network requests in test environment
    dangerouslyIgnoreUnhandledErrors: true,
    server: {
      deps: {
        inline: ["pinia", "@vue/devtools-kit"],
      },
    },
    // Exclude Playwright E2E tests - they should be run separately with Playwright's runner
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e/**",
      "**/*.e2e.spec.js",
      "**/*.spec.js",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.{js,ts,vue}"],
      exclude: [
        "node_modules/",
        "src/test/",
        "*.config.js",
        "**/*.test.js",
        "**/*.spec.js",
        "src/workers/",
        "src/assets/",
        "src/index.js",
        "src/move.js",
        "src/ot.js",
      ],
      // Coverage thresholds - start conservative, increase over time
      thresholds: {
        lines: 12.9,
        functions: 16,
        branches: 9,
        statements: 12.9,
      },
      // Show all files, even those with 0% coverage
      all: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@vue/devtools-kit": path.resolve(__dirname, "./src/test/__mocks__/@vue/devtools-kit.js"),
    },
  },
});
