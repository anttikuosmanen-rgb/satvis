/**
 * Helper functions for interacting with the Cesium 3D globe in E2E tests
 */

/**
 * Pause the globe animation by setting Cesium clock.shouldAnimate to false
 * This stops the Cesium clock, making elements stable for interaction
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function pauseAnimation(page) {
  await page.evaluate(() => {
    if (window.cc?.viewer?.clock) {
      window.cc.viewer.clock.shouldAnimate = false;
    }
  });

  // Verify animation is paused
  await page.waitForFunction(
    () => {
      return window.cc?.viewer?.clock?.shouldAnimate === false;
    },
    { timeout: 3000 },
  );
}

/**
 * Resume the globe animation by setting Cesium clock.shouldAnimate to true
 * This restarts the Cesium clock
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function resumeAnimation(page) {
  await page.evaluate(() => {
    if (window.cc?.viewer?.clock) {
      window.cc.viewer.clock.shouldAnimate = true;
    }
  });

  // Verify animation is playing
  await page.waitForFunction(
    () => {
      return window.cc?.viewer?.clock?.shouldAnimate === true;
    },
    { timeout: 3000 },
  );
}

/**
 * Wait for pass calculation to complete by listening for the satvis:passCalculationComplete event
 * This replaces arbitrary timeouts with event-based waiting
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} options - Options object
 * @param {number} [options.timeout=60000] - Maximum time to wait in milliseconds
 * @param {boolean} [options.waitForEvent=false] - If true, only wait for the event, don't check existing passes
 */
export async function waitForPassCalculation(page, options = {}) {
  const { timeout = 15000, waitForEvent = false } = options;

  // Set up the event listener once, outside of the polling loop
  // This prevents event listener leaks from waitForFunction polling
  await page.evaluate(() => {
    // Store completion state on window to avoid event listener leaks
    if (!window._passCalculationState) {
      window._passCalculationState = { completed: false };

      const handler = () => {
        window._passCalculationState.completed = true;
        window.removeEventListener("satvis:passCalculationComplete", handler);
      };

      window.addEventListener("satvis:passCalculationComplete", handler);
    } else {
      // Reset completion state for new wait
      window._passCalculationState.completed = false;

      // Re-add listener for next wait
      const handler = () => {
        window._passCalculationState.completed = true;
        window.removeEventListener("satvis:passCalculationComplete", handler);
      };
      window.addEventListener("satvis:passCalculationComplete", handler);
    }
  });

  // Wait for either: event completion, or passes already exist (unless waitForEvent is true)
  await page.waitForFunction(
    (waitForEventOnly) => {
      // Check if the event was fired
      if (window._passCalculationState?.completed) {
        return true;
      }

      // If waitForEvent is true, only wait for the event
      if (waitForEventOnly) {
        return false;
      }

      // Check if no ground station or satellites (nothing to calculate)
      const hasGroundStation = window.cc?.sats?.groundStationAvailable;
      const activeSatellites = window.cc?.sats?.activeSatellites;

      if (!hasGroundStation || !activeSatellites || activeSatellites.length === 0) {
        return true;
      }

      // Check if passes exist for most active satellites (at least 80%)
      // Not all satellites may have passes visible from the ground station
      const satellitesWithPasses = activeSatellites.filter((sat) => {
        return sat?.props?.passes && sat.props.passes.length > 0;
      });

      const passCalculationRate = satellitesWithPasses.length / activeSatellites.length;
      return passCalculationRate >= 0.8;
    },
    waitForEvent,
    { timeout },
  );
}

/**
 * Wait for the application to be ready for interaction
 * This checks that the Cesium viewer is initialized and satellites are loaded
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} options - Options object
 * @param {number} [options.timeout=30000] - Maximum time to wait in milliseconds
 */
export async function waitForAppReady(page, options = {}) {
  const { timeout = 30000 } = options;

  await page.waitForFunction(
    () => {
      // Check that Cesium viewer is initialized
      if (!window.cc?.viewer) {
        return false;
      }

      // Check that scene is ready
      if (!window.cc.viewer.scene) {
        return false;
      }

      // Check that satellites manager exists
      if (!window.cc.sats) {
        return false;
      }

      // Check that initial TLE load is complete
      if (!window.cc.sats._initialTleLoadComplete) {
        return false;
      }

      return true;
    },
    { timeout },
  );
}

/**
 * Perform an action with the globe paused, then optionally resume
 * This is a convenience wrapper for the common pattern of pausing, acting, and resuming
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Function} action - Async function to execute while paused
 * @param {Object} options - Options object
 * @param {boolean} [options.resumeAfter=false] - Whether to resume animation after action completes
 */
export async function withPausedGlobe(page, action, options = {}) {
  const { resumeAfter = false } = options;

  await pauseAnimation(page);

  try {
    await action();
  } finally {
    if (resumeAfter) {
      await resumeAnimation(page);
    }
  }
}

/**
 * Flip camera to opposite side of Earth (180°)
 * Uses the 'z' keyboard shortcut to trigger camera flip
 * Useful when satellite billboard is on far side and not visible
 *
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
export async function flipCameraToOppositeSide(page) {
  await page.keyboard.press("z");
  // Wait for camera to finish repositioning by checking camera state
  await page.waitForFunction(
    () => {
      // Camera flip is complete when the camera is no longer moving
      const viewer = window.cc?.viewer;
      if (!viewer || !viewer.camera) return false;
      // Check if camera is idle (not animating)
      return !viewer.scene.tweens || viewer.scene.tweens.length === 0;
    },
    { timeout: 1000 },
  );
}
