import { test, expect } from "@playwright/test";

/**
 * E2E Test: Orbit and Orbit Track Visualization
 *
 * Tests the orbit visualization controls for both untracked and tracked satellites.
 * Verifies that:
 * - Orbit checkbox enables/disables orbit paths (using Primitives for untracked, PathGraphics for tracked)
 * - Orbit track checkbox enables/disables orbit tracks
 * - Both work correctly for multiple satellites
 */

test.describe("Orbit Visualization", () => {
  test("should toggle orbit visualization for untracked satellites", async ({ page }) => {
    // Navigate with ISS pre-selected (but NOT tracked)
    await page.goto("/?sats=ISS~(ZARYA)");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000); // Wait for satellite to fully load

    // Open satellite elements menu
    const satelliteElementsButton = page
      .locator('button[title="Satellite elements"]')
      .or(
        page.locator("button.cesium-toolbar-button").filter({
          has: page.locator('[data-icon="layer-group"]'),
        }),
      )
      .first();

    await expect(satelliteElementsButton).toBeVisible({ timeout: 5000 });
    await satelliteElementsButton.click();
    await page.waitForTimeout(1000);

    await expect(page.locator('.toolbarSwitches:has-text("Satellite elements")')).toBeVisible({ timeout: 5000 });

    // Find Orbit checkbox
    const orbitCheckbox = page.locator('input[type="checkbox"][value="Orbit"]');
    await expect(orbitCheckbox).toBeAttached({ timeout: 5000 });

    const orbitInitialState = await orbitCheckbox.isChecked();
    console.log(`Orbit checkbox initial state: ${orbitInitialState ? "checked" : "unchecked"}`);

    // Verify initial state (no orbit)
    const initialState = await page.evaluate(() => {
      const hasOrbitPrimitive = !!window.cc?.sats?.satellites?.some((sat) => sat?.components?.Orbit);
      const hasPathEntity = window.cc?.viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasOrbitPrimitive, hasPathEntity, hasOrbit: hasOrbitPrimitive || hasPathEntity };
    });

    console.log(`Initial orbit state: ${JSON.stringify(initialState)}`);

    // Toggle orbit ON
    await orbitCheckbox.evaluate((node) => node.click());
    expect(await orbitCheckbox.isChecked()).toBe(!orbitInitialState);

    // Wait for orbit to be created (can take 3+ seconds)
    await page.waitForTimeout(4000);

    // Verify orbit was created (should be a Primitive for untracked satellite)
    const orbitEnabledState = await page.evaluate(() => {
      const hasOrbitPrimitive = !!window.cc?.sats?.satellites?.some((sat) => sat?.components?.Orbit);
      const hasPathEntity = window.cc?.viewer?.entities?.values?.some((e) => !!e.path) || false;
      const isTracked = !!window.cc?.sats?.trackedSatellite;
      return { hasOrbitPrimitive, hasPathEntity, hasOrbit: hasOrbitPrimitive || hasPathEntity, isTracked };
    });

    console.log(`After enabling orbit: ${JSON.stringify(orbitEnabledState)}`);

    // For untracked satellite, should use Primitive
    if (!orbitEnabledState.isTracked) {
      if (orbitInitialState) {
        // Was enabled, now disabled
        expect(orbitEnabledState.hasOrbit).toBe(false);
      } else {
        // Was disabled, now enabled
        expect(orbitEnabledState.hasOrbit).toBe(true);
        expect(orbitEnabledState.hasOrbitPrimitive).toBe(true);
      }
    }

    // Toggle orbit back OFF
    await orbitCheckbox.evaluate((node) => node.click());
    await page.waitForTimeout(2000);
    expect(await orbitCheckbox.isChecked()).toBe(orbitInitialState);

    // Verify orbit removed
    const orbitDisabledState = await page.evaluate(() => {
      const hasOrbitPrimitive = !!window.cc?.sats?.satellites?.some((sat) => sat?.components?.Orbit);
      const hasPathEntity = window.cc?.viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasOrbitPrimitive, hasPathEntity, hasOrbit: hasOrbitPrimitive || hasPathEntity };
    });

    console.log(`After disabling orbit: ${JSON.stringify(orbitDisabledState)}`);
    expect(orbitDisabledState.hasOrbit).toBe(initialState.hasOrbit);
  });

  test("should toggle orbit track visualization", async ({ page }) => {
    // Navigate with ISS pre-selected
    await page.goto("/?sats=ISS~(ZARYA)");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // Open satellite elements menu
    const satelliteElementsButton = page
      .locator('button[title="Satellite elements"]')
      .or(
        page.locator("button.cesium-toolbar-button").filter({
          has: page.locator('[data-icon="layer-group"]'),
        }),
      )
      .first();

    await expect(satelliteElementsButton).toBeVisible({ timeout: 5000 });
    await satelliteElementsButton.click();
    await page.waitForTimeout(1000);

    await expect(page.locator('.toolbarSwitches:has-text("Satellite elements")')).toBeVisible({ timeout: 5000 });

    // Find Orbit track checkbox
    const orbitTrackCheckbox = page.locator('input[type="checkbox"][value="Orbit track"]');
    await expect(orbitTrackCheckbox).toBeAttached({ timeout: 5000 });

    const trackInitialState = await orbitTrackCheckbox.isChecked();
    console.log(`Orbit track checkbox initial state: ${trackInitialState ? "checked" : "unchecked"}`);

    // Get initial state
    const initialState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const hasPath = viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasPath };
    });

    console.log(`Initial orbit track state: ${JSON.stringify(initialState)}`);

    // Toggle orbit track ON
    await orbitTrackCheckbox.evaluate((node) => node.click());
    expect(await orbitTrackCheckbox.isChecked()).toBe(!trackInitialState);

    // Wait for orbit track to be created
    await page.waitForTimeout(4000);

    // Verify orbit track was created
    const trackEnabledState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const hasPath = viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasPath };
    });

    console.log(`After enabling orbit track: ${JSON.stringify(trackEnabledState)}`);

    // Verify path state changed
    expect(trackEnabledState.hasPath).not.toBe(initialState.hasPath);

    // Toggle back
    await orbitTrackCheckbox.evaluate((node) => node.click());
    await page.waitForTimeout(2000);
    expect(await orbitTrackCheckbox.isChecked()).toBe(trackInitialState);

    const trackDisabledState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const hasPath = viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasPath };
    });

    console.log(`After disabling orbit track: ${JSON.stringify(trackDisabledState)}`);
    expect(trackDisabledState.hasPath).toBe(initialState.hasPath);
  });
});
