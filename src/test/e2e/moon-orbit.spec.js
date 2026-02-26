import { test, expect } from "@playwright/test";

/**
 * E2E Test: Moon Orbit Visualization
 *
 * Tests that the Moon orbit renders at all camera distances using a differential
 * pixel counting approach: measure bright pixels with orbit ON vs OFF.
 * The difference isolates orbit-specific rendering from billboards/labels/stars.
 *
 * Camera is positioned along ecliptic-north direction (perpendicular to
 * the Moon's orbital plane) so the orbit appears as a near-circle.
 */

/**
 * Count non-black pixels in the center region of the Cesium canvas.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function countBrightPixels(page) {
  const canvas = page.locator("#cesiumContainer canvas").first();
  const screenshot = await canvas.screenshot();

  return page.evaluate(async (base64Data) => {
    const img = new Image();
    const blob = new Blob([Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0))], { type: "image/png" });
    const url = URL.createObjectURL(blob);

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const offscreen = document.createElement("canvas");
    offscreen.width = img.width;
    offscreen.height = img.height;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    const regionW = Math.floor(img.width * 0.7);
    const regionH = Math.floor(img.height * 0.7);
    const startX = Math.floor((img.width - regionW) / 2);
    const startY = Math.floor((img.height - regionH) / 2);

    const imageData = ctx.getImageData(startX, startY, regionW, regionH);
    const pixels = imageData.data;

    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 30 || pixels[i + 1] > 30 || pixels[i + 2] > 30) {
        count++;
      }
    }
    return count;
  }, screenshot.toString("base64"));
}

/**
 * Position camera perpendicular to the Moon's orbital plane at given distance.
 */
async function setCameraAboveOrbitPlane(page, distanceKm) {
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

/**
 * Toggle Moon orbit visibility.
 */
async function setMoonOrbitVisible(page, visible) {
  await page.evaluate((vis) => {
    window.cc.earthMoon.orbitRenderer.setOrbitVisibility("Moon", vis);
    window.cc.viewer.scene.requestRender();
  }, visible);
  await page.waitForFunction(() => {
    window.cc.viewer.scene.requestRender();
    return true;
  });
}

test.describe("Moon Orbit", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    await page.waitForFunction(() => window.cc?.viewer?.scene && window.cc?.sats?._initialTleLoadComplete, { timeout: 30000 });

    // Enable Moon orbit
    await page.keyboard.press("Shift+S");
    await expect(page.locator('.toolbarSwitches:has-text("Satellite visuals")')).toBeVisible({ timeout: 5000 });

    const moonOrbitCheckbox = page.locator('input[type="checkbox"][value="Moon orbit"]');
    await expect(moonOrbitCheckbox).toBeAttached({ timeout: 5000 });

    if (!(await moonOrbitCheckbox.isChecked())) {
      await moonOrbitCheckbox.evaluate((node) => node.click());
    }
    expect(await moonOrbitCheckbox.isChecked()).toBe(true);

    await page.keyboard.press("Escape");

    await page.waitForFunction(() => window.cc?.earthMoon?.showMoonOrbit === true && window.cc?.earthMoon?.orbitRenderer?.hasOrbit("Moon"), { timeout: 10000 });
  });

  test("should use OrbitLinePrimitive rendering (not PathGraphics)", async ({ page }) => {
    const diag = await page.evaluate(() => {
      const renderer = window.cc.earthMoon.orbitRenderer;
      return {
        inPrimitives: renderer.orbitPrimitives?.has("Moon") ?? false,
        inEntities: renderer.orbitEntities?.has("Moon") ?? false,
      };
    });
    expect(diag.inPrimitives).toBe(true);
    expect(diag.inEntities).toBe(false);
  });

  for (const distanceKm of [1_000_000, 5_000_000, 10_000_000]) {
    const label = `${distanceKm / 1_000_000}M`;

    test(`should render Moon orbit at ${label} km altitude`, async ({ page }) => {
      await setCameraAboveOrbitPlane(page, distanceKm);

      // Measure with orbit visible
      await setMoonOrbitVisible(page, true);
      const pixelsOn = await countBrightPixels(page);

      // Measure with orbit hidden
      await setMoonOrbitVisible(page, false);
      const pixelsOff = await countBrightPixels(page);

      // The orbit must contribute visible pixels at these distances
      const orbitPixels = pixelsOn - pixelsOff;
      expect(orbitPixels).toBeGreaterThan(20);
    });
  }
});
