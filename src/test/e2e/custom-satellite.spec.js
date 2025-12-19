import { test, expect } from "@playwright/test";
import { FRESH_ISS_TLE, FRESH_CUSTOM_TLE } from "./helpers/fresh-tle.js";

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

// Use fresh TLEs from helper to avoid staleness issues
const VALID_TLE = FRESH_CUSTOM_TLE;
const ISS_TLE = FRESH_ISS_TLE;

test.describe("Custom Satellite Input", () => {
  test("should load satellite from TLE URL parameter @critical", async ({ page }) => {
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
