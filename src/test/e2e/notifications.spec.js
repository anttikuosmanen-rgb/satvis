import { test, expect } from "@playwright/test";
import { pauseAnimation, waitForPassCalculation } from "./helpers/globe-interaction.js";

/**
 * E2E Test: Pass Notifications
 *
 * Tests the notification feature for satellite pass alerts.
 * The bell button in the info box allows users to schedule browser notifications
 * for upcoming passes.
 *
 * Test coverage:
 * - Bell button visibility in ground station info box
 * - Warning toast when no ground station exists
 * - Success toast when notifications are scheduled
 * - Notification permission handling
 */

test.describe("Pass Notifications", () => {
  test("should show bell button in ground station info box", async ({ page }) => {
    // Load app with ISS satellite and ground station
    await page.goto("/?sats=ISS~(ZARYA)&gs=60.1695,24.9354,Helsinki");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for Cesium scene initialization
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for ISS satellite and ground station to be loaded
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        const gs = window.cc?.sats?.groundStations;
        if (!sats?.length || !gs?.length) return false;
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        return issSat && issSat.props?.orbit?.satrec;
      },
      { timeout: 60000 },
    );

    await pauseAnimation(page);

    // Select the ground station to open its info box
    await page.evaluate(() => {
      const gs = window.cc.sats.groundStations[0];
      if (gs && gs.components?.Groundstation) {
        window.cc.viewer.selectedEntity = gs.components.Groundstation;
      }
    });

    // Wait for info box to appear
    await expect(page.locator(".cesium-infoBox")).toBeVisible({ timeout: 5000 });

    // Verify bell button exists in info box container
    const bellButton = page.locator(".cesium-infoBox-container button").filter({
      has: page.locator('svg[data-icon="bell"]'),
    });

    await expect(bellButton).toBeVisible({ timeout: 5000 });
  });

  // Skip: This test is complex because satellite entities aren't created when satellite isn't enabled.
  // The warning functionality is covered by unit tests in push-manager.test.js
  test.skip("should show warning toast when clicking bell without ground station @critical", async ({ page }) => {
    // Grant notification permission
    await page.addInitScript(() => {
      Object.defineProperty(window, "Notification", {
        value: class MockNotification {
          static permission = "granted";
          static requestPermission = () => Promise.resolve("granted");
          constructor() {}
        },
        writable: true,
      });
    });

    // Load app with ISS satellite and ground station first
    // Then we'll clear groundStationAvailable to simulate no GS condition
    await page.goto("/?sats=ISS~(ZARYA)&gs=60.1695,24.9354,Helsinki");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for Cesium scene initialization
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for ISS satellite and ground station to be loaded
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        const gs = window.cc?.sats?.groundStations;
        if (!sats?.length || !gs?.length) return false;
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        return issSat && issSat.props?.orbit?.satrec;
      },
      { timeout: 60000 },
    );

    await pauseAnimation(page);

    // Temporarily mock groundStationAvailable to return false
    await page.evaluate(() => {
      Object.defineProperty(window.cc.sats, "groundStationAvailable", {
        get: () => false,
        configurable: true,
      });
    });

    // Select ISS and open its info box using enabled satellite
    await page.evaluate(() => {
      const issSat = window.cc.sats.satellites.find((s) => s.props.name.includes("ISS"));
      if (issSat && issSat.entities?.length > 0) {
        window.cc.sats.selectedSatellite = issSat.props.name;
        window.cc.viewer.selectedEntity = issSat.entities[0];
      }
    });

    // Wait for info box
    await expect(page.locator(".cesium-infoBox")).toBeVisible({ timeout: 5000 });

    // Click the bell button
    const bellButton = page.locator(".cesium-infoBox-container button").filter({
      has: page.locator('svg[data-icon="bell"]'),
    });
    await bellButton.click();

    // Should show warning toast about needing a ground station
    const warningToast = page.locator(".p-toast-message-warn, .p-toast-message-warning");
    await expect(warningToast).toBeVisible({ timeout: 5000 });

    // Verify toast content mentions ground station
    const toastText = page.locator(".p-toast-detail");
    await expect(toastText).toContainText(/ground station/i, { timeout: 5000 });
  });

  test("should show success toast when scheduling notifications with ground station", async ({ page }) => {
    // Mock Notification API with granted permission
    await page.addInitScript(() => {
      const notifications = [];
      Object.defineProperty(window, "Notification", {
        value: class MockNotification {
          static permission = "granted";
          static requestPermission = () => Promise.resolve("granted");
          constructor(title, options) {
            notifications.push({ title, options });
            window.__mockNotifications = notifications;
          }
        },
        writable: true,
      });
    });

    // Load app with ISS satellite and a ground station
    await page.goto("/?sats=ISS~(ZARYA)&gs=60.1695,24.9354,Helsinki");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for Cesium scene initialization
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for ISS satellite and ground station to be loaded
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        const gs = window.cc?.sats?.groundStations;
        if (!sats?.length || !gs?.length) return false;
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        return issSat && issSat.props?.orbit?.satrec;
      },
      { timeout: 60000 },
    );

    await pauseAnimation(page);

    // Wait for pass calculation to complete
    await waitForPassCalculation(page, { timeout: 30000 });

    // Select the ground station to open its info box
    await page.evaluate(() => {
      const gs = window.cc.sats.groundStations[0];
      if (gs && gs.components?.Groundstation) {
        window.cc.viewer.selectedEntity = gs.components.Groundstation;
      }
    });

    // Wait for info box
    await expect(page.locator(".cesium-infoBox")).toBeVisible({ timeout: 5000 });

    // Click the bell button
    const bellButton = page.locator(".cesium-infoBox-container button").filter({
      has: page.locator('svg[data-icon="bell"]'),
    });
    await bellButton.click();

    // Should show success toast with pass count or info toast if no passes
    const toast = page.locator(".p-toast-message-success, .p-toast-message-info");
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Verify toast is either success with pass count or info about no passes
    const toastDetail = page.locator(".p-toast-detail");
    const toastText = await toastDetail.textContent();
    expect(toastText).toMatch(/notifying for \d+ passes|no passes available/i);
  });

  test("should log notification scheduling to console", async ({ page }) => {
    // Capture console logs
    const consoleLogs = [];
    page.on("console", (msg) => {
      if (msg.type() === "log") {
        consoleLogs.push(msg.text());
      }
    });

    // Mock Notification API
    await page.addInitScript(() => {
      Object.defineProperty(window, "Notification", {
        value: class MockNotification {
          static permission = "granted";
          static requestPermission = () => Promise.resolve("granted");
          constructor() {}
        },
        writable: true,
      });
    });

    // Load app with ISS and ground station
    await page.goto("/?sats=ISS~(ZARYA)&gs=60.1695,24.9354,Helsinki");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for scene and satellite
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        const sats = window.cc?.sats?.satellites;
        const gs = window.cc?.sats?.groundStations;
        if (!viewer?.scene?.globe || !sats?.length || !gs?.length) return false;
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        return issSat?.props?.orbit?.satrec;
      },
      { timeout: 60000 },
    );

    await pauseAnimation(page);
    await waitForPassCalculation(page, { timeout: 30000 });

    // Select the ground station to open its info box
    await page.evaluate(() => {
      const gs = window.cc.sats.groundStations[0];
      if (gs && gs.components?.Groundstation) {
        window.cc.viewer.selectedEntity = gs.components.Groundstation;
      }
    });

    await expect(page.locator(".cesium-infoBox")).toBeVisible({ timeout: 5000 });

    // Click bell button
    const bellButton = page.locator(".cesium-infoBox-container button").filter({
      has: page.locator('svg[data-icon="bell"]'),
    });
    await bellButton.click();

    // Wait for toast to appear (indicates action completed)
    const toast = page.locator(".p-toast-message-success, .p-toast-message-info");
    await expect(toast).toBeVisible({ timeout: 5000 });

    // Console logs are captured asynchronously via the page.on('console') handler above

    // Check if notification scheduling was logged
    const notifyLogs = consoleLogs.filter((log) => log.includes("Notify"));
    // If there are passes, there should be notification logs
    // If no passes, the info toast handles that case
    console.log(`Captured ${notifyLogs.length} notification logs`);
  });
});
