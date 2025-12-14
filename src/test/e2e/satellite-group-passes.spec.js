import { test, expect } from "@playwright/test";
import { waitForPassCalculation, pauseAnimation } from "./helpers/globe-interaction.js";

/**
 * E2E Test: Satellite Group Pass Prediction
 *
 * Tests that pass prediction works correctly when loading a satellite group via the group selection feature.
 * Uses the "Stations" group (data/tle/groups/stations.txt with ~24 satellites) to verify:
 * - Satellite group loading via enabledTags URL parameter
 * - Ground station creation by picking on globe
 * - Pass calculation for satellites in the group
 * - Pass data structure and validity
 */

/**
 * Helper to convert JulianDate to Unix timestamp (seconds)
 * @param {Object} julianDate - JulianDate object with dayNumber and secondsOfDay
 * @returns {number} Unix timestamp in seconds
 */
function julianDateToUnixSeconds(julianDate) {
  if (!julianDate) return null;
  // Julian Day 2440587.5 = Unix epoch (Jan 1, 1970 00:00:00 UTC)
  const unixDays = julianDate.dayNumber - 2440587.5;
  return unixDays * 86400 + julianDate.secondsOfDay;
}

/**
 * Helper to get current pass highlights from timeline
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{highlights: Array, passCount: number}>}
 */
async function getPassHighlights(page) {
  return page.evaluate(() => {
    const viewer = window.cc?.viewer;
    if (!viewer || !viewer.timeline) return { highlights: [], passCount: 0 };

    const highlightRanges = viewer.timeline._highlightRanges || [];
    // Pass highlights have priority 0 (_base = 0)
    const passHighlights = highlightRanges.filter((h) => h._base === 0);

    // Helper to convert JulianDate to Unix seconds (inline for page.evaluate)
    const toUnixSeconds = (jd) => {
      if (!jd) return null;
      const unixDays = jd.dayNumber - 2440587.5;
      return unixDays * 86400 + jd.secondsOfDay;
    };

    return {
      highlights: passHighlights.map((h) => ({
        // Note: Cesium highlight ranges use underscore-prefixed private properties
        startSeconds: toUnixSeconds(h._start),
        stopSeconds: toUnixSeconds(h._stop),
        color: h._color?.toCssColorString?.(),
      })),
      passCount: passHighlights.length,
    };
  });
}

/**
 * Helper to advance simulation time by specified hours
 * @param {import('@playwright/test').Page} page
 * @param {number} hours - Number of hours to advance
 */
async function advanceTimeByHours(page, hours) {
  await page.evaluate((hrs) => {
    const viewer = window.cc?.viewer;
    if (!viewer?.clock) return;

    // JulianDate stores time as dayNumber + secondsOfDay
    // Add hours by adding to secondsOfDay (1 hour = 3600 seconds)
    const additionalSeconds = hrs * 3600;

    // Helper to advance a JulianDate by the given seconds
    const advanceJulianDate = (jd) => {
      let newSecondsOfDay = jd.secondsOfDay + additionalSeconds;
      let newDayNumber = jd.dayNumber;

      // Handle day overflow (86400 seconds per day)
      while (newSecondsOfDay >= 86400) {
        newSecondsOfDay -= 86400;
        newDayNumber += 1;
      }
      while (newSecondsOfDay < 0) {
        newSecondsOfDay += 86400;
        newDayNumber -= 1;
      }

      const newTime = jd.clone();
      newTime.dayNumber = newDayNumber;
      newTime.secondsOfDay = newSecondsOfDay;
      return newTime;
    };

    // Advance currentTime, startTime, and stopTime by the same amount
    // This keeps the timeline window centered on the new current time
    viewer.clock.currentTime = advanceJulianDate(viewer.clock.currentTime);
    viewer.clock.startTime = advanceJulianDate(viewer.clock.startTime);
    viewer.clock.stopTime = advanceJulianDate(viewer.clock.stopTime);

    // Update timeline to reflect new bounds
    const timeline = viewer.timeline;
    if (timeline) {
      // Update timeline bounds directly
      timeline.zoomTo(viewer.clock.startTime, viewer.clock.stopTime);
      timeline.updateFromClock();
    }
  }, hours);
}

/**
 * Helper to trigger pass recalculation by simulating user interaction with timeline
 * This dispatches the same event that ClockMonitor emits when a time jump is detected
 * @param {import('@playwright/test').Page} page
 */
async function triggerPassRecalculation(page) {
  // Reset the pass calculation state before triggering
  await page.evaluate(() => {
    if (window._passCalculationState) {
      window._passCalculationState.completed = false;
    }
  });

  // Dispatch the cesium:clockTimeJumped event that ClockMonitor would emit
  // This triggers the same code path as a real user time jump
  await page.evaluate(() => {
    const viewer = window.cc?.viewer;
    if (!viewer) return;

    const currentTime = viewer.clock.currentTime;
    const event = new CustomEvent("cesium:clockTimeJumped", {
      detail: {
        oldTime: currentTime,
        newTime: currentTime,
        jumpSeconds: 86400, // 24 hours
        clockMultiplier: 1,
        timestamp: Date.now(),
      },
    });

    console.log("[Test] Dispatching cesium:clockTimeJumped event");
    window.dispatchEvent(event);
  });

  // Note: The SatelliteManager has a 3-second debounce before triggering recalculation
  // waitForPassCalculation will handle the waiting for the actual calculation to complete
}

test.describe("Satellite Group Pass Prediction", () => {
  test("should load Stations group, create ground station, and calculate passes", async ({ page }) => {
    // Load entire Stations group (all satellites from data/tle/groups/stations.txt)
    // using the group selection feature via the "tags" URL parameter
    await page.goto("/?tags=Stations&hideLight=0&onlyLit=0");

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

    // Pause animation before interacting with UI elements
    await pauseAnimation(page);

    // Create ground station by picking on globe
    const groundStationButton = page
      .locator("button.cesium-toolbar-button")
      .filter({
        has: page.locator(".svg-groundstation"),
      })
      .first();

    await expect(groundStationButton).toBeVisible({ timeout: 5000 });
    await groundStationButton.click();

    // Move mouse away from button to dismiss tooltip
    await page.mouse.move(0, 0);

    // Enable "Pick on globe" checkbox
    const pickOnGlobeLabel = page.locator('label.toolbarSwitch:has-text("Pick on globe")');
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 10000 });

    const pickOnGlobeCheckbox = pickOnGlobeLabel.locator('input[type="checkbox"]');

    // Check if already checked
    const isChecked = await pickOnGlobeCheckbox.isChecked();
    if (!isChecked) {
      await pickOnGlobeLabel.click();
      await expect(pickOnGlobeCheckbox).toBeChecked({ timeout: 3000 });
    }

    // Get Cesium canvas for picking a location on the map
    const canvasBox = await page.evaluate(() => {
      const canvas = document.querySelector("#cesiumContainer canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    expect(canvasBox).not.toBeNull();

    if (canvasBox) {
      // Click on the globe to pick a ground station location
      const clickX = canvasBox.x + canvasBox.width * 0.5;
      const clickY = canvasBox.y + canvasBox.height * 0.5;

      await page.mouse.click(clickX, clickY);

      // Wait for ground station entity to be created
      await page.waitForFunction(
        () => {
          const sats = window.cc?.sats;
          return sats && sats.groundStations && sats.groundStations.length > 0;
        },
        { timeout: 10000 },
      );
    }

    // Verify ground station was created
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

    // Select ground station entity to show info box with pass list
    // Note: We do NOT wait for pass calculation to complete before selection
    // This simulates the real user workflow where they might select the GS
    // before pass calculations finish
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

    // Wait for pass calculation to complete AFTER ground station selection
    // This verifies that highlights eventually appear even if GS was selected
    // before pass calculations finished
    await waitForPassCalculation(page, { timeout: 60000 });

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

  test("should update timeline pass highlights when jumping forward in time", async ({ page }) => {
    // Load Stations group and set up ground station
    await page.goto("/?tags=Stations&hideLight=0&onlyLit=0");

    // Wait for Cesium to be ready
    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for satellites to load
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        if (!sats || sats.length === 0) return false;
        const createdSats = sats.filter((s) => s.created);
        return createdSats.length >= 20;
      },
      { timeout: 30000 },
    );

    // Pause animation
    await pauseAnimation(page);

    // Create ground station by clicking on globe center
    const groundStationButton = page
      .locator("button.cesium-toolbar-button")
      .filter({ has: page.locator(".svg-groundstation") })
      .first();
    await expect(groundStationButton).toBeVisible({ timeout: 5000 });
    await groundStationButton.click();
    await page.mouse.move(0, 0);

    const pickOnGlobeLabel = page.locator('label.toolbarSwitch:has-text("Pick on globe")');
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 10000 });
    const pickOnGlobeCheckbox = pickOnGlobeLabel.locator('input[type="checkbox"]');
    if (!(await pickOnGlobeCheckbox.isChecked())) {
      await pickOnGlobeLabel.click();
    }

    const canvasBox = await page.evaluate(() => {
      const canvas = document.querySelector("#cesiumContainer canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(canvasBox).not.toBeNull();

    await page.mouse.click(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.5);

    // Wait for ground station
    await page.waitForFunction(() => window.cc?.sats?.groundStations?.length > 0, { timeout: 10000 });

    // Set simulation to current time
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date();
        window.cc.viewer.clock.currentTime = window.Cesium.JulianDate.fromDate(testDate);
        window.cc.viewer.clock.shouldAnimate = false;
      }
    });

    // Select ground station to trigger pass calculation
    await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const gs = window.cc?.sats?.groundStations?.[0];
      if (viewer && gs?.components?.Groundstation) {
        viewer.selectedEntity = gs.components.Groundstation;
      }
    });

    // Wait for initial pass calculation
    await waitForPassCalculation(page, { timeout: 60000 });

    // ===== STEP 1: Check initial pass highlights =====
    const initialHighlights = await getPassHighlights(page);
    console.log(`Initial highlights: ${initialHighlights.passCount} passes`);

    expect(initialHighlights.passCount).toBeGreaterThan(0);

    // Store initial highlight times for comparison
    const initialHighlightTimes = new Set(initialHighlights.highlights.map((h) => `${h.startSeconds}-${h.stopSeconds}`));

    // ===== STEP 2: Jump 24 hours forward =====
    console.log("Jumping 24 hours forward...");
    await advanceTimeByHours(page, 24);
    await triggerPassRecalculation(page);

    // Wait for pass recalculation after time jump
    // Use waitForEvent: true because passes already exist - we need to wait for the NEW calculation
    await waitForPassCalculation(page, { timeout: 60000, waitForEvent: true });

    // Get highlights after first 24h jump
    const highlightsAfter24h = await getPassHighlights(page);
    console.log(`After 24h jump: ${highlightsAfter24h.passCount} passes`);

    // Verify we have pass highlights after jump
    expect(highlightsAfter24h.passCount).toBeGreaterThan(0);

    // Check that we have NEW highlights (not the same as initial)
    const after24hHighlightTimes = new Set(highlightsAfter24h.highlights.map((h) => `${h.startSeconds}-${h.stopSeconds}`));

    // Count how many highlights are new (not in initial set)
    let newHighlightsAfter24h = 0;
    for (const time of after24hHighlightTimes) {
      if (!initialHighlightTimes.has(time)) {
        newHighlightsAfter24h++;
      }
    }

    console.log(`New highlights after 24h jump: ${newHighlightsAfter24h} (out of ${highlightsAfter24h.passCount})`);

    // At least some highlights should be new after jumping 24h
    // (passes from 24h ago should no longer be visible in timeline)
    expect(newHighlightsAfter24h).toBeGreaterThan(0);

    // ===== STEP 3: Jump another 24 hours forward (48h total) =====
    console.log("Jumping another 24 hours forward (48h total)...");
    await advanceTimeByHours(page, 24);
    await triggerPassRecalculation(page);

    // Wait for pass recalculation
    // Use waitForEvent: true because passes already exist - we need to wait for the NEW calculation
    await waitForPassCalculation(page, { timeout: 60000, waitForEvent: true });

    // Get highlights after second 24h jump (48h total)
    const highlightsAfter48h = await getPassHighlights(page);
    console.log(`After 48h total: ${highlightsAfter48h.passCount} passes`);

    // Verify we have pass highlights after second jump
    expect(highlightsAfter48h.passCount).toBeGreaterThan(0);

    // Check that we have NEW highlights compared to after first jump
    const after48hHighlightTimes = new Set(highlightsAfter48h.highlights.map((h) => `${h.startSeconds}-${h.stopSeconds}`));

    // Count how many highlights are new compared to after first 24h jump
    let newHighlightsAfter48h = 0;
    for (const time of after48hHighlightTimes) {
      if (!after24hHighlightTimes.has(time)) {
        newHighlightsAfter48h++;
      }
    }

    console.log(`New highlights after 48h (vs 24h): ${newHighlightsAfter48h} (out of ${highlightsAfter48h.passCount})`);

    // At least some highlights should be new after jumping another 24h
    expect(newHighlightsAfter48h).toBeGreaterThan(0);

    // Verify that highlights from 48h later are completely different from initial
    let overlappingWithInitial = 0;
    for (const time of after48hHighlightTimes) {
      if (initialHighlightTimes.has(time)) {
        overlappingWithInitial++;
      }
    }

    console.log(`Highlights at 48h overlapping with initial: ${overlappingWithInitial}`);

    // After 48 hours, most (if not all) highlights should be different from initial
    // The timeline typically shows ~24h of passes, so 48h later should have mostly new passes
    const overlapPercentage = overlappingWithInitial / highlightsAfter48h.passCount;
    expect(overlapPercentage).toBeLessThan(0.5); // Less than 50% overlap expected

    console.log(`Timeline highlight update test completed successfully:
      - Initial highlights: ${initialHighlights.passCount}
      - After 24h: ${highlightsAfter24h.passCount} (${newHighlightsAfter24h} new)
      - After 48h: ${highlightsAfter48h.passCount} (${newHighlightsAfter48h} new vs 24h, ${overlappingWithInitial} overlap with initial)
    `);
  });
});
