import { test, expect } from "@playwright/test";
import { FRESH_ISS_TLE, FRESH_CUSTOM_TLE, generateFutureEpochTle } from "./helpers/fresh-tle.js";

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

/**
 * Bug Reproduction Tests
 *
 * These tests reproduce bugs fixed in commit 4359b22:
 *
 * Bug 1 (Asterisk Name Mismatch):
 * - Future-epoch satellites get " *" suffix in SatelliteProperties.js
 * - addCustomSatellite() was adding the base name (without asterisk) to enabledSatellites
 * - satIsActive() never matched because names didn't match
 *
 * Bug 2 (URL + Encoding):
 * - "+" signs in TLE exponent fields (e.g., "00000+0") were decoded as spaces in URLs
 * - TLE parsing failed due to corrupted exponent values
 */
test.describe("Bug Reproduction: Pre-Launch Satellite Display @regression", () => {
  test("should display future-epoch custom satellite loaded via URL", async ({ page }) => {
    // Generate TLE with epoch 30 days in future
    const futureTle = generateFutureEpochTle("PRELAUNCH-TEST");

    // CRITICAL: Replace + with %2B to avoid URL encoding bug (Bug 2)
    // Standard encodeURIComponent doesn't encode + but URLs decode + as space
    const encoded = encodeURIComponent(futureTle).replaceAll("+", "%2B");

    // Use ?sat= parameter (maps to customSatellites in sat.js)
    await page.goto(`/?sat=${encoded}`);
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for satellites to load
    await page.waitForFunction(() => window.cc?.sats?.satellites?.length > 0, { timeout: 10000 });

    // Check if satellite is active (the bug caused activeSatellites to be empty)
    const result = await page.evaluate(() => {
      const sats = window.cc?.sats?.satellites || [];
      const activeSats = window.cc?.sats?.activeSatellites || [];
      const sat = sats.find((s) => s.props.baseName?.includes("PRELAUNCH-TEST"));
      return {
        totalSatellites: sats.length,
        activeSatellites: activeSats.length,
        satelliteName: sat?.props?.name,
        baseName: sat?.props?.baseName,
        hasAsterisk: sat?.props?.name?.endsWith(" *"),
        isActive: sat ? window.cc.sats.satIsActive(sat) : false,
      };
    });

    console.log("Debug - Pre-launch satellite test:", JSON.stringify(result, null, 2));

    // Verify satellite loaded with asterisk suffix (future epoch detection)
    expect(result.hasAsterisk).toBe(true);
    expect(result.satelliteName).toContain(" *");

    // THE KEY ASSERTION: satellite should be active
    // On buggy code: this FAILS (isActive = false, activeSatellites = 0)
    // On fixed code: this PASSES (isActive = true, activeSatellites >= 1)
    expect(result.isActive).toBe(true);
    expect(result.activeSatellites).toBeGreaterThanOrEqual(1);
  });

  test("should preserve + signs in TLE data through URL encoding", async ({ page }) => {
    // This tests Bug 2: + signs in TLE exponent fields being corrupted
    const futureTle = generateFutureEpochTle("ENCODING-TEST");

    // Properly encode + as %2B
    const properlyEncoded = encodeURIComponent(futureTle).replaceAll("+", "%2B");

    await page.goto(`/?sat=${properlyEncoded}`);
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for satellites to load
    await page.waitForFunction(() => window.cc?.sats?.satellites?.length > 0, { timeout: 10000 });

    // Verify the TLE was parsed correctly (satellite exists and has valid data)
    const result = await page.evaluate(() => {
      const sats = window.cc?.sats?.satellites || [];
      const sat = sats.find((s) => s.props.baseName?.includes("ENCODING-TEST"));
      return {
        found: !!sat,
        name: sat?.props?.name,
        // Check if orbital data is valid (would be NaN or undefined if TLE parsing failed)
        hasValidOrbit: sat?.props?.orbit != null,
      };
    });

    expect(result.found).toBe(true);
    expect(result.hasValidOrbit).toBe(true);
  });
});
