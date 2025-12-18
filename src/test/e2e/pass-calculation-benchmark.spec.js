import { test, expect } from "@playwright/test";
import { buildFreshIssUrl, generateFreshIssTle } from "./helpers/fresh-tle.js";

/**
 * E2E Benchmark Test: Pass Calculation Performance
 *
 * These tests trigger pass calculations and capture performance stats
 * to help identify bottlenecks and measure optimization improvements.
 *
 * Run with: npx playwright test pass-calculation-benchmark
 *
 * The stats are output to the console and can be captured for comparison.
 */

test.describe("Pass Calculation Benchmark", () => {
  test.describe.configure({ mode: "serial" });

  test("should benchmark pass calculation with stats collection", async ({ page }) => {
    // Capture console logs to see stats output
    const consoleLogs = [];
    page.on("console", (msg) => {
      if (msg.text().includes("Pass calculation stats")) {
        consoleLogs.push(msg.text());
      }
    });

    // Load page with ISS and Munich ground station
    const url = buildFreshIssUrl({ gs: "48.1351,11.5820,Munich" });
    await page.goto(url);

    // Wait for Cesium to initialize
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".cesium-timeline-main")).toBeVisible({ timeout: 10000 });

    // Wait for pass calculation to complete (passes should appear in UI)
    // Give it time to calculate passes
    await page.waitForTimeout(5000);

    // Check if passes were calculated (pass cards should be visible if passes exist)
    const passCards = page.locator('[data-testid="pass-card"], .pass-card, .p-card');
    const passCount = await passCards.count();

    console.log(`\n=== Benchmark Results ===`);
    console.log(`Passes found in UI: ${passCount}`);

    if (consoleLogs.length > 0) {
      console.log("\nPerformance Stats from Console:");
      consoleLogs.forEach((log) => console.log(log));
    } else {
      console.log("\nNote: No stats captured. Stats are only logged when collectStats=true is passed.");
      console.log("To see stats, modify the Orbit.js call or use the unit test benchmark below.");
    }

    // Verify the page is still functional
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible();
  });

  test("should verify pass calculation completes without errors", async ({ page }) => {
    // Capture any errors
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    // Load with ISS and ground station
    const url = buildFreshIssUrl({ gs: "52.5200,13.4050,Berlin" });
    await page.goto(url);

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for calculations
    await page.waitForTimeout(3000);

    // Check for errors
    const passErrors = errors.filter((e) => e.includes("pass") || e.includes("Pass") || e.includes("propagate"));
    expect(passErrors).toHaveLength(0);
  });

  test("should benchmark with multiple satellites", async ({ page }) => {
    const consoleLogs = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("Pass calculation") || text.includes("WorkerPool")) {
        consoleLogs.push(text);
      }
    });

    // Load multiple satellites - this will trigger multiple pass calculations
    // Using NORAD IDs for ISS and a few Starlink satellites
    await page.goto("/?sat=25544,44713,44714&gs=48.1351,11.5820,Munich");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for all calculations
    await page.waitForTimeout(8000);

    console.log(`\n=== Multi-Satellite Benchmark ===`);
    if (consoleLogs.length > 0) {
      consoleLogs.forEach((log) => console.log(log));
    }

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible();
  });

  test("should benchmark intense scenario with 30 satellites @intense", async ({ page }) => {
    // 30 Iridium NEXT satellites - LEO constellation with frequent passes
    const iridiumIds = [
      41917, 41918, 41919, 41920, 41921, 41922, 41923, 41924, 41925, 41926, 42803, 42804, 42805, 42806, 42807, 42808, 42809, 42810, 42811, 42812, 42955, 42956, 42957, 42958, 42959,
      42960, 42961, 42962, 42963, 42964,
    ];

    const consoleLogs = [];
    const startTime = Date.now();

    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("Pass calculation") || text.includes("WorkerPool") || text.includes("passes found")) {
        consoleLogs.push(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${text}`);
      }
    });

    // Load 30 satellites with ground station
    const url = `/?sat=${iridiumIds.join(",")}&gs=48.1351,11.5820,Munich`;
    console.log(`\n=== INTENSE BENCHMARK: 30 Iridium NEXT Satellites ===`);
    console.log(`URL: ${url.substring(0, 100)}...`);

    await page.goto(url);

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 30000 });

    // Wait for all pass calculations to complete - this could take a while
    console.log("Waiting for pass calculations...");
    await page.waitForTimeout(30000);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nTotal time: ${totalTime}s`);
    console.log(`Console logs captured: ${consoleLogs.length}`);

    if (consoleLogs.length > 0) {
      console.log("\nPerformance logs:");
      consoleLogs.forEach((log) => console.log(log));
    }

    // Verify page is still functional
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible();
  });
});

/**
 * Direct Orbit class benchmark test
 * This test directly calls the pass calculation with stats enabled
 */
test.describe("Direct Pass Calculation Benchmark", () => {
  test("should benchmark computePassesElevationSync directly", async ({ page }) => {
    // Navigate to the app first to get access to modules
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Execute benchmark in browser context
    const stats = await page.evaluate(async () => {
      // Access the Orbit class from the global scope or modules
      // Note: This requires the module to be accessible globally
      // If not accessible, we'll create an orbit instance manually

      const tle = `ISS (ZARYA)
1 25544U 98067A   24350.50000000  .00016717  00000-0  10270-3 0  9991
2 25544  51.6416 247.4627 0006703  85.5961 274.6009 15.49478733123456`;

      const groundStation = {
        latitude: 48.1351,
        longitude: 11.582,
        height: 520,
      };

      // Try to access Orbit class through window or app
      if (typeof window.Orbit !== "undefined") {
        const orbit = new window.Orbit("ISS (ZARYA)", tle);
        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

        const result = orbit.computePassesElevationSync(groundStation, startDate, endDate, 5, 50, true);

        return result.stats;
      }

      // Module not globally accessible - return message
      return { message: "Orbit class not globally accessible. Use unit tests for direct benchmarking." };
    });

    console.log("\n=== Direct Benchmark Results ===");
    console.log(JSON.stringify(stats, null, 2));
  });
});
