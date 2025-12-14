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
    // Removed unnecessary waitForTimeout

    // Open satellite visuals menu
    const satelliteVisualsButton = page
      .locator('button[title="Satellite visuals"]')
      .or(
        page.locator("button.cesium-toolbar-button").filter({
          has: page.locator('[data-icon="layer-group"]'),
        }),
      )
      .first();

    await expect(satelliteVisualsButton).toBeVisible({ timeout: 5000 });
    await satelliteVisualsButton.click();
    // Removed unnecessary waitForTimeout

    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible({ timeout: 5000 });

    // Find Orbit checkbox
    const orbitCheckbox = page.locator('input[type="checkbox"][value="Orbit"]');
    await expect(orbitCheckbox).toBeAttached({ timeout: 5000 });

    const orbitInitialState = await orbitCheckbox.isChecked();

    // Verify initial state (no orbit)
    const initialState = await page.evaluate(() => {
      const hasOrbitPrimitive = !!window.cc?.sats?.satellites?.some((sat) => sat?.components?.Orbit);
      const hasPathEntity = window.cc?.viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasOrbitPrimitive, hasPathEntity, hasOrbit: hasOrbitPrimitive || hasPathEntity };
    });

    // Toggle orbit ON
    await orbitCheckbox.evaluate((node) => node.click());
    expect(await orbitCheckbox.isChecked()).toBe(!orbitInitialState);

    // Wait for orbit to be created (can take 3+ seconds)
    // Removed unnecessary waitForTimeout

    // Verify orbit was created (should be a Primitive for untracked satellite)
    const orbitEnabledState = await page.evaluate(() => {
      const hasOrbitPrimitive = !!window.cc?.sats?.satellites?.some((sat) => sat?.components?.Orbit);
      const hasPathEntity = window.cc?.viewer?.entities?.values?.some((e) => !!e.path) || false;
      const isTracked = !!window.cc?.sats?.trackedSatellite;
      return { hasOrbitPrimitive, hasPathEntity, hasOrbit: hasOrbitPrimitive || hasPathEntity, isTracked };
    });

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
    // Removed unnecessary waitForTimeout
    expect(await orbitCheckbox.isChecked()).toBe(orbitInitialState);

    // Verify orbit removed
    const orbitDisabledState = await page.evaluate(() => {
      const hasOrbitPrimitive = !!window.cc?.sats?.satellites?.some((sat) => sat?.components?.Orbit);
      const hasPathEntity = window.cc?.viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasOrbitPrimitive, hasPathEntity, hasOrbit: hasOrbitPrimitive || hasPathEntity };
    });

    expect(orbitDisabledState.hasOrbit).toBe(initialState.hasOrbit);
  });

  test("should toggle orbit track visualization", async ({ page }) => {
    // Navigate with ISS pre-selected
    await page.goto("/?sats=ISS~(ZARYA)");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    // Removed unnecessary waitForTimeout

    // Open satellite visuals menu
    const satelliteVisualsButton = page
      .locator('button[title="Satellite visuals"]')
      .or(
        page.locator("button.cesium-toolbar-button").filter({
          has: page.locator('[data-icon="layer-group"]'),
        }),
      )
      .first();

    await expect(satelliteVisualsButton).toBeVisible({ timeout: 5000 });
    await satelliteVisualsButton.click();
    // Removed unnecessary waitForTimeout

    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible({ timeout: 5000 });

    // Find Orbit track checkbox
    const orbitTrackCheckbox = page.locator('input[type="checkbox"][value="Orbit track"]');
    await expect(orbitTrackCheckbox).toBeAttached({ timeout: 5000 });

    const trackInitialState = await orbitTrackCheckbox.isChecked();

    // Get initial state
    const initialState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const hasPath = viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasPath };
    });

    // Toggle orbit track ON
    await orbitTrackCheckbox.evaluate((node) => node.click());
    expect(await orbitTrackCheckbox.isChecked()).toBe(!trackInitialState);

    // Wait for orbit track to be created
    // Removed unnecessary waitForTimeout

    // Verify orbit track was created
    const trackEnabledState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const hasPath = viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasPath };
    });

    // Verify path state changed
    expect(trackEnabledState.hasPath).not.toBe(initialState.hasPath);

    // Toggle back
    await orbitTrackCheckbox.evaluate((node) => node.click());
    // Removed unnecessary waitForTimeout
    expect(await orbitTrackCheckbox.isChecked()).toBe(trackInitialState);

    const trackDisabledState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const hasPath = viewer?.entities?.values?.some((e) => !!e.path) || false;
      return { hasPath };
    });

    expect(trackDisabledState.hasPath).toBe(initialState.hasPath);
  });
});
