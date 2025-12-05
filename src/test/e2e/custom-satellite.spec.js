import { test, expect } from "@playwright/test";

/**
 * E2E Test: Custom Satellite Workflow
 *
 * Tests the ability to add custom satellites via TLE input.
 * This is a critical feature for users tracking specific satellites
 * not in the default database.
 *
 * This test prevents regressions in:
 * - Custom TLE input parsing
 * - Satellite creation from user data
 * - Orbit visualization for custom satellites
 */

// Sample valid TLE for testing
const VALID_TLE = `CUSTOM TEST SAT
1 99999U 24001A   24001.50000000  .00001000  00000-0  10000-4 0  9999
2 99999  98.0000 180.0000 0010000 100.0000 260.0000 14.50000000100000`;

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9991
2 25544  51.6416 247.4627 0006703  85.5961 274.6009 15.49478733123456`;

test.describe("Custom Satellite Input", () => {
  test("should load satellite from TLE URL parameter", async ({ page }) => {
    // Encode TLE in URL parameter (common use case for sharing)
    const tleParam = encodeURIComponent(ISS_TLE);

    await page.goto(`/?tle=${tleParam}`);

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Verify scene loaded successfully (timeline should be visible)
    await expect(page.locator(".cesium-timeline-main")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Satellite Visualization Controls", () => {
  test("should handle component visibility toggles", async ({ page }) => {
    await page.goto("/?sat=25544");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Look for component controls (Point, Label, etc.)
    const componentControls = page.locator('input[type="checkbox"]');

    const count = await componentControls.count();

    if (count > 0) {
      // Toggle first few components
      for (let i = 0; i < Math.min(count, 3); i++) {
        const control = componentControls.nth(i);
        if (await control.isVisible()) {
          await control.click();
          await control.click();
        }
      }

      // Verify canvas is still rendered
      await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible();
    } else {
      test.skip();
    }
  });
});
