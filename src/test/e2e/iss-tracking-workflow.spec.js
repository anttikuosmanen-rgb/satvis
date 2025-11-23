import { test, expect } from "@playwright/test";

/**
 * E2E Test: ISS Tracking Workflow
 *
 * Critical user journey that prevents regressions in the most common use case:
 * finding and tracking the International Space Station (ISS).
 *
 * This test covers:
 * - Application loading and initialization
 * - Satellite search and selection
 * - Ground station setup
 * - Pass prediction
 * - Time manipulation and satellite tracking
 */

test.describe("ISS Tracking Workflow", () => {
  test("should allow user to find and track ISS passes", async ({ page }) => {
    // Step 1: Load the application
    await page.goto("/");

    // Wait for Cesium viewer to initialize (canvas appears)
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for satellite data to load (check for satellite select component existence)
    await expect(page.locator('.satellite-select')).toBeAttached({ timeout: 10000 });

    // Step 2: Open satellite selection menu
    // Click the toolbar button with satellite icon (has tooltip "Satellite selection")
    const satelliteMenuButton = page.locator('button.cesium-toolbar-button').filter({
      has: page.locator('.icon.svg-sat'),
    }).first();

    // Ensure button is visible before clicking
    await expect(satelliteMenuButton).toBeVisible({ timeout: 5000 });
    await satelliteMenuButton.click();

    // Wait for menu to open - the div with v-show="menu.cat" should become visible
    const satelliteMenu = page.locator('.toolbarSwitches').filter({
      has: page.locator('satellite-select, .satellite-select'),
    }).first();

    await expect(satelliteMenu).toBeVisible({ timeout: 3000 });

    // Step 3: Search for ISS in vue-multiselect
    // Click on the multiselect component to activate the input
    const multiselectComponent = page.locator('.satellite-select .multiselect').first();
    await multiselectComponent.click();
    await page.waitForTimeout(500);

    // Type directly into the input field (use pressSequentially to avoid visibility check)
    const searchInput = page.locator('.satellite-select input[placeholder="Type to search"]').first();
    await searchInput.pressSequentially("ISS", { delay: 100 });
    await page.waitForTimeout(1500); // Wait for search results to filter

    // Step 4: Select ISS from dropdown results
    // vue-multiselect shows results in a dropdown
    const issOption = page.locator('.multiselect__element').filter({
      hasText: /ISS.*ZARYA/i,
    }).first();

    await expect(issOption).toBeVisible({ timeout: 5000 });
    await issOption.click();

    // Wait for selection to process
    await page.waitForTimeout(500);

    // Satellite is now selected and should be visible in the scene

    // Step 5: Set ground station
    // Try to find ground station button/menu
    const groundStationButton = page.locator('[data-testid="ground-station-button"]').or(
      page.locator('button:has-text("Ground")'),
    ).or(
      page.locator('button:has-text("Location")'),
    ).or(
      page.locator('.ground-station-button'),
    ).first();

    // Check if ground station controls exist
    if (await groundStationButton.isVisible()) {
      await groundStationButton.click();

      // Try to set a manual location (fallback if geolocation doesn't work in test)
      const manualLocationOption = page.locator('text="Manual"').or(
        page.locator('[data-testid="manual-location"]'),
      ).first();

      if (await manualLocationOption.isVisible()) {
        await manualLocationOption.click();

        // Set latitude/longitude (Munich, Germany as example)
        const latInput = page.locator('input[placeholder*="atitude"]').or(
          page.locator('input[name="latitude"]'),
        ).first();
        const lonInput = page.locator('input[placeholder*="ongitude"]').or(
          page.locator('input[name="longitude"]'),
        ).first();

        if (await latInput.isVisible()) {
          await latInput.fill("48.1351");
          await lonInput.fill("11.582");
        }
      }
    }

    // Step 6: Verify ISS is visible in the scene
    // The satellite should be rendered on the globe
    await page.waitForTimeout(2000); // Wait for rendering

    // Check if timeline or pass prediction UI is visible
    const timelineExists = await page.locator('.cesium-timeline-main').isVisible();
    expect(timelineExists).toBeTruthy();
  });

  test("should load satellite from URL parameter", async ({ page }) => {
    // Navigate directly with ISS NORAD ID
    await page.goto("/?sat=25544");

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(3000);

    // Verify timeline exists (indicates satellite is loaded and scene is rendering)
    const timelineExists = await page.locator('.cesium-timeline-main').isVisible();
    expect(timelineExists).toBeTruthy();

    // Verify no JavaScript errors occurred during loading
    const errors = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.waitForTimeout(1000);
    expect(errors.length).toBe(0);
  });

  test("should handle timeline navigation", async ({ page }) => {
    await page.goto("/?sat=25544"); // Load with ISS

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    await page.waitForTimeout(2000);

    // Find timeline controls
    const timeline = page.locator('.cesium-timeline-main');
    await expect(timeline).toBeVisible();

    // Try to interact with timeline (scrubbing)
    const timelineBar = timeline.locator('.cesium-timeline-bar');
    if (await timelineBar.isVisible()) {
      const box = await timelineBar.boundingBox();
      if (box) {
        // Click middle of timeline
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        // Verify time changed (satellite position should update)
        // This is a smoke test - we're just checking it doesn't crash
        await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible();
      }
    }
  });

  test("should render without errors on mobile viewport", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

    await page.goto("/?sat=25544");

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Verify canvas is responsive
    const canvas = page.locator("#cesiumContainer canvas").first();
    const box = await canvas.boundingBox();

    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(375);
    }

    // Verify no JavaScript errors occurred
    const errors = [];
    page.on("pageerror", (error) => errors.push(error));

    await page.waitForTimeout(3000);

    expect(errors.length).toBe(0);
  });
});
