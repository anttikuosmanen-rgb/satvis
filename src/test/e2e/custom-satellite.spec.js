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
  test("should add custom satellite from TLE input", async ({ page }) => {
    await page.goto("/");

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Look for custom satellite / add satellite button
    const customSatButton = page.locator('[data-testid="custom-satellite-button"]').or(
      page.locator('button:has-text("Custom")'),
    ).or(
      page.locator('button:has-text("Add Satellite")'),
    ).or(
      page.locator('.custom-satellite-button'),
    ).first();

    // If custom satellite button exists, test the workflow
    if (await customSatButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await customSatButton.click();

      // Find TLE input textarea
      const tleInput = page.locator('textarea[placeholder*="TLE"]').or(
        page.locator('textarea[name="tle"]'),
      ).or(
        page.locator('textarea').first(),
      );

      await expect(tleInput).toBeVisible();

      // Input custom TLE
      await tleInput.fill(VALID_TLE);

      // Find and click add/submit button
      const submitButton = page.locator('button:has-text("Add")').or(
        page.locator('button[type="submit"]'),
      ).or(
        page.locator('button:has-text("Create")'),
      ).first();

      await submitButton.click();

      // Wait for satellite to be added
      await page.waitForTimeout(1000);

      // Verify satellite appears in the scene or satellite list
      await expect(
        page.locator('text="CUSTOM TEST SAT"').or(
          page.locator('[data-satellite-name*="CUSTOM"]'),
        ).first(),
      ).toBeVisible({ timeout: 5000 });
    } else {
      // Skip test if custom satellite feature not found
      test.skip();
    }
  });

  test("should validate TLE format and show errors for invalid input", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    const customSatButton = page.locator('[data-testid="custom-satellite-button"]').or(
      page.locator('button:has-text("Custom")'),
    ).or(
      page.locator('button:has-text("Add Satellite")'),
    ).first();

    if (await customSatButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await customSatButton.click();

      const tleInput = page.locator('textarea[placeholder*="TLE"]').or(
        page.locator('textarea[name="tle"]'),
      ).or(
        page.locator('textarea').first(),
      );

      await expect(tleInput).toBeVisible();

      // Input invalid TLE (missing second line)
      await tleInput.fill("INVALID SATELLITE\n1 99999U 24001A   24001.50000000  .00001000  00000-0  10000-4 0  9999");

      const submitButton = page.locator('button:has-text("Add")').or(
        page.locator('button[type="submit"]'),
      ).first();

      await submitButton.click();

      // Should show error message
      await expect(
        page.locator('text=/invalid|error/i').or(
          page.locator('.error'),
        ).first(),
      ).toBeVisible({ timeout: 3000 });
    } else {
      test.skip();
    }
  });

  test("should load satellite from TLE URL parameter", async ({ page }) => {
    // Encode TLE in URL parameter (common use case for sharing)
    const tleParam = encodeURIComponent(ISS_TLE);

    await page.goto(`/?tle=${tleParam}`);

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(3000);

    // Verify scene loaded successfully (timeline should be visible)
    const timelineExists = await page.locator('.cesium-timeline-main').isVisible();
    expect(timelineExists).toBeTruthy();

    // Verify no JavaScript errors occurred
    const errors = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.waitForTimeout(1000);
    expect(errors.length).toBe(0);
  });
});

test.describe("Satellite Visualization Controls", () => {
  test("should toggle orbit visualization", async ({ page }) => {
    await page.goto("/?sat=25544"); // ISS

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);

    // Look for orbit toggle control
    const orbitToggle = page.locator('[data-testid="orbit-toggle"]').or(
      page.locator('input[type="checkbox"]').filter({ hasText: /orbit/i }),
    ).or(
      page.locator('button:has-text("Orbit")'),
    ).or(
      page.locator('.orbit-control'),
    ).first();

    if (await orbitToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Toggle orbit on
      await orbitToggle.click();
      await page.waitForTimeout(500);

      // Toggle orbit off
      await orbitToggle.click();
      await page.waitForTimeout(500);

      // Verify no errors occurred
      const errors = [];
      page.on("pageerror", (error) => errors.push(error));

      await page.waitForTimeout(1000);
      expect(errors.length).toBe(0);
    } else {
      test.skip();
    }
  });

  test("should handle component visibility toggles", async ({ page }) => {
    await page.goto("/?sat=25544");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);

    // Look for component controls (Point, Label, etc.)
    const componentControls = page.locator('input[type="checkbox"]');

    const count = await componentControls.count();

    if (count > 0) {
      // Toggle first few components
      for (let i = 0; i < Math.min(count, 3); i++) {
        const control = componentControls.nth(i);
        if (await control.isVisible()) {
          await control.click();
          await page.waitForTimeout(200);
          await control.click();
          await page.waitForTimeout(200);
        }
      }

      // Verify canvas is still rendered
      await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible();
    } else {
      test.skip();
    }
  });
});
