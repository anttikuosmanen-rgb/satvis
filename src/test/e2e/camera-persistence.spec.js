import { test, expect } from "@playwright/test";
import { pauseAnimation, waitForAppReady } from "./helpers/globe-interaction.js";

/**
 * E2E Tests: Camera Persistence with Spacebar Toggle
 *
 * Tests that camera direction and distance are preserved when toggling
 * between satellite and ground station views using the spacebar.
 */

test.describe("Camera Persistence", () => {
  test.beforeEach(async ({ page }) => {
    // Start with ISS satellite loaded
    await page.goto("/?sats=ISS~(ZARYA)");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for full Cesium scene initialization
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for ISS satellite to be loaded
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        if (!sats || sats.length === 0) return false;
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        return issSat && issSat.props?.orbit?.satrec;
      },
      { timeout: 60000 },
    );
  });

  test("should capture and compute camera offset correctly @critical", async ({ page }) => {
    // Pause animation for stable testing
    await pauseAnimation(page);

    // Track ISS directly via code
    await page.evaluate(() => {
      const sats = window.cc.sats.satellites;
      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
      if (issSat) {
        issSat.track();
      }
    });

    // Wait for satellite to be tracked
    await page.waitForFunction(
      () => {
        const tracked = window.cc?.viewer?.trackedEntity;
        return tracked && tracked.name && tracked.name.includes("ISS");
      },
      { timeout: 10000 },
    );

    // Test the camera offset capture function
    const offsetResult = await page.evaluate(() => {
      const offset = window.cc.captureTrackedEntityCameraOffset();
      return {
        hasOffset: offset !== null,
        hasViewFrom: offset && offset.viewFrom && typeof offset.viewFrom.x === "number",
        hasRange: offset && typeof offset.range === "number" && offset.range > 0,
      };
    });

    // Verify offset was captured correctly
    expect(offsetResult.hasOffset).toBe(true);
    expect(offsetResult.hasViewFrom).toBe(true);
    expect(offsetResult.hasRange).toBe(true);
  });

  test("should store separate camera offsets for satellite and ground station", async ({ page }) => {
    await pauseAnimation(page);

    // Set up ground station programmatically
    await page.evaluate(() => {
      window.cc.sats.addGroundStation({ latitude: 40.0, longitude: -74.0, height: 0 }, "Test GS");
    });

    await page.waitForFunction(() => window.cc?.sats?.groundStationAvailable === true, { timeout: 10000 });

    // Track ISS directly
    await page.evaluate(() => {
      const sats = window.cc.sats.satellites;
      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
      if (issSat) {
        issSat.track();
      }
    });

    await page.waitForFunction(
      () => {
        const tracked = window.cc?.viewer?.trackedEntity;
        return tracked && tracked.name && tracked.name.includes("ISS");
      },
      { timeout: 10000 },
    );

    // Verify camera offset storage is initialized
    await page.keyboard.press("Space"); // Go to GS
    await page.waitForFunction(
      () => {
        const tracked = window.cc?.viewer?.trackedEntity;
        return tracked && !tracked.name?.includes("ISS");
      },
      { timeout: 5000 },
    );
    await page.keyboard.press("Space"); // Back to satellite
    await page.waitForFunction(() => window.cc?._savedCameraOffsets?.size > 0, { timeout: 5000 });

    // Check that saved camera offsets exist
    const hasOffsets = await page.evaluate(() => {
      const cc = window.cc;
      return cc._savedCameraOffsets instanceof Map && cc._savedCameraOffsets.size > 0;
    });

    expect(hasOffsets).toBe(true);
  });
});

test.describe("Time Acceleration Keyboard Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for scene to be ready
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        return viewer && viewer.clock;
      },
      { timeout: 10000 },
    );
  });

  test("should set time multiplier with number keys @critical", async ({ page }) => {
    // Test key 1 = 1x
    await page.keyboard.press("1");
    let multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(1);

    // Test key 2 = 2x
    await page.keyboard.press("2");
    multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(2);

    // Test key 3 = 4x (2^2)
    await page.keyboard.press("3");
    multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(4);

    // Test key 5 = 16x (2^4)
    await page.keyboard.press("5");
    multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(16);

    // Test key 0 = 1024x (2^10)
    await page.keyboard.press("0");
    multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(1024);
  });

  test("should set negative time multiplier with Shift+number @critical", async ({ page }) => {
    // Test Shift+1 = -1x
    await page.keyboard.press("Shift+1");
    let multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(-1);

    // Test Shift+2 = -2x
    await page.keyboard.press("Shift+2");
    multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(-2);

    // Test Shift+0 = -1024x
    await page.keyboard.press("Shift+0");
    multiplier = await page.evaluate(() => window.cc.viewer.clock.multiplier);
    expect(multiplier).toBe(-1024);
  });

  test("should enable animation when setting time multiplier", async ({ page }) => {
    // Pause animation first
    await page.evaluate(() => {
      window.cc.viewer.clock.shouldAnimate = false;
    });

    let isAnimating = await page.evaluate(() => window.cc.viewer.clock.shouldAnimate);
    expect(isAnimating).toBe(false);

    // Press number key to set multiplier
    await page.keyboard.press("5");

    isAnimating = await page.evaluate(() => window.cc.viewer.clock.shouldAnimate);
    expect(isAnimating).toBe(true);
  });
});

test.describe("ESC Key Globe Reset", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?sats=ISS~(ZARYA)");
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for ISS to be loaded and enabled (created in scene)
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        if (!sats || sats.length === 0) return false;
        const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
        // Satellite needs to be both loaded and created (enabled in scene)
        return issSat && issSat.props?.orbit?.satrec && issSat.created;
      },
      { timeout: 60000 },
    );
  });

  test("should reset to globe view when ESC pressed while tracking entity @critical", async ({ page }) => {
    // Track ISS by clicking on it in the entity list or via code
    // Use JavaScript to directly track the satellite for reliable testing
    await page.evaluate(() => {
      const sats = window.cc.sats.satellites;
      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
      if (issSat) {
        issSat.track();
      }
    });

    // Wait for satellite to be tracked
    await page.waitForFunction(
      () => {
        const tracked = window.cc?.viewer?.trackedEntity;
        return tracked && tracked.name && tracked.name.includes("ISS");
      },
      { timeout: 10000 },
    );

    // Verify no menu or info box is open
    await page.keyboard.press("Escape"); // Close any menu
    await page.waitForFunction(() => !window.cc?.viewer?.selectedEntity, { timeout: 5000 }).catch(() => {});

    // Close info box if open
    const hasSelectedEntity = await page.evaluate(() => !!window.cc.viewer.selectedEntity);
    if (hasSelectedEntity) {
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !window.cc?.viewer?.selectedEntity, { timeout: 5000 });
    }

    // Now press ESC - should reset to globe view
    await page.keyboard.press("Escape");

    // Wait for tracking to be cleared
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        return viewer && !viewer.trackedEntity;
      },
      { timeout: 5000 },
    );

    // Verify no entity is tracked or selected
    const trackingState = await page.evaluate(() => ({
      trackedEntity: window.cc.viewer.trackedEntity,
      selectedEntity: window.cc.viewer.selectedEntity,
    }));

    expect(trackingState.trackedEntity).toBeFalsy();
    expect(trackingState.selectedEntity).toBeFalsy();
  });

  test("should close info box before resetting globe view", async ({ page }) => {
    // Track ISS directly
    await page.evaluate(() => {
      const sats = window.cc.sats.satellites;
      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
      if (issSat) {
        issSat.track();
      }
    });

    // Wait for satellite to be tracked
    await page.waitForFunction(
      () => {
        const tracked = window.cc?.viewer?.trackedEntity;
        return tracked && tracked.name && tracked.name.includes("ISS");
      },
      { timeout: 10000 },
    );

    // Press 'i' to select tracked entity (show info box)
    await page.keyboard.press("i");

    // Wait for entity to be selected
    await page.waitForFunction(
      () => {
        const selected = window.cc?.viewer?.selectedEntity;
        return selected && selected.name && selected.name.includes("ISS");
      },
      { timeout: 5000 },
    );

    // First ESC should close info box
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !window.cc?.viewer?.selectedEntity, { timeout: 5000 });

    let state = await page.evaluate(() => ({
      trackedEntity: window.cc.viewer.trackedEntity?.name,
      selectedEntity: window.cc.viewer.selectedEntity?.name,
    }));

    // Tracked entity should still be set, but selected should be cleared
    expect(state.trackedEntity).toContain("ISS");
    expect(state.selectedEntity).toBeUndefined();

    // Second ESC should reset to globe view
    await page.keyboard.press("Escape");

    await page.waitForFunction(() => !window.cc?.viewer?.trackedEntity, { timeout: 5000 });

    state = await page.evaluate(() => ({
      trackedEntity: window.cc.viewer.trackedEntity,
      selectedEntity: window.cc.viewer.selectedEntity,
    }));

    expect(state.trackedEntity).toBeFalsy();
    expect(state.selectedEntity).toBeFalsy();
  });
});
