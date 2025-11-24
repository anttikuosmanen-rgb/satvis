import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    globals: true,
    // Don't fail on unhandled rejections from Cesium network requests in test environment
    dangerouslyIgnoreUnhandledErrors: true,
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
        lines: 25,
        functions: 25,
        branches: 20,
        statements: 25,
      },
      // Show all files, even those with 0% coverage
      all: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
