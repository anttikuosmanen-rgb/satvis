import { test, expect } from "@playwright/test";
import { waitForPassCalculation } from "./helpers/globe-interaction.js";

/**
 * E2E Test: Satellite Group Pass Prediction
 *
 * Tests that pass prediction works correctly when loading a satellite group via the group selection feature.
 * Uses the "Stations" group (data/tle/groups/stations.txt with ~24 satellites) to verify:
 * - Satellite group loading via enabledTags URL parameter
 * - Ground station creation via URL parameter
 * - Pass calculation for satellites in the group
 * - Pass data structure and validity
 */

test.describe("Satellite Group Pass Prediction", () => {
  test("should load Stations group, create ground station, and calculate passes", async ({ page }) => {
    // Load entire Stations group (all satellites from data/tle/groups/stations.txt)
    // using the group selection feature via the "tags" URL parameter
    await page.goto("/?tags=Stations&gs=48.1351,11.5820,Munich&hideLight=0&onlyLit=0");

    // Wait for Cesium canvas to be visible
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for Cesium scene to be fully rendered
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for Stations group satellites to be created/enabled
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        if (!sats || sats.length === 0) return false;

        // Check if satellites from Stations group are created (visible)
        const createdSats = sats.filter((s) => s.created);

        // Stations group has ~24 satellites
        return createdSats.length >= 20;
      },
      { timeout: 30000 },
    );

    // Verify Stations group satellites are enabled
    const satelliteStatus = await page.evaluate(() => {
      const sats = window.cc?.sats?.satellites;
      if (!sats || sats.length === 0) return { loaded: false, totalCount: 0, enabledCount: 0, error: "No satellites loaded" };

      // Check for satellites from Stations group that are CREATED (have components rendered)
      const enabledSats = sats.filter((s) => s.created);
      const issSat = enabledSats.find((s) => s.props?.name?.includes("ISS"));
      const cssSat = enabledSats.find((s) => s.props?.name?.includes("CSS"));

      return {
        loaded: sats.length > 0,
        totalCount: sats.length,
        enabledCount: enabledSats.length,
        hasISS: !!issSat,
        hasCSS: !!cssSat,
        enabledSatelliteNames: enabledSats.map((s) => s.props?.name),
      };
    });

    // Verify satellites from Stations group are enabled (should be ~24 satellites)
    expect(satelliteStatus.loaded).toBe(true);
    expect(satelliteStatus.enabledCount).toBeGreaterThanOrEqual(20);
    expect(satelliteStatus.enabledCount).toBeLessThanOrEqual(30);
    expect(satelliteStatus.hasISS).toBe(true); // ISS should be in Stations group
    expect(satelliteStatus.hasCSS).toBe(true); // CSS should be in Stations group

    // Verify ground station was created from URL parameter
    const groundStationStatus = await page.evaluate(() => {
      const sats = window.cc?.sats;
      if (!sats) return { found: false, error: "SatelliteManager not found" };

      const gs = sats.groundStations?.[0];
      const gsAvailable = sats.groundStationAvailable;

      return {
        found: !!(gs && gsAvailable),
        available: gsAvailable,
        count: sats.groundStations?.length || 0,
        groundStation: gs
          ? {
              lat: gs.position?.latitude,
              lon: gs.position?.longitude,
              name: gs.name,
            }
          : null,
      };
    });

    // Verify ground station exists
    expect(groundStationStatus.found).toBe(true);
    expect(groundStationStatus.available).toBe(true);
    expect(groundStationStatus.count).toBe(1);
    expect(groundStationStatus.groundStation?.name).toBe("Munich");

    // Check initial timeline highlights (before pass calculation)
    const initialHighlights = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer || !viewer.timeline) return { found: false, count: 0 };

      const highlightRanges = viewer.timeline._highlightRanges || [];
      return {
        found: highlightRanges.length > 0,
        count: highlightRanges.length,
      };
    });

    // Timeline should have highlights (at minimum day/night cycles)
    expect(initialHighlights.found).toBe(true);
    expect(initialHighlights.count).toBeGreaterThan(0);

    // Set simulation time to current date for fresh TLE data
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date();
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);
        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false;
      }
    });

    // Trigger timeline update to force pass calculation
    await page.evaluate(() => {
      if (window.cc?.viewer?.timeline) {
        window.cc.viewer.timeline.updateFromClock();
      }
    });

    // Wait for pass calculation to complete
    await waitForPassCalculation(page, { timeout: 60000 });

    // Select ground station entity to show info box with pass list
    const selectionResult = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const sats = window.cc?.sats;
      if (!viewer || !sats) return { success: false, error: "No viewer or sats" };

      // Get ground station from SatelliteManager
      const gs = sats.groundStations?.[0];
      if (!gs) return { success: false, error: "No ground station found" };

      // Get the Cesium entity from the ground station
      const gsEntity = gs.components?.Groundstation;
      if (!gsEntity) return { success: false, error: "Ground station entity not found in components" };

      // Select the entity
      viewer.selectedEntity = gsEntity;

      return {
        success: true,
        entityName: gsEntity.name,
        hasDescription: !!gsEntity.description,
        selectedEntityName: viewer.selectedEntity?.name,
      };
    });

    if (!selectionResult.success) {
      console.log("Ground station selection failed:", JSON.stringify(selectionResult, null, 2));
    }
    expect(selectionResult.success).toBe(true);
    expect(selectionResult.hasDescription).toBe(true);

    // Wait for Cesium info box to become visible
    await page.waitForFunction(
      () => {
        const infoBox = document.querySelector(".cesium-infoBox");
        if (!infoBox) return false;

        // Check if info box is visible
        const computed = window.getComputedStyle(infoBox);
        return computed.display !== "none" && computed.visibility !== "hidden";
      },
      { timeout: 10000 },
    );

    // Verify passes are shown in the info box content
    const infoBoxContent = await page.evaluate(() => {
      const iframe = document.querySelector(".cesium-infoBox-iframe");
      if (!iframe || !iframe.contentDocument) return { found: false, error: "Info box iframe not found" };

      const body = iframe.contentDocument.body;
      const text = body.textContent || body.innerText;

      // Check if pass information is displayed
      const hasPassInfo = text.includes("pass") || text.includes("Pass") || text.includes("elevation");

      return {
        found: hasPassInfo,
        preview: text.substring(0, 200),
      };
    });

    expect(infoBoxContent.found).toBe(true);

    // Check detailed timeline highlight data after ground station is selected
    const passHighlightsAfterSelection = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer || !viewer.timeline) return { found: false, passCount: 0, totalCount: 0 };

      const highlightRanges = viewer.timeline._highlightRanges || [];

      // Pass highlights have priority 0 (_base = 0)
      // Day/night highlights have priority -1 (_base = -1)
      const passSpecificHighlights = highlightRanges.filter((h) => h._base === 0);

      return {
        found: passSpecificHighlights.length > 0,
        passCount: passSpecificHighlights.length,
        totalCount: highlightRanges.length,
        sampleHighlights: passSpecificHighlights.slice(0, 3).map((h) => ({
          start: h.start?.toString(),
          stop: h.stop?.toString(),
          color: h.color?.toCssColorString?.(),
        })),
      };
    });

    // Verify pass-specific highlights exist after ground station selection
    expect(passHighlightsAfterSelection.found).toBe(true);
    expect(passHighlightsAfterSelection.passCount).toBeGreaterThan(0);
    expect(passHighlightsAfterSelection.totalCount).toBeGreaterThan(passHighlightsAfterSelection.passCount); // Should have both pass and day/night highlights

    // Verify passes were calculated for satellites in the group
    const passData = await page.evaluate(() => {
      const sats = window.cc?.sats?.satellites;
      if (!sats || sats.length === 0) return { found: false, error: "No satellites" };

      // Count only ENABLED satellites (from Stations group) with passes
      const enabledSats = sats.filter((s) => s.created);
      const satellitesWithPasses = enabledSats.filter((s) => s.props?.passes && s.props.passes.length > 0);

      // Get detailed pass info from first satellite with passes
      const firstSatWithPasses = satellitesWithPasses[0];
      const samplePasses = firstSatWithPasses?.props?.passes?.slice(0, 3).map((p) => ({
        name: p.name,
        start: p.start,
        end: p.end,
        maxElevation: p.maxElevation,
        azimuth: p.azimuth,
      }));

      return {
        found: satellitesWithPasses.length > 0,
        satellitesWithPassesCount: satellitesWithPasses.length,
        enabledSatellitesCount: enabledSats.length,
        totalSatellites: sats.length,
        firstSatelliteName: firstSatWithPasses?.props?.name,
        firstSatellitePassCount: firstSatWithPasses?.props?.passes?.length || 0,
        samplePasses,
        satelliteNamesWithPasses: satellitesWithPasses.map((s) => s.props?.name),
      };
    });

    // Verify passes were calculated for MOST (but not necessarily all) satellites in the group
    expect(passData.found).toBe(true);
    expect(passData.satellitesWithPassesCount).toBeGreaterThan(0);

    // Most satellites in the group should have passes (at least 50%)
    const passCalculationRate = passData.satellitesWithPassesCount / passData.enabledSatellitesCount;
    expect(passCalculationRate).toBeGreaterThanOrEqual(0.5);

    // Verify pass data structure is valid
    if (passData.samplePasses && passData.samplePasses.length > 0) {
      const firstPass = passData.samplePasses[0];

      // Verify pass has required properties
      expect(firstPass.start).toBeDefined();
      expect(firstPass.end).toBeDefined();
      expect(firstPass.maxElevation).toBeDefined();

      // Verify pass times are valid dates
      expect(new Date(firstPass.start).getTime()).toBeGreaterThan(0);
      expect(new Date(firstPass.end).getTime()).toBeGreaterThan(0);

      // Verify end time is after start time
      expect(new Date(firstPass.end).getTime()).toBeGreaterThan(new Date(firstPass.start).getTime());

      // Verify elevation is in valid range (0-90 degrees)
      expect(firstPass.maxElevation).toBeGreaterThanOrEqual(0);
      expect(firstPass.maxElevation).toBeLessThanOrEqual(90);
    }

    // Log summary for debugging
    console.log(`Pass calculation summary for Stations group:
      - Total satellites in database: ${passData.totalSatellites}
      - Enabled satellites (Stations group): ${passData.enabledSatellitesCount}
      - Satellites with passes: ${passData.satellitesWithPassesCount}
      - Pass calculation rate: ${(passCalculationRate * 100).toFixed(1)}%
      - First satellite: ${passData.firstSatelliteName} (${passData.firstSatellitePassCount} passes)
      - Satellites with passes: ${passData.satelliteNamesWithPasses?.slice(0, 5).join(", ")}${passData.satelliteNamesWithPasses?.length > 5 ? "..." : ""}
    `);
  });
});
