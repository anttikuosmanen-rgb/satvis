import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration for SatVis
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./src/test/e2e",
  testMatch: "**/*.spec.js",

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["list"],
  ],

  // Test timeout - SatVis needs longer timeouts for:
  // - Cesium 3D globe initialization and rendering
  // - Pass calculation for ground stations (can take 30+ seconds)
  // - Satellite orbital calculations and TLE processing
  timeout: 120000, // 120 seconds

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: "http://localhost:5173",

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure
    video: "retain-on-failure",
  },

  // Configure projects for major browsers
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Exclude performance tests - they run in the performance project with headed mode
      testIgnore: ["**/pass-calculation-performance.spec.js"],
    },
    {
      // Performance tests run separately in headed mode with GPU acceleration
      // Run with: npx playwright test --project=performance
      name: "performance",
      use: {
        ...devices["Desktop Chrome"],
        headless: false,
        launchOptions: {
          args: [
            "--enable-gpu",
            "--use-gl=angle",
            "--use-angle=gl",
            "--enable-webgl",
            "--ignore-gpu-blocklist",
          ],
        },
      },
      testMatch: "**/pass-calculation-performance.spec.js",
    },
  ],

  // Run your local dev server before starting the tests
  webServer: {
    command: "npm run start",
    url: "http://localhost:5173",
    reuseExistingServer: true, // Always reuse existing server (dev server runs in background)
    timeout: 120000,
  },
});
