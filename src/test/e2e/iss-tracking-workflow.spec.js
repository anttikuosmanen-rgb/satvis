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
    await expect(page.locator(".satellite-select")).toBeAttached({ timeout: 10000 });

    // Step 2: Open satellite selection menu
    // Click the toolbar button with satellite icon (has tooltip "Satellite selection")
    const satelliteMenuButton = page
      .locator("button.cesium-toolbar-button")
      .filter({
        has: page.locator(".icon.svg-sat"),
      })
      .first();

    // Ensure button is visible before clicking
    await expect(satelliteMenuButton).toBeVisible({ timeout: 5000 });
    await satelliteMenuButton.click();

    // Wait for menu to open - the div with v-show="menu.cat" should become visible
    const satelliteMenu = page
      .locator(".toolbarSwitches")
      .filter({
        has: page.locator("satellite-select, .satellite-select"),
      })
      .first();

    await expect(satelliteMenu).toBeVisible({ timeout: 3000 });

    // Step 3: Search for ISS in vue-multiselect
    // Click on the multiselect component to activate the input
    const multiselectComponent = page.locator(".satellite-select .multiselect").first();
    await multiselectComponent.click();

    // Wait for the dropdown list to actually open (vue-multiselect adds multiselect--active class)
    const activeMultiselect = page.locator(".satellite-select .multiselect--active").first();
    await expect(activeMultiselect).toBeVisible({ timeout: 5000 });

    // Type directly into the input field (use fill with force to bypass actionability checks)
    const searchInput = page.locator('.satellite-select input[placeholder="Type to search"]').first();
    await searchInput.fill("ISS", { force: true });

    // Step 4: Select ISS from dropdown results
    // vue-multiselect shows results in a dropdown
    const issOption = page
      .locator(".multiselect__element")
      .filter({
        hasText: /ISS.*ZARYA/i,
      })
      .first();

    await expect(issOption).toBeVisible({ timeout: 5000 });
    await issOption.click({ force: true }); // Force click to bypass stability checks on animating dropdown

    // Wait for satellite entities to be created in Cesium viewer
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer) return false;
        const issEntities = viewer.entities.values.filter((e) => e.name && e.name.includes("ISS"));
        return issEntities.length > 0;
      },
      { timeout: 10000 },
    );

    // Verify that ISS satellite entities are actually created in Cesium viewer
    const satelliteEntities = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer) return { found: false, entities: [] };

      const issEntities = viewer.entities.values.filter((e) => e.name && e.name.includes("ISS"));

      return {
        found: issEntities.length > 0,
        count: issEntities.length,
        entities: issEntities.map((e) => ({
          name: e.name,
          hasPoint: !!e.point,
          hasBillboard: !!e.billboard,
          hasLabel: !!e.label,
          show: e.show,
        })),
      };
    });

    console.log(`ISS entities created: ${JSON.stringify(satelliteEntities, null, 2)}`);

    // Verify ISS satellite entities were actually rendered
    expect(satelliteEntities.found).toBe(true);
    expect(satelliteEntities.count).toBeGreaterThan(0);

    // Verify at least one entity has a point or billboard (visual representation)
    const hasVisualRepresentation = satelliteEntities.entities.some((e) => e.hasPoint || e.hasBillboard);
    expect(hasVisualRepresentation).toBe(true);

    // Step 5: Set ground station
    // Try to find ground station button/menu
    const groundStationButton = page
      .locator('[data-testid="ground-station-button"]')
      .or(page.locator('button:has-text("Ground")'))
      .or(page.locator('button:has-text("Location")'))
      .or(page.locator(".ground-station-button"))
      .first();

    // Check if ground station controls exist
    if (await groundStationButton.isVisible()) {
      await groundStationButton.click();

      // Try to set a manual location (fallback if geolocation doesn't work in test)
      const manualLocationOption = page.locator('text="Manual"').or(page.locator('[data-testid="manual-location"]')).first();

      if (await manualLocationOption.isVisible()) {
        await manualLocationOption.click();

        // Set latitude/longitude (Munich, Germany as example)
        const latInput = page.locator('input[placeholder*="atitude"]').or(page.locator('input[name="latitude"]')).first();
        const lonInput = page.locator('input[placeholder*="ongitude"]').or(page.locator('input[name="longitude"]')).first();

        if (await latInput.isVisible()) {
          await latInput.fill("48.1351");
          await lonInput.fill("11.582");
        }
      }
    }

    // Step 6: Verify ISS is visible in the scene
    // Check if timeline or pass prediction UI is visible (indicates rendering is complete)
    await expect(page.locator(".cesium-timeline-main")).toBeVisible({ timeout: 10000 });
  });

  test("should load satellite from URL parameter", async ({ page }) => {
    // Navigate directly with ISS using sats parameter
    await page.goto("/?sats=ISS~(ZARYA)");

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for timeline to appear (indicates satellite is loaded and scene is rendering)
    await expect(page.locator(".cesium-timeline-main")).toBeVisible({ timeout: 10000 });

    // Wait for ISS satellite entities to be created
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer) return false;
        const issEntities = viewer.entities.values.filter((e) => e.name && e.name.includes("ISS"));
        return issEntities.length > 0 && issEntities.some((e) => e.point || e.billboard);
      },
      { timeout: 10000 },
    );

    // Verify ISS satellite entities are actually created
    const satelliteEntities = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer) return { found: false, count: 0 };

      const issEntities = viewer.entities.values.filter((e) => e.name && e.name.includes("ISS"));

      const hasVisuals = issEntities.some((e) => e.point || e.billboard);

      return {
        found: issEntities.length > 0,
        count: issEntities.length,
        hasVisuals,
      };
    });

    console.log(`URL parameter test - ISS entities: ${JSON.stringify(satelliteEntities)}`);

    expect(satelliteEntities.found).toBe(true);
    expect(satelliteEntities.count).toBeGreaterThan(0);
    expect(satelliteEntities.hasVisuals).toBe(true);
  });

  test("should handle timeline navigation", async ({ page }) => {
    await page.goto("/?sats=ISS~(ZARYA)"); // Load with ISS

    // Wait for initialization
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Find timeline controls
    const timeline = page.locator(".cesium-timeline-main");
    await expect(timeline).toBeVisible({ timeout: 10000 });

    // Try to interact with timeline (scrubbing)
    const timelineBar = timeline.locator(".cesium-timeline-bar");
    if (await timelineBar.isVisible()) {
      const box = await page.evaluate(() => {
        const el = document.querySelector(".cesium-timeline-bar");
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      if (box) {
        // Click middle of timeline
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

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
    const box = await page.evaluate(() => {
      const canvas = document.querySelector("#cesiumContainer canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(375);
    }
  });
});
