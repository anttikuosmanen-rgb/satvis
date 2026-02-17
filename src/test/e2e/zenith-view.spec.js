import { test, expect } from "@playwright/test";
import { waitForAppReady } from "./helpers/globe-interaction.js";

/**
 * E2E Tests: Zenith View Interaction
 *
 * Tests the zenith view overlay: tooltip hover-delay behaviour, sun symbol
 * placement, and cleanup on exit.
 */

test.describe("Zenith View", () => {
  test("tooltip appears after hover delay and hides on movement", async ({ page }) => {
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");
    await waitForAppReady(page);

    // Enter zenith view
    await page.evaluate(() => {
      window.cc?.sats?.zenithViewFromGroundStation();
    });
    // Wait for the zenith overlay to be set up
    await page.waitForFunction(() => document.querySelector('[data-testid="zenith-tooltip"]') !== null, { timeout: 5000 });

    const canvas = page.locator("#cesiumContainer canvas").first();
    const box = await canvas.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Tooltip should not be visible before any hover
    await expect(page.locator('[data-testid="zenith-tooltip"]')).not.toBeVisible();

    // Move mouse to center — tooltip still hidden (delay has not elapsed)
    await page.mouse.move(cx, cy);
    await expect(page.locator('[data-testid="zenith-tooltip"]')).not.toBeVisible();

    // Wait for the 1.5 s hover delay to expire — tooltip becomes visible
    await expect(page.locator('[data-testid="zenith-tooltip"]')).toBeVisible({ timeout: 3000 });

    // Tooltip text should contain multi-line Alt/Az format
    const text = await page.locator('[data-testid="zenith-tooltip"]').innerText();
    expect(text).toMatch(/^Alt: -?\d+\.\d°/m);
    expect(text).toMatch(/^Az: \d+\.\d°/m);

    // Moving mouse hides tooltip immediately
    await page.mouse.move(cx + 50, cy);
    await expect(page.locator('[data-testid="zenith-tooltip"]')).not.toBeVisible();
  });

  test("sun symbol appears when camera tilted toward twilight sun", async ({ page }) => {
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");
    await waitForAppReady(page);

    // Set clock to Munich twilight: June 21 21:00 UTC — sun ~-8° altitude, ~295° azimuth (NNW)
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock) {
        const JulianDate = window.cc.viewer.clock.currentTime.constructor;
        window.cc.viewer.clock.currentTime = JulianDate.fromDate(new Date("2024-06-21T21:00:00Z"));
        window.cc.viewer.clock.shouldAnimate = false;
      }
      window.cc?.sats?.enterZenithViewImmediate();
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="zenith-tooltip"]') !== null, { timeout: 5000 });

    // Looking straight up — sun is below horizon and out of view
    await expect(page.locator('[data-testid="zenith-sun-symbol"]')).not.toBeVisible();

    // Tilt camera toward the sun's direction (heading=295° NNW, pitch near horizon)
    await page.evaluate(() => {
      window.cc.viewer.camera.setView({
        orientation: {
          heading: (295 * Math.PI) / 180,
          pitch: (-5 * Math.PI) / 180, // slightly below horizon to see sun at -8°
          roll: 0,
        },
      });
      window.cc.viewer.scene.requestRender();
    });

    // Now the sun should be on screen
    await expect(page.locator('[data-testid="zenith-sun-symbol"]')).toBeVisible({ timeout: 3000 });

    // Hovering the sun symbol shows a tooltip with Alt/Az immediately
    const sunBox = await page.locator('[data-testid="zenith-sun-symbol"]').boundingBox();
    await page.mouse.move(sunBox.x + sunBox.width / 2, sunBox.y + sunBox.height / 2);
    await expect(page.locator('[data-testid="zenith-tooltip"]')).toBeVisible({ timeout: 2000 });
    const sunText = await page.locator('[data-testid="zenith-tooltip"]').innerText();
    expect(sunText).toMatch(/^Alt: -\d+\.\d°/m); // negative (below horizon during twilight)
    expect(sunText).toMatch(/^Az: \d+\.\d°/m);
  });

  test("sun symbol hidden outside twilight (deep night)", async ({ page }) => {
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");
    await waitForAppReady(page);

    // Set clock to deep night — Dec 21 00:00 UTC: sun is ~-65° in Munich, well below -18°
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock) {
        const JulianDate = window.cc.viewer.clock.currentTime.constructor;
        window.cc.viewer.clock.currentTime = JulianDate.fromDate(new Date("2024-12-21T00:00:00Z"));
        window.cc.viewer.clock.shouldAnimate = false;
      }
      window.cc?.sats?.enterZenithViewImmediate();
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="zenith-tooltip"]') !== null, { timeout: 5000 });

    await expect(page.locator('[data-testid="zenith-sun-symbol"]')).not.toBeVisible();
  });

  test("sun symbol hidden when looking straight up at zenith", async ({ page }) => {
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");
    await waitForAppReady(page);

    // Set clock to Munich twilight
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock) {
        const JulianDate = window.cc.viewer.clock.currentTime.constructor;
        window.cc.viewer.clock.currentTime = JulianDate.fromDate(new Date("2024-06-21T21:00:00Z"));
        window.cc.viewer.clock.shouldAnimate = false;
      }
      window.cc?.sats?.enterZenithViewImmediate();
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="zenith-tooltip"]') !== null, { timeout: 5000 });

    // Sun at -8° altitude is below the horizon, not visible when looking straight up
    await expect(page.locator('[data-testid="zenith-sun-symbol"]')).not.toBeVisible();
  });

  test("sun symbol hidden when camera faces away from sun", async ({ page }) => {
    await page.goto("/?gs=61.1060,24.3020,Tampere");
    await waitForAppReady(page);

    await page.evaluate(() => {
      if (window.cc?.viewer?.clock) {
        const JulianDate = window.cc.viewer.clock.currentTime.constructor;
        window.cc.viewer.clock.currentTime = JulianDate.fromDate(new Date("2025-02-14T16:00:00Z"));
        window.cc.viewer.clock.shouldAnimate = false;
      }
      window.cc?.sats?.enterZenithViewImmediate();
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="zenith-tooltip"]') !== null, { timeout: 5000 });

    // Tilt camera to face East (away from sun at WSW ~255°)
    await page.evaluate(() => {
      window.cc.viewer.camera.setView({
        orientation: {
          heading: (90 * Math.PI) / 180,
          pitch: (-5 * Math.PI) / 180,
          roll: 0,
        },
      });
      window.cc.viewer.scene.requestRender();
    });

    // Sun is behind the camera — symbol should be hidden
    await expect(page.locator('[data-testid="zenith-sun-symbol"]')).not.toBeVisible();
  });

  test("sun symbol never appears at wrong azimuth during pan (Finland twilight repro)", async ({ page }) => {
    // Repro: gs=61.1060,24.3020 at Feb 14 16:00 UTC → sun at alt≈-7°, az≈255°.
    // After panning, if the symbol is visible, it must be at the correct azimuth.
    await page.goto("/?gs=61.1060,24.3020,Tampere");
    await waitForAppReady(page);

    await page.evaluate(() => {
      if (window.cc?.viewer?.clock) {
        const JulianDate = window.cc.viewer.clock.currentTime.constructor;
        window.cc.viewer.clock.currentTime = JulianDate.fromDate(new Date("2025-02-14T16:00:00Z"));
        window.cc.viewer.clock.shouldAnimate = false;
      }
      window.cc?.sats?.enterZenithViewImmediate();
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="zenith-tooltip"]') !== null, { timeout: 5000 });

    const canvas = page.locator("#cesiumContainer canvas").first();
    const canvasBox = await canvas.boundingBox();
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    // Perform 4 left-drags (same as user's repro), checking after each drag
    for (let i = 0; i < 4; i++) {
      await page.mouse.move(cx + 300, cy);
      await page.mouse.down({ button: "left" });
      await page.mouse.move(cx - 300, cy, { steps: 25 });
      await page.mouse.up({ button: "left" });
      // Wait for camera animation (scene tweens) to finish
      await page.waitForFunction(
        () => {
          const scene = window.cc?.viewer?.scene;
          return !scene?.tweens || scene.tweens.length === 0;
        },
        { timeout: 3000 },
      );

      const sunSymbol = page.locator('[data-testid="zenith-sun-symbol"]');
      if (await sunSymbol.isVisible()) {
        // Move to symbol position, wait for tooltip
        const sunBox = await sunSymbol.boundingBox();
        const sx = sunBox.x + sunBox.width / 2;
        const sy = sunBox.y + sunBox.height / 2;
        await page.mouse.move(sx, sy);
        const tooltip = page.locator('[data-testid="zenith-tooltip"]');
        await expect(tooltip).toBeVisible({ timeout: 3000 });
        if (await tooltip.isVisible()) {
          const text = await tooltip.innerText();
          const azMatch = text.match(/Az:\s*(\d+\.?\d*)/);
          if (azMatch) {
            const az = parseFloat(azMatch[1]);
            // Sun is at ~255°. Symbol must NEVER appear at wrong az like 198° or 200°.
            const diff = Math.abs(((az - 255 + 540) % 360) - 180);
            expect(diff).toBeLessThan(30); // within 30° of true sun az
          }
        }
      }
    }
  });

  test("zenith overlay elements are removed on exit", async ({ page }) => {
    await page.goto("/?gs=48.1351,11.5820,Munich");
    await waitForAppReady(page);

    await page.evaluate(() => window.cc?.sats?.enterZenithViewImmediate());

    // Elements should be present in DOM while zenith view is active
    await expect(page.locator('[data-testid="zenith-tooltip"]')).toBeAttached();
    await expect(page.locator('[data-testid="zenith-sun-symbol"]')).toBeAttached();

    // Exit zenith view
    await page.evaluate(() => window.cc?.sats?.exitZenithView());

    // Both elements should be removed from DOM
    await expect(page.locator('[data-testid="zenith-tooltip"]')).not.toBeAttached();
    await expect(page.locator('[data-testid="zenith-sun-symbol"]')).not.toBeAttached();
  });
});
