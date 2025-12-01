import { test, expect } from "@playwright/test";

/**
 * Debug test to investigate pass prediction issues
 */

test.describe("Ground Station Pass Debug", () => {
  test("should debug TLE data and pass calculation", async ({ page }) => {
    // Capture console logs
    const consoleLogs = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("Initial TLE") ||
        text.includes("showing enabled") ||
        text.includes("Enabled satellites:") ||
        text.includes("Enabled tags:") ||
        text.includes("showEnabledSatellites:") ||
        text.includes("Satellites to show:")
      ) {
        consoleLogs.push(text);
      }
    });

    // Start with ISS and ground station
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");

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

    // Trigger timeline change to force pass calculation
    await page.evaluate(() => {
      if (window.cc?.viewer?.timeline) {
        window.cc.viewer.timeline.updateFromClock();
      }
    });

    // Wait for satellites to be shown (loading spinner disappears when batch processing completes)
    await page.waitForFunction(
      () => {
        const spinner = document.querySelector(".loading-spinner");
        return !spinner || spinner.style.display === "none" || window.getComputedStyle(spinner).display === "none";
      },
      { timeout: 15000 },
    );

    // Wait for passes to be calculated
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        if (!sats || sats.length === 0) return false;
        const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
        return issSat && issSat.props?.passes && issSat.props.passes.length > 0;
      },
      { timeout: 15000 },
    );

    // Get detailed debug info
    const debugInfo = await page.evaluate(() => {
      const sats = window.cc?.sats?.satellites;
      const viewer = window.cc?.viewer;

      if (!sats || sats.length === 0) {
        return { error: "No satellites loaded" };
      }

      // Get all satellite names to see what's available
      const allSatelliteNames = sats.map((s) => s.props?.name);

      // Find ISS by exact name
      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");

      // Find all visible satellites (visible = created, not enabled)
      const visibleSats = sats.filter((s) => s.created);

      if (!issSat) {
        return {
          error: "ISS not found in database",
          availableSatellites: allSatelliteNames.slice(0, 50),
          totalSatellites: sats.length,
          visibleSatelliteCount: visibleSats.length,
          visibleSatellites: visibleSats.map((s) => s.props?.name),
        };
      }

      // Get TLE data
      const tleData = issSat.satRec
        ? {
            epochYear: issSat.satRec.epochyr,
            epochDays: issSat.satRec.epochdays,
            inclination: issSat.satRec.inclo * (180 / Math.PI), // Convert to degrees
            raan: issSat.satRec.nodeo * (180 / Math.PI),
            eccentricity: issSat.satRec.ecco,
            argOfPerigee: issSat.satRec.argpo * (180 / Math.PI),
            meanAnomaly: issSat.satRec.mo * (180 / Math.PI),
            meanMotion: issSat.satRec.no * (1440 / (2 * Math.PI)), // Convert to rev/day
          }
        : null;

      // Get current simulation time
      const currentTime = viewer?.clock?.currentTime;
      const currentTimeStr = currentTime ? currentTime.toString() : null;

      // Try to get JS date - Cesium might be in a different scope
      let currentTimeJS = null;
      try {
        if (currentTime && typeof window.Cesium !== "undefined") {
          currentTimeJS = window.Cesium.JulianDate.toDate(currentTime).toISOString();
        }
      } catch {
        currentTimeJS = "Unable to convert";
      }

      // Get ground station info
      const gs = issSat.props?.groundStations?.[0];
      const gsInfo = gs
        ? {
            lat: gs.position?.latitude,
            lon: gs.position?.longitude,
            name: gs.name,
          }
        : null;

      // Get pass calculation status
      const passes = issSat.props?.passes || [];

      // Get enabled satellites from the store
      const enabledSatellites = window.cc?.sats?.enabledSatellites || [];
      const enabledTags = window.cc?.sats?.enabledTags || [];

      return {
        satelliteName: issSat.props?.name,
        issCreated: issSat.created,
        tleData,
        currentTime: currentTimeStr,
        currentTimeJS: currentTimeJS?.toISOString(),
        groundStation: gsInfo,
        gsAvailable: issSat.props?.groundStationAvailable,
        passCount: passes.length,
        passes: passes.slice(0, 3).map((p) => ({
          name: p.name,
          start: p.start,
          end: p.end,
          maxElevation: p.maxElevation,
        })),
        enabledSatellites,
        enabledTags,
        totalSatellites: sats.length,
        visibleSatelliteCount: visibleSats.length,
        visibleSatellites: visibleSats.map((s) => s.props?.name),
        allSatelliteNames: sats.map((s) => s.props?.name).slice(0, 20), // First 20 for readability
      };
    });

    console.log("=== DEBUG INFO ===");
    console.log(JSON.stringify(debugInfo, null, 2));
    console.log("==================");
    console.log("=== CONSOLE LOGS ===");
    console.log(consoleLogs);
    console.log("====================");

    // Assertions to understand the state
    expect(debugInfo.satelliteName).toBeDefined();
    expect(debugInfo.tleData).toBeDefined();
    expect(debugInfo.gsAvailable).toBe(true);
  });
});
