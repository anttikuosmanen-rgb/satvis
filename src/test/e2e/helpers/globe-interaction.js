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
 */
export async function waitForPassCalculation(page, options = {}) {
  const { timeout = 60000 } = options;

  // Wait for the pass calculation complete event
  await page.waitForFunction(
    () => {
      return new Promise((resolve) => {
        // If pass calculation is already complete (no active calculation), resolve immediately
        const hasGroundStation = window.cc?.sats?.groundStationAvailable;
        const activeSatellites = window.cc?.sats?.activeSatellites;

        if (!hasGroundStation || !activeSatellites || activeSatellites.length === 0) {
          resolve(true);
          return;
        }

        // Listen for the completion event
        const handler = () => {
          window.removeEventListener("satvis:passCalculationComplete", handler);
          resolve(true);
        };
        window.addEventListener("satvis:passCalculationComplete", handler);

        // Also check if calculation might have already completed
        // by checking if passes exist for active satellites
        const hasPasses = activeSatellites.some((sat) => {
          return sat?.props?.passes && sat.props.passes.length > 0;
        });

        if (hasPasses) {
          window.removeEventListener("satvis:passCalculationComplete", handler);
          resolve(true);
        }
      });
    },
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
  // Give camera a moment to reposition
  await page.waitForTimeout(100);
}
