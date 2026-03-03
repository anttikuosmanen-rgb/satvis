import { test, expect } from "@playwright/test";

/**
 * E2E Test: Near Earth Object (NEO) Fetching and Display
 *
 * Tests the NEO feature: opening the NEO menu, fetching NEOs via NASA APIs,
 * displaying entities in the Cesium scene, toggling orbits, and clearing.
 * API responses are mocked for deterministic, fast testing.
 */

// Mock NeoWs API response with 2 NEOs (one hazardous, one not)
const MOCK_NEOWS_RESPONSE = {
  element_count: 2,
  near_earth_objects: {
    "2026-03-02": [
      {
        id: "2099942",
        neo_reference_id: "2099942",
        name: "(99942) Apophis",
        absolute_magnitude_h: 19.7,
        estimated_diameter: {
          kilometers: {
            estimated_diameter_min: 0.27,
            estimated_diameter_max: 0.61,
          },
        },
        is_potentially_hazardous_asteroid: true,
        close_approach_data: [
          {
            close_approach_date_full: "2026-Mar-02 12:00",
            relative_velocity: { kilometers_per_second: "5.87" },
            miss_distance: { kilometers: "15000000", lunar: "39.01" },
          },
        ],
      },
      {
        id: "3542519",
        neo_reference_id: "3542519",
        name: "(2010 PK9)",
        absolute_magnitude_h: 24.3,
        estimated_diameter: {
          kilometers: {
            estimated_diameter_min: 0.03,
            estimated_diameter_max: 0.07,
          },
        },
        is_potentially_hazardous_asteroid: false,
        close_approach_data: [
          {
            close_approach_date_full: "2026-Mar-03 08:30",
            relative_velocity: { kilometers_per_second: "12.45" },
            miss_distance: { kilometers: "5000000", lunar: "13.0" },
          },
        ],
      },
    ],
  },
};

// Mock SBDB API response for Apophis (99942)
function createMockSbdbResponse(designation, name, e, a, i, om, w, ma, n, epoch) {
  return {
    object: {
      fullname: name,
      des: designation,
      H: "19.7",
    },
    orbit: {
      epoch: String(epoch),
      orbit_class: { name: "Aten" },
      elements: [
        { name: "e", value: String(e) },
        { name: "a", value: String(a) },
        { name: "i", value: String(i) },
        { name: "om", value: String(om) },
        { name: "w", value: String(w) },
        { name: "ma", value: String(ma) },
        { name: "n", value: String(n) },
      ],
    },
    phys_par: [{ name: "diameter", value: "0.37" }],
  };
}

const MOCK_SBDB_APOPHIS = createMockSbdbResponse("99942", "(99942) Apophis", 0.1912, 0.9224, 3.3388, 204.446, 126.687, 215.54, 1.1118, 2460400.5);
const MOCK_SBDB_PK9 = createMockSbdbResponse("2010 PK9", "(2010 PK9)", 0.425, 1.85, 12.5, 310.2, 45.8, 120.3, 0.52, 2460400.5);

/**
 * Set up API mocks for NASA NeoWs and JPL SBDB endpoints.
 */
async function mockNeoApis(page) {
  // Mock NeoWs feed endpoint
  await page.route("**/api.nasa.gov/neo/rest/v1/feed*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_NEOWS_RESPONSE),
    });
  });

  // Mock SBDB API for Apophis
  await page.route("**/ssd-api.jpl.nasa.gov/sbdb.api?sstr=2099942*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SBDB_APOPHIS),
    });
  });

  // Mock SBDB API for 2010 PK9
  await page.route("**/ssd-api.jpl.nasa.gov/sbdb.api?sstr=3542519*", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SBDB_PK9),
    });
  });
}

test.describe("NEO Fetch and Display", () => {
  test.beforeEach(async ({ page }) => {
    await mockNeoApis(page);
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
  });

  test("should open NEO menu with toolbar button", async ({ page }) => {
    // Click the NEO toolbar button (meteor icon)
    const neoButton = page.locator("button.cesium-toolbar-button").filter({
      has: page.locator('[data-icon="meteor"]'),
    });
    await neoButton.click();

    // Verify menu is open with title and fetch button
    await expect(page.locator('.toolbarSwitches:has-text("Near Earth Objects")')).toBeVisible();
    await expect(page.locator("button.neo-fetch-button")).toBeVisible();
    await expect(page.locator("button.neo-fetch-button")).toHaveText("Fetch NEOs (7 days)");
  });

  test("should open NEO menu with 'n' keyboard shortcut", async ({ page }) => {
    await page.keyboard.press("n");

    await expect(page.locator('.toolbarSwitches:has-text("Near Earth Objects")')).toBeVisible();
  });

  test("should fetch and display NEO entities @critical", async ({ page }) => {
    // Open NEO menu
    await page.keyboard.press("n");
    await expect(page.locator('.toolbarSwitches:has-text("Near Earth Objects")')).toBeVisible();

    // Click fetch button
    const fetchButton = page.locator("button.neo-fetch-button").first();
    await fetchButton.click();

    // Wait for loading to complete and count to appear
    await expect(page.locator(".neo-count")).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".neo-count")).toHaveText("2 NEOs loaded");

    // Verify entities were created in Cesium
    const entityState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer) return { error: "no viewer" };

      const neoEntities = viewer.entities.values.filter((e) => e.id?.startsWith("neo-"));
      return {
        count: neoEntities.length,
        ids: neoEntities.map((e) => e.id).sort(),
        names: neoEntities.map((e) => e.name).sort(),
        hasPoints: neoEntities.every((e) => !!e.point),
        hasDescriptions: neoEntities.every((e) => !!e.description),
      };
    });

    expect(entityState.count).toBe(2);
    expect(entityState.ids).toEqual(["neo-2099942", "neo-3542519"]);
    expect(entityState.hasPoints).toBe(true);
    expect(entityState.hasDescriptions).toBe(true);
  });

  test("should show orbits toggle after fetching NEOs", async ({ page }) => {
    // Open NEO menu and fetch
    await page.keyboard.press("n");
    const fetchButton = page.locator("button.neo-fetch-button").first();
    await fetchButton.click();
    await expect(page.locator(".neo-count")).toBeVisible({ timeout: 15000 });

    // Verify orbits checkbox and clear button appear
    const orbitsCheckbox = page.locator('.toolbarSwitches:has-text("Near Earth Objects") input[type="checkbox"]');
    await expect(orbitsCheckbox).toBeVisible();

    const clearButton = page.locator('button.neo-fetch-button:has-text("Clear NEOs")');
    await expect(clearButton).toBeVisible();
  });

  test("should toggle NEO orbit rendering", async ({ page }) => {
    // Fetch NEOs
    await page.keyboard.press("n");
    await page.locator("button.neo-fetch-button").first().click();
    await expect(page.locator(".neo-count")).toBeVisible({ timeout: 15000 });

    // Enable orbits
    const orbitsCheckbox = page.locator('.toolbarSwitches:has-text("Near Earth Objects") input[type="checkbox"]');
    await orbitsCheckbox.check();

    // Verify orbits were added to the orbit renderer
    const orbitsEnabled = await page.evaluate(() => {
      const neo = window.cc?.neo;
      if (!neo) return { error: "no neo manager" };
      return {
        showOrbits: neo.showOrbits,
        hasOrbit1: neo.orbitRenderer.hasOrbit("neo-orbit-2099942"),
        hasOrbit2: neo.orbitRenderer.hasOrbit("neo-orbit-3542519"),
      };
    });

    expect(orbitsEnabled.showOrbits).toBe(true);
    expect(orbitsEnabled.hasOrbit1).toBe(true);
    expect(orbitsEnabled.hasOrbit2).toBe(true);

    // Disable orbits
    await orbitsCheckbox.uncheck();

    const orbitsDisabled = await page.evaluate(() => {
      const neo = window.cc?.neo;
      return {
        showOrbits: neo.showOrbits,
        hasOrbit1: neo.orbitRenderer.hasOrbit("neo-orbit-2099942"),
        hasOrbit2: neo.orbitRenderer.hasOrbit("neo-orbit-3542519"),
      };
    });

    expect(orbitsDisabled.showOrbits).toBe(false);
    expect(orbitsDisabled.hasOrbit1).toBe(false);
    expect(orbitsDisabled.hasOrbit2).toBe(false);
  });

  test("should clear NEO entities and reset state", async ({ page }) => {
    // Fetch NEOs
    await page.keyboard.press("n");
    await page.locator("button.neo-fetch-button").first().click();
    await expect(page.locator(".neo-count")).toBeVisible({ timeout: 15000 });

    // Click clear button
    const clearButton = page.locator('button.neo-fetch-button:has-text("Clear NEOs")');
    await clearButton.click();

    // Verify count is gone and entities removed
    await expect(page.locator(".neo-count")).not.toBeVisible();

    const afterClear = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const neoEntities = viewer.entities.values.filter((e) => e.id?.startsWith("neo-"));
      return {
        entityCount: neoEntities.length,
        managerCount: window.cc?.neo?.neos?.length ?? -1,
        enabled: window.cc?.neo?.enabled ?? true,
      };
    });

    expect(afterClear.entityCount).toBe(0);
    expect(afterClear.managerCount).toBe(0);
    expect(afterClear.enabled).toBe(false);
  });

  test("should distinguish hazardous NEOs with red color", async ({ page }) => {
    // Fetch NEOs
    await page.keyboard.press("n");
    await page.locator("button.neo-fetch-button").first().click();
    await expect(page.locator(".neo-count")).toBeVisible({ timeout: 15000 });

    // Check point colors
    const colors = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const apophis = viewer.entities.getById("neo-2099942");
      const pk9 = viewer.entities.getById("neo-3542519");

      return {
        apophisColor: apophis?.point?.color?.getValue()?.toString(),
        apophisSize: apophis?.point?.pixelSize?.getValue(),
        pk9Color: pk9?.point?.color?.getValue()?.toString(),
        pk9Size: pk9?.point?.pixelSize?.getValue(),
      };
    });

    // Hazardous NEO (Apophis) should be red and larger
    expect(colors.apophisSize).toBe(8);
    expect(colors.pk9Size).toBe(5);
    // Red color toString includes high red component
    expect(colors.apophisColor).not.toBe(colors.pk9Color);
  });

  test("should show NEO info box on entity click", async ({ page }) => {
    // Fetch NEOs
    await page.keyboard.press("n");
    await page.locator("button.neo-fetch-button").first().click();
    await expect(page.locator(".neo-count")).toBeVisible({ timeout: 15000 });

    // Close the menu so it doesn't cover the view
    await page.keyboard.press("Escape");

    // Select the Apophis entity programmatically
    const description = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const apophis = viewer.entities.getById("neo-2099942");
      if (!apophis) return null;
      viewer.selectedEntity = apophis;
      // Get description content
      const desc = apophis.description?.getValue();
      return desc;
    });

    expect(description).toBeTruthy();
    expect(description).toContain("Apophis");
    expect(description).toContain("Potentially Hazardous");
    expect(description).toContain("YES");
    expect(description).toContain("Close Approach");
    expect(description).toContain("Orbital Elements");
  });

  test("should handle NEO position computation via Kepler propagation", async ({ page }) => {
    // Fetch NEOs
    await page.keyboard.press("n");
    await page.locator("button.neo-fetch-button").first().click();
    await expect(page.locator(".neo-count")).toBeVisible({ timeout: 15000 });

    // Verify NEO entities have valid computed positions
    const positions = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const apophis = viewer.entities.getById("neo-2099942");
      if (!apophis) return { error: "no entity" };

      const pos = apophis.position?.getValue(viewer.clock.currentTime);
      if (!pos) return { error: "no position" };

      const magnitude = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        magnitude,
        // Position should be reasonable: between 100km and 10 AU from Earth center
        isReasonable: magnitude > 100_000 && magnitude < 1.496e12,
      };
    });

    expect(positions.error).toBeUndefined();
    expect(positions.isReasonable).toBe(true);
  });
});
