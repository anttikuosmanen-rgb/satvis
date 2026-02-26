import { test, expect } from "@playwright/test";

/**
 * E2E Test: Planet Orbit Visualization
 *
 * Tests that planet orbits render correctly using the OrbitLinePrimitive,
 * are visible at extreme distances (1500M+ km), and are centered on the Sun.
 */

/**
 * Position camera along ecliptic north at given distance (in km).
 */
async function setCameraAboveEcliptic(page, distanceKm) {
  const distanceM = distanceKm * 1000;
  const sinObl = Math.sin((23.44 * Math.PI) / 180);
  const cosObl = Math.cos((23.44 * Math.PI) / 180);
  await page.evaluate(
    ({ dist, sy, cz }) => {
      window.cc.viewer.camera.setView({
        destination: { x: dist * 0.01, y: -dist * sy, z: dist * cz },
      });
    },
    { dist: distanceM, sy: sinObl, cz: cosObl },
  );
}

test.describe("Planet Orbits", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    await page.waitForFunction(() => window.cc?.viewer?.scene && window.cc?.sats?._initialTleLoadComplete, {
      timeout: 30000,
    });

    // Enable planet orbits via Shift+S menu
    await page.keyboard.press("Shift+S");
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible({ timeout: 5000 });

    const planetOrbitsCheckbox = page.locator('input[type="checkbox"][value="Planet orbits"]');
    await expect(planetOrbitsCheckbox).toBeAttached({ timeout: 5000 });

    if (!(await planetOrbitsCheckbox.isChecked())) {
      await planetOrbitsCheckbox.evaluate((node) => node.click());
    }
    expect(await planetOrbitsCheckbox.isChecked()).toBe(true);

    await page.keyboard.press("Escape");

    // Wait for orbits to be created
    await page.waitForFunction(
      () => {
        const renderer = window.cc?.planets?.orbitRenderer;
        if (!renderer) return false;
        // Check that at least Mercury and Saturn orbits exist
        return renderer.hasOrbit("Mercury") && renderer.hasOrbit("Saturn");
      },
      { timeout: 10000 },
    );
  });

  test("should render all planet orbits from ecliptic-perpendicular view", async ({ page }) => {
    // Position camera at 2000M km (beyond Saturn) along ecliptic north
    await setCameraAboveEcliptic(page, 2_000_000_000);

    // Verify all primitives are visible and have valid draw commands
    const result = await page.evaluate(() => {
      const renderer = window.cc.planets.orbitRenderer;
      const names = renderer.getOrbitNames();
      const primitiveStates = {};
      for (const name of names) {
        const entry = renderer.orbitPrimitives.get(name);
        if (entry) {
          const p = entry.primitive;
          primitiveStates[name] = {
            show: p.show,
            hasDrawCommand: !!p._drawCommand,
            hasVertexArray: !!p._vertexArray,
            posCount: p._positions?.length ?? 0,
          };
        }
      }
      return { names, primitiveStates };
    });

    expect(result.names.length).toBe(7);
    for (const name of result.names) {
      const state = result.primitiveStates[name];
      expect(state.show).toBe(true);
      expect(state.hasDrawCommand).toBe(true);
      expect(state.hasVertexArray).toBe(true);
      expect(state.posCount).toBeGreaterThan(5);
    }
  });

  test("should render planet orbits at extreme distance (1500M km)", async ({ page }) => {
    // This is the distance where BillboardGraphics previously failed.
    // Verify primitives are active with cull=false, occlude=false at this distance.
    await setCameraAboveEcliptic(page, 1_500_000_000);

    // Request render and verify no errors
    const result = await page.evaluate(() => {
      window.cc.viewer.scene.requestRender();
      const renderer = window.cc.planets.orbitRenderer;
      const names = renderer.getOrbitNames();
      const allVisible = names.every((n) => {
        const entry = renderer.orbitPrimitives.get(n);
        return entry && entry.primitive.show && entry.primitive._drawCommand;
      });
      // Check no rendering error panel
      const hasError = !!document.querySelector(".cesium-widget-errorPanel");
      return { allVisible, hasError, count: names.length };
    });

    expect(result.allVisible).toBe(true);
    expect(result.hasError).toBe(false);
    expect(result.count).toBe(7);
  });

  test("should center planet orbits on the Sun, not Earth", async ({ page }) => {
    // Get the centroid of Mercury's orbit samples and compare distance
    // to Sun vs distance to Earth (origin).
    // Mercury is the innermost planet so the offset is most obvious.
    const result = await page.evaluate(() => {
      const renderer = window.cc.planets.orbitRenderer;
      const entry = renderer.orbitPrimitives.get("Mercury");
      if (!entry) return { error: "No Mercury primitive" };

      const primitive = entry.primitive;
      const positions = primitive._positions;
      if (!positions || positions.length === 0) return { error: "No positions" };

      // Compute centroid of orbit sample positions (in heliocentric ICRF)
      let cx = 0,
        cy = 0,
        cz = 0;
      for (const p of positions) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
      }
      cx /= positions.length;
      cy /= positions.length;
      cz /= positions.length;

      // Distance of centroid from origin (Sun, since positions are heliocentric)
      const distFromSun = Math.sqrt(cx * cx + cy * cy + cz * cz);

      // Earth's helio position — get from astronomy-engine via the helper
      // For a closed orbit, centroid ≈ focus (Sun) ≈ origin in heliocentric frame
      // So distFromSun should be small relative to the orbit radius

      // Mercury's semi-major axis is ~0.387 AU = ~5.79e10 m
      const mercurySMA = 5.79e10;

      return {
        distFromSun,
        mercurySMA,
        ratio: distFromSun / mercurySMA,
        isHeliocentric: entry.heliocentric,
      };
    });

    expect(result.error).toBeUndefined();
    // The centroid of a Keplerian orbit is near the focus (Sun).
    // For Mercury's eccentricity (~0.2), centroid offset from Sun ≈ ae ≈ 0.2 * 0.387 AU.
    // The ratio of centroid distance to SMA should be well under 0.5.
    expect(result.ratio).toBeLessThan(0.5);
    expect(result.isHeliocentric).toBe(true);
  });

  test("should use OrbitLinePrimitive for all planet orbits", async ({ page }) => {
    // Verify all planets use the custom primitive (not Entity/PathGraphics)
    const diag = await page.evaluate(() => {
      const renderer = window.cc.planets.orbitRenderer;
      const names = renderer.getOrbitNames();
      const allInPrimitives = names.every((n) => renderer.orbitPrimitives.has(n));
      const noneInEntities = names.every((n) => !renderer.orbitEntities.has(n));
      return { names, allInPrimitives, noneInEntities, count: names.length };
    });
    expect(diag.count).toBe(7); // Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune
    expect(diag.allInPrimitives).toBe(true);
    expect(diag.noneInEntities).toBe(true);
  });
});
