import { test, expect } from "@playwright/test";
import { pauseAnimation, resumeAnimation } from "./helpers/globe-interaction.js";

// Skip this test in CI/headless mode - requires GPU for accurate measurements
// Run manually with: npx playwright test pass-calculation-performance --headed
test.skip(({ headless }) => headless, "Performance test requires headed mode with GPU");

test.describe("Pass Calculation Performance", () => {
  test("should maintain FPS across scenarios with high clock multiplier", async ({ page }) => {
    const results = {
      baseline: null,
      withSatellites: null,
      withInfoBox: null,
    };

    // Helper to measure FPS for a duration
    async function measureFps(durationMs, label) {
      await page.evaluate(() => {
        window.fpsData = { frameTimes: [], startTime: performance.now() };
        window.fpsListener = () => {
          const now = performance.now();
          window.fpsData.frameTimes.push(now - (window.fpsData.lastFrame || now));
          window.fpsData.lastFrame = now;
        };
        window.cc.viewer.scene.postRender.addEventListener(window.fpsListener);
      });

      await page.waitForTimeout(durationMs);

      const metrics = await page.evaluate(() => {
        window.cc.viewer.scene.postRender.removeEventListener(window.fpsListener);
        const times = window.fpsData.frameTimes.filter((t) => t > 0 && t < 5000);
        if (times.length < 2) return { avgFps: 0, minFps: 0, maxFps: 0 };
        const avgFrameTime = times.reduce((a, b) => a + b, 0) / times.length;
        const avgFps = 1000 / avgFrameTime;
        const minFps = 1000 / Math.max(...times);
        const maxFps = 1000 / Math.min(...times);
        return { avgFps, minFps, maxFps, frameCount: times.length };
      });

      console.log(`\n${label}:`);
      console.log(`  Average FPS: ${metrics.avgFps.toFixed(1)}`);
      console.log(`  Min FPS: ${metrics.minFps.toFixed(1)}`);
      console.log(`  Max FPS: ${metrics.maxFps.toFixed(1)}`);
      console.log(`  Frames: ${metrics.frameCount}`);

      return metrics;
    }

    // 1. Load app with no satellites
    console.log("\n=== PHASE 1: Baseline (no satellites) ===");
    await page.goto("/?tags=NONE&hideLight=0&onlyLit=0");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for Cesium to be ready
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        return viewer?.scene?.globe?._surface;
      },
      { timeout: 30000 },
    );

    // Pause animation initially
    await pauseAnimation(page);

    // 2. Create ground station
    console.log("\nCreating ground station...");
    const groundStationButton = page
      .locator("button.cesium-toolbar-button")
      .filter({ has: page.locator(".svg-groundstation") })
      .first();

    await expect(groundStationButton).toBeVisible({ timeout: 5000 });
    await groundStationButton.click();

    const pickOnGlobeLabel = page.locator('label.toolbarSwitch:has-text("Pick on globe")');
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 10000 });

    const pickOnGlobeCheckbox = pickOnGlobeLabel.locator('input[type="checkbox"]');
    if (!(await pickOnGlobeCheckbox.isChecked())) {
      await pickOnGlobeLabel.click();
      await expect(pickOnGlobeCheckbox).toBeChecked({ timeout: 3000 });
    }

    // Click on canvas to place ground station
    const canvasBox = await page.evaluate(() => {
      const canvas = document.querySelector("#cesiumContainer canvas");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.waitForTimeout(1000);

    // Verify ground station was created
    const gsExists = await page.evaluate(() => window.cc?.sats?.groundStations?.length > 0);
    expect(gsExists).toBe(true);
    console.log("Ground station created");

    // Close ground station menu
    await groundStationButton.click();

    // Deselect any entity
    await page.evaluate(() => {
      window.cc.viewer.selectedEntity = undefined;
    });

    // Resume animation at 1000x speed
    await resumeAnimation(page);
    await page.evaluate(() => {
      window.cc.viewer.clock.multiplier = 1000;
    });

    // 3. Baseline FPS test (no satellites)
    results.baseline = await measureFps(5000, "BASELINE (no satellites, 1000x speed)");

    // 4. Load satellites (~200 from Starlink group)
    console.log("\n=== PHASE 2: Loading satellites ===");
    await page.evaluate(() => {
      window.cc.viewer.clock.multiplier = 1; // Slow down while loading
    });

    // Load Planet and GNSS satellites (~200 total)
    await page.goto("/?tags=Planet,GNSS&hideLight=0&onlyLit=0");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for satellites to load
    await page.waitForFunction(
      () => {
        const satCount = window.cc?.sats?.activeSatellites?.length || 0;
        return satCount >= 50;
      },
      { timeout: 120000 },
    );

    const satCount = await page.evaluate(() => window.cc?.sats?.activeSatellites?.length || 0);
    console.log(`Loaded ${satCount} satellites`);

    // Re-create ground station (page reloaded)
    await groundStationButton.click();
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 10000 });

    if (!(await pickOnGlobeCheckbox.isChecked())) {
      await pickOnGlobeLabel.click();
    }

    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.waitForTimeout(2000);

    // Close menu and deselect
    await groundStationButton.click();
    await page.evaluate(() => {
      window.cc.viewer.selectedEntity = undefined;
    });

    // Set 1000x speed
    await page.evaluate(() => {
      window.cc.viewer.clock.multiplier = 1000;
    });

    // 5. FPS test with satellites (no info box)
    console.log("\n=== PHASE 3: With satellites, no info box ===");
    results.withSatellites = await measureFps(10000, `WITH ${satCount} SATELLITES (1000x speed, info box closed)`);

    // 6. Select ground station to open info box
    console.log("\n=== PHASE 4: With info box open ===");
    await page.evaluate(() => {
      const gs = window.cc.sats.groundStations[0]?.components?.Groundstation;
      if (gs) {
        window.cc.viewer.selectedEntity = gs;
      }
    });

    // Verify info box is visible
    await page.waitForTimeout(500);
    const infoBoxVisible = await page.evaluate(() => {
      const infoBox = document.querySelector(".cesium-infoBox");
      return infoBox && !infoBox.classList.contains("cesium-infoBox-hidden");
    });
    console.log(`Info box visible: ${infoBoxVisible}`);

    // 7. FPS test with info box open
    results.withInfoBox = await measureFps(10000, `WITH ${satCount} SATELLITES (1000x speed, info box OPEN)`);

    // 8. Summary and assertions
    console.log("\n=== SUMMARY ===");
    console.log(`Baseline FPS (no sats):     ${results.baseline.avgFps.toFixed(1)}`);
    console.log(`With satellites FPS:        ${results.withSatellites.avgFps.toFixed(1)}`);
    console.log(`With info box FPS:          ${results.withInfoBox.avgFps.toFixed(1)}`);

    // Calculate degradation
    const satDegradation = ((results.baseline.avgFps - results.withSatellites.avgFps) / results.baseline.avgFps) * 100;
    const infoBoxDegradation = ((results.withSatellites.avgFps - results.withInfoBox.avgFps) / results.withSatellites.avgFps) * 100;

    console.log(`\nDegradation from satellites: ${satDegradation.toFixed(1)}%`);
    console.log(`Degradation from info box:   ${infoBoxDegradation.toFixed(1)}%`);

    // Assertions
    // Info box should not cause more than 40% FPS drop
    // (Some overhead is expected from iframe rendering and pass list)
    if (infoBoxDegradation > 40) {
      console.log(`\n❌ FAIL: Info box causes ${infoBoxDegradation.toFixed(1)}% FPS degradation (threshold: 40%)`);
    } else {
      console.log(`\n✓ PASS: Info box degradation acceptable (${infoBoxDegradation.toFixed(1)}% < 40%)`);
    }

    expect(infoBoxDegradation).toBeLessThan(40);

    // With info box open, FPS should still be reasonable (> 20 fps)
    expect(results.withInfoBox.avgFps).toBeGreaterThan(20);
  });
});
