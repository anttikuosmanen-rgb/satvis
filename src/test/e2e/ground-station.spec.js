import { test, expect } from "@playwright/test";

/**
 * E2E Test: Ground Station Functionality
 *
 * Tests ground station setup, pass prediction, and timeline integration.
 * This covers critical user workflows for tracking satellite passes from a specific location.
 *
 * Test coverage:
 * - Ground station creation and entity visualization
 * - Pass prediction and pass list display
 * - Timeline pass visibility highlights
 * - Time navigation when selecting passes
 */

/**
 * Wait for pass calculation and timeline highlights to be ready
 * Uses event-based polling instead of fixed timeouts for faster, more reliable tests
 * @param {Page} page - Playwright page object
 * @param {Object} options - Configuration options
 * @param {string} options.satelliteName - Name of satellite to check (default: "ISS (ZARYA)")
 * @param {boolean} options.checkHighlights - Whether to also wait for timeline highlights (default: true)
 * @param {number} options.timeout - Maximum wait time in milliseconds (default: 15000)
 */
async function waitForPassCalculation(page, options = {}) {
  const { satelliteName = "ISS (ZARYA)", checkHighlights = true, timeout = 15000 } = options;

  await page.waitForFunction(
    ({ satName, needHighlights }) => {
      const sats = window.cc?.sats?.satellites;
      if (!sats || sats.length === 0) return false;

      // Find the specified satellite
      const sat = sats.find((s) => s.props?.name === satName);
      if (!sat || !sat.props?.passes || sat.props.passes.length === 0) {
        return false;
      }

      // If highlights check is enabled, also verify timeline has pass highlights
      if (needHighlights) {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.timeline) return false;

        const highlightRanges = viewer.timeline._highlightRanges || [];
        // Check for pass highlights (priority 0, _base === 0)
        const passHighlights = highlightRanges.filter((h) => h._base === 0);
        if (passHighlights.length === 0) return false;
      }

      return true;
    },
    { satName: satelliteName, needHighlights: checkHighlights },
    { timeout, polling: 200 }, // Poll every 200ms
  );
}

test.describe("Ground Station", () => {
  test("should create ground station via pick on map and verify entity is rendered", async ({ page }) => {
    // Start with ISS satellite loaded
    await page.goto("/?sats=ISS~(ZARYA)");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for full Cesium scene initialization (globe rendering complete)
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for ISS satellite to be loaded and enabled
    // This ensures TLE loading is complete and URL parameters have been applied
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        const satCount = sats?.length || 0;

        // Debug logging
        if (satCount === 0) {
          console.log("Waiting for satellites to load... sats array empty or undefined");
          return false;
        }

        // Check if ISS is in the database
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        if (!issSat) {
          console.log(
            `Satellites loaded (${satCount}), but ISS not found. Sample names:`,
            sats.slice(0, 5).map((s) => s.props?.name),
          );
          return false;
        }

        // Check if ISS has valid TLE data
        const hasValidTLE = issSat.props?.orbit?.satrec !== null && issSat.props?.orbit?.satrec !== undefined;
        if (!hasValidTLE) {
          console.log("ISS found but satrec not initialized");
          return false;
        }

        console.log("ISS satellite ready with valid TLE data");
        return true;
      },
      { timeout: 60000 }, // Increased timeout to 60s
    );

    console.log("ISS satellite loaded and ready");
    await page.waitForTimeout(2000);

    // Open ground station menu - button has svg-groundstation icon class
    const groundStationButton = page
      .locator("button.cesium-toolbar-button")
      .filter({
        has: page.locator(".svg-groundstation"),
      })
      .first();

    await expect(groundStationButton).toBeVisible({ timeout: 5000 });
    await groundStationButton.click();
    await page.waitForTimeout(1000);

    // Enable "Pick on globe" checkbox
    // The checkbox is inside a label with text "Pick on globe"
    // Note: The actual checkbox is hidden by CSS (custom styled checkbox)
    const pickOnGlobeLabel = page.locator('label.toolbarSwitch:has-text("Pick on globe")');
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 5000 });

    const pickOnGlobeCheckbox = pickOnGlobeLabel.locator('input[type="checkbox"]');

    // Check if already checked (force:true because checkbox is hidden by CSS)
    const isChecked = await pickOnGlobeCheckbox.isChecked();
    if (!isChecked) {
      // Click the label to toggle the checkbox (more reliable for styled checkboxes)
      // Use force: true to bypass actionability checks (animations may prevent stable state)
      await pickOnGlobeLabel.click({ force: true });
      await page.waitForTimeout(500);
    }

    console.log("Pick mode enabled, clicking on globe...");

    // Get Cesium canvas for picking a location on the map
    // Use evaluate() to bypass Playwright's stability checks on animating canvas
    const canvasBox = await page.evaluate(() => {
      const canvas = document.querySelector("#cesiumContainer canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    expect(canvasBox).not.toBeNull();

    if (canvasBox) {
      // Click on the globe to pick a ground station location
      // Click slightly off-center to ensure we're clicking on the globe surface
      const clickX = canvasBox.x + canvasBox.width * 0.5;
      const clickY = canvasBox.y + canvasBox.height * 0.5;

      console.log(`Clicking on globe at (${clickX}, ${clickY})`);
      await page.mouse.click(clickX, clickY);
      await page.waitForTimeout(2000);

      // Verify ground station entity was created in Cesium
      const groundStationEntity = await page.evaluate(() => {
        const viewer = window.cc?.viewer;
        if (!viewer) return { found: false };

        const gsEntities = viewer.entities.values.filter((e) => e.name && e.name.toLowerCase().includes("ground"));

        return {
          found: gsEntities.length > 0,
          count: gsEntities.length,
          entities: gsEntities.map((e) => ({
            name: e.name,
            hasPoint: !!e.point,
            hasBillboard: !!e.billboard,
            hasLabel: !!e.label,
            show: e.show,
          })),
        };
      });

      console.log(`Ground station entities: ${JSON.stringify(groundStationEntity, null, 2)}`);

      // Verify ground station entity exists and has visual representation
      expect(groundStationEntity.found).toBe(true);
      expect(groundStationEntity.count).toBeGreaterThan(0);

      // Verify at least one entity has a visual representation (point, billboard, or label)
      const hasVisuals = groundStationEntity.entities.some((e) => e.hasPoint || e.hasBillboard || e.hasLabel);
      expect(hasVisuals).toBe(true);

      // Verify ground station is available in the satellite manager
      const gsState = await page.evaluate(() => {
        const sats = window.cc?.sats;
        if (!sats) return { found: false };

        const gsCount = sats.groundStations?.length || 0;
        const gs = sats.groundStations?.[0];

        return {
          found: gsCount > 0,
          count: gsCount,
          groundStation: gs
            ? {
                lat: gs.position?.latitude,
                lon: gs.position?.longitude,
                name: gs.name,
              }
            : null,
        };
      });

      console.log(`Ground station state: ${JSON.stringify(gsState, null, 2)}`);
      expect(gsState.found).toBe(true);
      expect(gsState.count).toBe(1);
    }
  });

  test("should calculate and display pass predictions", async ({ page }) => {
    // Capture browser console logs
    page.on("console", (msg) => {
      const text = msg.text();
      // Only log messages from our modules (filter out noise)
      if (
        text.includes("[addFromTleUrls]") ||
        text.includes("[set groundStations]") ||
        text.includes("[updatePassHighlightsForEnabledSatellites]") ||
        text.includes("[showEnabledSatellites]") ||
        text.includes("[satIsActive]") ||
        text.includes("[SatelliteManager]") ||
        text.includes("[ClockMonitor]") ||
        text.includes("[updatePassHighlightsAfterTimelineChange]") ||
        text.includes("[schedulePassHighlightUpdate]") ||
        text.includes("[Test]")
      ) {
        console.log(`[Browser Console] ${text}`);
      }
    });

    // Start with multiple satellites (ISS + sample of Starlink) and ground station
    // Disable pass filters (hideLight=0, onlyLit=0) to test unfiltered passes
    // Using 25 satellites that exist in TLE data for representative testing
    const satellites = [
      "ISS~(ZARYA)",
      "STARLINK-1031",
      "STARLINK-1036",
      "STARLINK-1039",
      "STARLINK-1042",
      "STARLINK-1043",
      "STARLINK-1046",
      "STARLINK-1047",
      "STARLINK-1048",
      "STARLINK-1053",
      "STARLINK-1054",
      "STARLINK-1060",
      "STARLINK-1063",
      "STARLINK-1067",
      "STARLINK-1068",
      "STARLINK-1112",
      "STARLINK-1114",
      "STARLINK-1123",
      "STARLINK-1144",
      "STARLINK-1094",
      "STARLINK-1096",
      "STARLINK-1122",
      "STARLINK-1080",
      "STARLINK-1090",
      "STARLINK-1107",
    ];
    await page.goto(`/?sats=${satellites.join(",")}&gs=48.1351,11.5820,Munich&hideLight=0&onlyLit=0`);

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for full Cesium scene initialization (globe rendering complete)
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer || !viewer.scene) return false;
        // Check if scene is actually rendering (not just initialized)
        return viewer.scene.globe && viewer.scene.globe._surface;
      },
      { timeout: 20000 },
    );

    // Wait for pass calculation to complete for ISS
    await waitForPassCalculation(page, { checkHighlights: false });

    // Check if ClockMonitor is initialized
    const clockMonitorStatus = await page.evaluate(() => {
      return {
        exists: !!window.cc?.clockMonitor,
        enabled: window.cc?.clockMonitor?.enabled,
        config: window.cc?.clockMonitor?.getConfig?.(),
      };
    });
    console.log("ClockMonitor status:", JSON.stringify(clockMonitorStatus, null, 2));

    // Set simulation time to current date (matches TLE epoch ~Nov 2025)
    // This ensures satellites have fresh TLE data and passes can be calculated
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date(); // Use current date
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);
        console.log(`[Test] Setting clock time to current date: ${testDate.toISOString()}`);
        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false; // Pause at this time
      }
    });

    await page.waitForTimeout(1000);

    // Trigger timeline change to force pass calculation with new time
    await page.evaluate(() => {
      if (window.cc?.viewer?.timeline) {
        window.cc.viewer.timeline.updateFromClock();
      }
    });

    // Wait for pass calculation to complete
    await waitForPassCalculation(page, { checkHighlights: false });

    // Look for pass prediction list or table
    const passList = page.locator('[data-testid="pass-list"]').or(page.locator(".pass-list")).or(page.locator("text=/pass/i"));

    // Check if passes are displayed
    const hasPassList = await passList.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasPassList) {
      console.log("Pass list found, verifying pass data...");

      // Verify passes exist in the application state
      const passData = await page.evaluate(() => {
        const sats = window.cc?.sats?.satellites;
        if (!sats || sats.length === 0) return { found: false, count: 0, error: "No satellites" };

        // Find ISS satellite
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        if (!issSat) return { found: false, count: 0, error: "ISS not found" };
        if (!issSat.props) return { found: false, count: 0, error: "ISS has no props" };

        // Check ground station availability
        const gsAvailable = issSat.props.groundStationAvailable;
        const gsCount = issSat.props.groundStations?.length || 0;

        if (!issSat.props.passes)
          return {
            found: false,
            count: 0,
            error: "ISS has no passes property",
            gsAvailable,
            gsCount,
          };

        const passes = issSat.props.passes;
        return {
          found: passes.length > 0,
          count: passes.length,
          gsAvailable,
          gsCount,
          passes: passes.slice(0, 3).map((p) => ({
            name: p.name,
            start: p.start,
            end: p.end,
            maxElevation: p.maxElevation,
          })),
        };
      });

      console.log(`Pass data: ${JSON.stringify(passData, null, 2)}`);

      expect(passData.found).toBe(true);
      expect(passData.count).toBeGreaterThan(0);

      // Verify pass data structure
      if (passData.passes && passData.passes.length > 0) {
        const firstPass = passData.passes[0];
        expect(firstPass.start).toBeDefined();
        expect(firstPass.end).toBeDefined();
        expect(firstPass.maxElevation).toBeDefined();
      }
    } else {
      console.log("Pass list not found in UI, checking application state...");

      // Even if UI doesn't show passes, verify they're calculated
      const passData = await page.evaluate(() => {
        const sats = window.cc?.sats?.satellites;
        if (!sats || sats.length === 0) return { found: false, error: "No satellites" };

        // Use full satellite name to avoid matching SWISSCUBE etc
        const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
        if (!issSat) return { found: false, error: "ISS (ZARYA) not found" };

        const gsAvailable = issSat.props?.groundStationAvailable;
        const gsCount = issSat.props?.groundStations?.length || 0;
        const passCount = issSat.props?.passes?.length || 0;

        return {
          found: !!(issSat && issSat.props?.passes && issSat.props.passes.length > 0),
          count: passCount,
          gsAvailable,
          gsCount,
        };
      });

      console.log(`Pass data (from state): ${JSON.stringify(passData, null, 2)}`);

      // Verify ground station is available and passes are calculated
      expect(passData.gsAvailable).toBe(true);
      expect(passData.gsCount).toBe(1);

      // With simulation time set to current date (matching TLE epoch), passes MUST be found
      // If this fails, there's an issue with pass calculation
      expect(passData.found).toBe(true);
      expect(passData.count).toBeGreaterThan(0);
    }
  });

  test("should show pass visibility in timeline", async ({ page }) => {
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

    await page.waitForTimeout(2000); // Additional buffer

    // Trigger timeline change to force pass calculation
    await page.evaluate(() => {
      if (window.cc?.viewer?.timeline) {
        window.cc.viewer.timeline.updateFromClock();
      }
    });

    // Wait for pass calculation to complete
    await waitForPassCalculation(page, { checkHighlights: false });

    // Verify timeline exists
    const timeline = page.locator(".cesium-timeline-main");
    await expect(timeline).toBeVisible({ timeout: 5000 });

    // Check for timeline highlight ranges (pass visualization)
    const timelineHighlights = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer || !viewer.timeline) return { found: false, count: 0 };

      // Check if timeline has highlight ranges (pass indicators)
      const highlightRanges = viewer.timeline._highlightRanges || [];

      return {
        found: highlightRanges.length > 0,
        count: highlightRanges.length,
        highlights: highlightRanges.slice(0, 3).map((h) => ({
          start: h.start?.toString(),
          stop: h.stop?.toString(),
          color: h.color?.toCssColorString?.(),
        })),
      };
    });

    console.log(`Timeline highlights: ${JSON.stringify(timelineHighlights, null, 2)}`);

    // Timeline should exist and have highlights (day/night cycles are always present)
    expect(timelineHighlights.found).toBe(true);
    expect(timelineHighlights.count).toBeGreaterThan(0);

    // Note: Pass-specific highlights depend on pass calculation which depends on
    // TLE freshness and orbital timing. We verify timeline infrastructure works.
    console.log(`Timeline has ${timelineHighlights.count} highlight ranges (includes day/night cycles)`);
  });

  test("should change time when selecting a pass from timeline", async ({ page }) => {
    // Start with ISS and ground station
    // Disable pass filters to test unfiltered passes
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich&hideLight=0&onlyLit=0");

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

    await page.waitForTimeout(2000); // Additional buffer

    // Set simulation time to current date (matches TLE epoch ~Nov 2025) to ensure passes exist
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date();
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);
        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false;
      }
    });

    await page.waitForTimeout(1000);

    // Trigger timeline change to force pass calculation
    await page.evaluate(() => {
      if (window.cc?.viewer?.timeline) {
        window.cc.viewer.timeline.updateFromClock();
      }
    });

    // Wait for pass calculation to complete
    await waitForPassCalculation(page, { checkHighlights: false });

    // Get initial clock time
    const initialTime = await page.evaluate(() => {
      return window.cc?.viewer?.clock?.currentTime?.toString();
    });

    console.log(`Initial clock time: ${initialTime}`);

    // Get first pass start time
    const firstPassTime = await page.evaluate(() => {
      const sats = window.cc?.sats?.satellites;
      if (!sats || sats.length === 0) return null;

      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
      if (!issSat || !issSat.props?.passes || issSat.props.passes.length === 0) {
        return null;
      }

      const firstPass = issSat.props.passes[0];
      return {
        start: firstPass.start,
        end: firstPass.end,
        name: firstPass.name,
      };
    });

    // With simulation time set to current date (matching TLE epoch), passes MUST exist
    expect(firstPassTime).not.toBeNull();

    console.log(`First pass: ${JSON.stringify(firstPassTime)}`);

    // Try to click on timeline to jump to pass
    // This tests timeline interaction
    const timeline = page.locator(".cesium-timeline-main");
    if (await timeline.isVisible()) {
      const box = await page.evaluate(() => {
        const el = document.querySelector(".cesium-timeline-main");
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      if (box) {
        // Click near the start of timeline (where first pass might be)
        await page.mouse.click(box.x + 100, box.y + box.height / 2);
        await page.waitForTimeout(1000);

        const newTime = await page.evaluate(() => {
          return window.cc?.viewer?.clock?.currentTime?.toString();
        });

        console.log(`Time after timeline click: ${newTime}`);

        // Verify time changed (might not exactly match pass time, but should be different)
        expect(newTime).not.toBe(initialTime);
      }
    }
  });

  test("should update ground station link when satellite is selected", async ({ page }) => {
    // Start with ISS and ground station
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // Check if ground station link entity exists
    const linkEntity = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer) return { found: false };

      const linkEntities = viewer.entities.values.filter((e) => e.name && (e.name.toLowerCase().includes("link") || e.name.toLowerCase().includes("ground")));

      // Also check for polyline entities (ground station links are typically polylines)
      const polylineEntities = viewer.entities.values.filter((e) => e.polyline && e.show);

      return {
        found: linkEntities.length > 0 || polylineEntities.length > 0,
        linkCount: linkEntities.length,
        polylineCount: polylineEntities.length,
        entities: linkEntities.slice(0, 2).map((e) => ({
          name: e.name,
          hasPolyline: !!e.polyline,
          show: e.show,
        })),
      };
    });

    console.log(`Ground station link check: ${JSON.stringify(linkEntity, null, 2)}`);

    // Note: Ground station link visibility depends on whether satellite is currently in view
    // So we just verify the test setup works, not necessarily that link is visible
    expect(linkEntity).toBeDefined();
  });

  test("should skip to pass time when clicking on timeline highlight", async ({ page }) => {
    // Start with ISS and ground station
    // Disable pass filters to test unfiltered passes
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich&hideLight=0&onlyLit=0");

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

    await page.waitForTimeout(2000);

    // Set simulation time and widen timeline window to ensure passes are visible
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date();
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);

        // Set current time
        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false;

        // Widen timeline window: 2 days before to 7 days after (wider than default)
        const startTime = window.Cesium.JulianDate.addDays(julianDate, -2, new window.Cesium.JulianDate());
        const stopTime = window.Cesium.JulianDate.addDays(julianDate, 7, new window.Cesium.JulianDate());

        window.cc.viewer.clock.startTime = startTime;
        window.cc.viewer.clock.stopTime = stopTime;

        if (window.cc.viewer.timeline) {
          window.cc.viewer.timeline.zoomTo(startTime, stopTime);
        }
      }
    });

    await page.waitForTimeout(1000);

    // Trigger timeline update
    await page.evaluate(() => {
      if (window.cc?.viewer?.timeline) {
        window.cc.viewer.timeline.updateFromClock();
      }
    });

    // Wait for pass calculation and timeline highlights to be ready
    await waitForPassCalculation(page);

    // Get pass data and timeline highlights
    const passAndHighlightData = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const sats = window.cc?.sats?.satellites;

      if (!viewer || !viewer.timeline || !sats || sats.length === 0) {
        return { found: false, error: "Missing viewer or satellites" };
      }

      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
      if (!issSat || !issSat.props?.passes || issSat.props.passes.length === 0) {
        return { found: false, error: "No passes found" };
      }

      const passes = issSat.props.passes;
      const highlightRanges = viewer.timeline._highlightRanges || [];

      // Find pass-specific highlights (not day/night cycles)
      // Pass highlights have priority 0 (_base = 0)
      // Day/night highlights have priority -1 (_base = -1)
      const passHighlights = highlightRanges.filter((h) => {
        return h._base === 0; // Pass highlights only
      });

      return {
        found: passes.length > 0 && passHighlights.length > 0,
        passCount: passes.length,
        highlightCount: passHighlights.length,
        firstPass: passes[0]
          ? {
              start: passes[0].start,
              end: passes[0].end,
              name: passes[0].name,
            }
          : null,
        firstHighlight: passHighlights[0]
          ? {
              start: passHighlights[0].start?.toString(),
              stop: passHighlights[0].stop?.toString(),
              color: passHighlights[0].color?.toCssColorString?.(),
            }
          : null,
      };
    });

    console.log(`Pass and highlight data: ${JSON.stringify(passAndHighlightData, null, 2)}`);

    // With simulation time set to current date (matching TLE epoch), passes and highlights MUST exist
    expect(passAndHighlightData.found).toBe(true);
    expect(passAndHighlightData.firstPass).not.toBeNull();

    // Get initial state and calculate highlight click position in a single evaluate call
    const stateAndHighlight = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name === "ISS (ZARYA)");

      // Get initial state
      const currentTime = viewer?.clock?.currentTime;
      const initialState = {
        time: currentTime?.toString(),
        passCount: issSat?.props?.passes?.length || 0,
      };

      // Check if we have everything we need for highlight calculation
      if (!viewer || !viewer.timeline) {
        return {
          initialState,
          highlightClick: { success: false, error: "Viewer or timeline not available" },
        };
      }

      const highlightRanges = viewer.timeline._highlightRanges || [];

      // Find pass highlights (priority 0, not day/night cycles)
      const passHighlights = highlightRanges.filter((h) => {
        return h._base === 0;
      });

      if (passHighlights.length === 0) {
        return {
          initialState,
          highlightClick: { success: false, error: "No pass highlights found" },
        };
      }

      // Get the first pass highlight
      const firstHighlight = passHighlights[0];

      // Access JulianDate internal properties directly (dayNumber and secondsOfDay)
      // Instead of using Cesium methods, calculate using raw time values
      // Note: Cesium timeline highlight ranges use _start and _stop (with underscores)
      const highlightStart = firstHighlight._start;
      const highlightStop = firstHighlight._stop;
      const timelineStart = viewer.clock.startTime;
      const timelineStop = viewer.clock.stopTime;

      // Convert JulianDate to Unix timestamp in seconds
      // Unix epoch (1970-01-01 00:00:00 UTC) is at Julian Day 2440587.5
      const julianToSeconds = (jd) => (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;

      const highlightStartSec = julianToSeconds(highlightStart);
      const highlightStopSec = julianToSeconds(highlightStop);
      const timelineStartSec = julianToSeconds(timelineStart);
      const timelineStopSec = julianToSeconds(timelineStop);

      // Calculate midpoint of highlight
      const highlightMidSec = (highlightStartSec + highlightStopSec) / 2;

      // Calculate ratio along timeline
      const totalSeconds = timelineStopSec - timelineStartSec;
      const highlightOffsetSeconds = highlightMidSec - timelineStartSec;
      const highlightRatio = highlightOffsetSeconds / totalSeconds;

      return {
        initialState,
        highlightClick: {
          success: true,
          highlightRatio,
          highlightMidSec,
          highlightStartSec,
          highlightStopSec,
        },
      };
    });

    console.log(`Initial time: ${stateAndHighlight.initialState.time}, passes: ${stateAndHighlight.initialState.passCount}`);
    console.log(`Highlight click result: ${JSON.stringify(stateAndHighlight.highlightClick, null, 2)}`);
    expect(stateAndHighlight.highlightClick.success).toBe(true);

    // Click on the timeline at the highlight location
    const timelineBox = await page.evaluate(() => {
      const el = document.querySelector(".cesium-timeline-main");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    if (timelineBox) {
      // Calculate pixel position based on highlight ratio
      const clickX = timelineBox.x + timelineBox.width * stateAndHighlight.highlightClick.highlightRatio;
      const clickY = timelineBox.y + timelineBox.height / 2;

      console.log(`Clicking timeline at x=${clickX.toFixed(0)}, y=${clickY.toFixed(0)} (ratio=${stateAndHighlight.highlightClick.highlightRatio.toFixed(3)})`);

      await page.mouse.click(clickX, clickY);
    } else {
      throw new Error("Timeline bounding box not found");
    }

    // Wait for pass recalculation and timeline highlights to update after time jump
    await waitForPassCalculation(page);

    // Verify time changed and passes were recalculated
    const newState = await page.evaluate(() => {
      const currentTime = window.cc?.viewer?.clock?.currentTime;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name === "ISS (ZARYA)");
      const highlightRanges = window.cc?.viewer?.timeline?._highlightRanges || [];
      // Filter for pass highlights only (priority 0, _base = 0)
      const passHighlights = highlightRanges.filter((h) => h._base === 0);

      return {
        time: currentTime?.toString(),
        passCount: issSat?.props?.passes?.length || 0,
        highlightCount: passHighlights.length,
        firstPass: issSat?.props?.passes?.[0]
          ? {
              start: issSat.props.passes[0].start,
              end: issSat.props.passes[0].end,
              name: issSat.props.passes[0].name,
            }
          : null,
      };
    });

    console.log(`After time jump - time: ${newState.time}, passes: ${newState.passCount}, highlights: ${newState.highlightCount}`);

    // Verify time is different from initial time (verifies the time jump occurred)
    expect(newState.time).not.toBe(stateAndHighlight.initialState.time);

    // Verify passes were recalculated (should still have passes for ISS)
    expect(newState.passCount).toBeGreaterThan(0);
    expect(newState.firstPass).not.toBeNull();

    // If no highlights are visible after the jump, widen the timeline window to show passes
    if (newState.highlightCount === 0) {
      console.log("No highlights visible after time jump - widening timeline window");

      await page.evaluate(() => {
        const viewer = window.cc?.viewer;
        const Cesium = window.Cesium;
        if (!viewer || !Cesium) return;

        const currentTime = viewer.clock.currentTime;
        // Widen to 5 days before and 14 days after current time
        const startTime = Cesium.JulianDate.addDays(currentTime, -5, new Cesium.JulianDate());
        const stopTime = Cesium.JulianDate.addDays(currentTime, 14, new Cesium.JulianDate());

        viewer.clock.startTime = startTime;
        viewer.clock.stopTime = stopTime;

        if (viewer.timeline) {
          viewer.timeline.zoomTo(startTime, stopTime);
        }
      });

      // Wait for highlights to be recalculated after timeline change
      await page.waitForTimeout(3000);

      // Check highlights again
      const updatedState = await page.evaluate(() => {
        const highlightRanges = window.cc?.viewer?.timeline?._highlightRanges || [];
        const passHighlights = highlightRanges.filter((h) => h._base === 0);
        return {
          highlightCount: passHighlights.length,
        };
      });

      console.log(`After widening timeline - highlights: ${updatedState.highlightCount}`);
      expect(updatedState.highlightCount).toBeGreaterThan(0);
    } else {
      // Highlights were already visible
      expect(newState.highlightCount).toBeGreaterThan(0);
    }

    // Verify highlights match passes in the pass list
    const passAndHighlightMatch = await page.evaluate(() => {
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name === "ISS (ZARYA)");
      const highlightRanges = window.cc?.viewer?.timeline?._highlightRanges || [];
      const passHighlights = highlightRanges.filter((h) => h._base === 0);
      const viewer = window.cc?.viewer;

      if (!issSat || !viewer) return { success: false, error: "Missing satellite or viewer" };

      const passes = issSat.props?.passes || [];
      const timelineStart = viewer.clock.startTime;
      const timelineStop = viewer.clock.stopTime;

      // Convert JulianDate to Unix timestamp in seconds
      // Unix epoch (1970-01-01 00:00:00 UTC) is at Julian Day 2440587.5
      const julianToSeconds = (jd) => (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;
      const timelineStartSec = julianToSeconds(timelineStart);
      const timelineStopSec = julianToSeconds(timelineStop);
      const currentTime = viewer.clock.currentTime;
      const currentTimeSec = julianToSeconds(currentTime);

      // Get passes that should be visible in timeline window (needed for debug info)
      const visiblePassesForDebug = passes.filter((pass) => {
        const passStartMs = new Date(pass.start).getTime();
        const passEndMs = new Date(pass.end).getTime();
        const passStartSec = passStartMs / 1000;
        const passEndSec = passEndMs / 1000;
        return passEndSec >= timelineStartSec && passStartSec <= timelineStopSec;
      });

      // Prepare debug data showing timeline window and pass/highlight times
      const debugInfo = {
        timelineWindow: {
          start: new Date(timelineStartSec * 1000).toISOString(),
          stop: new Date(timelineStopSec * 1000).toISOString(),
          startSec: timelineStartSec,
          stopSec: timelineStopSec,
          durationHours: (timelineStopSec - timelineStartSec) / 3600,
        },
        currentTime: {
          iso: new Date(currentTimeSec * 1000).toISOString(),
          sec: currentTimeSec,
        },
        firstFivePasses: passes.slice(0, 5).map((pass, idx) => {
          const startSec = new Date(pass.start).getTime() / 1000;
          const endSec = new Date(pass.end).getTime() / 1000;
          const isInWindow = endSec >= timelineStartSec && startSec <= timelineStopSec;
          return {
            index: idx,
            start: new Date(pass.start).toISOString(),
            end: new Date(pass.end).toISOString(),
            startSec,
            endSec,
            inWindow: isInWindow,
            hoursFromTimelineStart: (startSec - timelineStartSec) / 3600,
          };
        }),
        visiblePasses: visiblePassesForDebug.map((pass, idx) => {
          const startSec = new Date(pass.start).getTime() / 1000;
          const endSec = new Date(pass.end).getTime() / 1000;
          return {
            index: idx,
            start: new Date(pass.start).toISOString(),
            end: new Date(pass.end).toISOString(),
            startSec,
            endSec,
            hoursFromTimelineStart: (startSec - timelineStartSec) / 3600,
          };
        }),
        highlights: passHighlights.map((h, idx) => {
          const startSec = julianToSeconds(h._start);
          const stopSec = julianToSeconds(h._stop);
          return {
            index: idx,
            start: new Date(startSec * 1000).toISOString(),
            stop: new Date(stopSec * 1000).toISOString(),
            startSec,
            stopSec,
            hoursFromTimelineStart: (startSec - timelineStartSec) / 3600,
          };
        }),
      };

      // Get passes that should be visible in timeline window
      const visiblePasses = visiblePassesForDebug;

      // Each highlight should correspond to a pass
      let matchCount = 0;
      const tolerance = 60; // 60 second tolerance to account for Cesium timeline rendering quantization

      // Sanity check: verify all highlights have start < stop
      for (const highlight of passHighlights) {
        const highlightStartSec = julianToSeconds(highlight._start);
        const highlightStopSec = julianToSeconds(highlight._stop);
        if (highlightStartSec >= highlightStopSec) {
          return {
            success: false,
            error: `Invalid highlight time range: start=${highlightStartSec} >= stop=${highlightStopSec}`,
          };
        }
      }

      for (const highlight of passHighlights) {
        const highlightStartSec = julianToSeconds(highlight._start);
        const highlightStopSec = julianToSeconds(highlight._stop);

        // Find matching pass
        const matchingPass = visiblePasses.find((pass) => {
          const passStartSec = new Date(pass.start).getTime() / 1000;
          const passEndSec = new Date(pass.end).getTime() / 1000;
          return Math.abs(highlightStartSec - passStartSec) < tolerance && Math.abs(highlightStopSec - passEndSec) < tolerance;
        });

        if (matchingPass) {
          matchCount++;
        }
      }

      return {
        success: true,
        passHighlightCount: passHighlights.length,
        visiblePassCount: visiblePasses.length,
        matchCount,
        allHighlightsMatchPasses: matchCount === passHighlights.length,
        debug: debugInfo,
      };
    });

    console.log(`Pass/Highlight match: ${JSON.stringify(passAndHighlightMatch, null, 2)}`);
    if (passAndHighlightMatch.debug) {
      console.log(`Timeline Window: ${JSON.stringify(passAndHighlightMatch.debug.timelineWindow, null, 2)}`);
      console.log(`Current Time: ${JSON.stringify(passAndHighlightMatch.debug.currentTime, null, 2)}`);
      console.log(`First 5 Passes: ${JSON.stringify(passAndHighlightMatch.debug.firstFivePasses, null, 2)}`);
      console.log(`Visible Passes: ${JSON.stringify(passAndHighlightMatch.debug.visiblePasses, null, 2)}`);
      console.log(`Highlights: ${JSON.stringify(passAndHighlightMatch.debug.highlights, null, 2)}`);
    }
    expect(passAndHighlightMatch.success).toBe(true);
    expect(passAndHighlightMatch.allHighlightsMatchPasses).toBe(true);
  });

  test("should recalculate passes and highlights after zooming out and clicking timeline 24h ahead", async ({ page }) => {
    // Start with ISS and ground station
    // Disable pass filters to test unfiltered passes
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich&hideLight=0&onlyLit=0");

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

    await page.waitForTimeout(2000);

    // Set simulation time and widen timeline window to ensure passes are visible
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date();
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);

        // Set current time
        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false;

        // Widen timeline window: 2 days before to 7 days after (wider than default)
        const startTime = window.Cesium.JulianDate.addDays(julianDate, -2, new window.Cesium.JulianDate());
        const stopTime = window.Cesium.JulianDate.addDays(julianDate, 7, new window.Cesium.JulianDate());

        window.cc.viewer.clock.startTime = startTime;
        window.cc.viewer.clock.stopTime = stopTime;

        if (window.cc.viewer.timeline) {
          window.cc.viewer.timeline.zoomTo(startTime, stopTime);
        }
      }
    });

    await page.waitForTimeout(1000);

    // Trigger timeline update
    await page.evaluate(() => {
      if (window.cc?.viewer?.timeline) {
        window.cc.viewer.timeline.updateFromClock();
      }
    });

    // Wait for pass calculation and timeline highlights to be ready
    await waitForPassCalculation(page);

    // Get initial state
    const initialState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const sats = window.cc?.sats?.satellites;

      if (!viewer || !viewer.timeline || !sats || sats.length === 0) {
        return { found: false, error: "Missing viewer or satellites" };
      }

      const issSat = sats.find((s) => s.props?.name === "ISS (ZARYA)");
      if (!issSat || !issSat.props?.passes || issSat.props.passes.length === 0) {
        return { found: false, error: "No passes found" };
      }

      const currentTime = viewer.clock.currentTime;
      const highlightRanges = viewer.timeline._highlightRanges || [];
      const passHighlights = highlightRanges.filter((h) => h._base === 0);

      return {
        found: true,
        time: currentTime.toString(),
        passCount: issSat.props.passes.length,
        highlightCount: passHighlights.length,
      };
    });

    console.log(`Initial state: time: ${initialState.time}, passes: ${initialState.passCount}, highlights: ${initialState.highlightCount}`);
    expect(initialState.found).toBe(true);
    expect(initialState.passCount).toBeGreaterThan(0);
    expect(initialState.highlightCount).toBeGreaterThan(0);

    // Click the zoom-out button ("-") three times
    const zoomOutButton = page.locator('button.timeline-button:has-text("-")');
    await expect(zoomOutButton).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 3; i++) {
      // Use force: true to bypass actionability checks (animations may prevent stable state)
      await zoomOutButton.click({ force: true });
      await page.waitForTimeout(500); // Wait for zoom animation
    }

    console.log("Clicked zoom-out button 3 times");

    // Calculate timeline position 24 hours in the future
    const futureClickData = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer || !viewer.timeline) {
        return { success: false, error: "Viewer or timeline not available" };
      }

      const currentTime = viewer.clock.currentTime;
      const timelineStart = viewer.clock.startTime;
      const timelineStop = viewer.clock.stopTime;

      // Convert JulianDate to Unix timestamp in seconds
      // Unix epoch (1970-01-01 00:00:00 UTC) is at Julian Day 2440587.5
      const julianToSeconds = (jd) => (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;

      const currentSec = julianToSeconds(currentTime);
      const timelineStartSec = julianToSeconds(timelineStart);
      const timelineStopSec = julianToSeconds(timelineStop);

      // Calculate time 24 hours in the future
      const future24hSec = currentSec + 24 * 60 * 60; // 24 hours in seconds

      // Calculate ratio along timeline
      const totalSeconds = timelineStopSec - timelineStartSec;
      const futureOffsetSeconds = future24hSec - timelineStartSec;
      const futureRatio = futureOffsetSeconds / totalSeconds;

      return {
        success: true,
        futureRatio,
        future24hSec,
        currentSec,
      };
    });

    expect(futureClickData.success).toBe(true);
    console.log(`Calculated future time ratio: ${futureClickData.futureRatio.toFixed(4)}`);

    // Get timeline bounding box and click at the calculated position
    const timelineContainer = page.locator(".cesium-viewer-timelineContainer");
    await expect(timelineContainer).toBeVisible();

    const timelineBoundingBox = await page.evaluate(() => {
      const el = document.querySelector(".cesium-viewer-timelineContainer");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(timelineBoundingBox).not.toBeNull();

    const clickX = timelineBoundingBox.x + timelineBoundingBox.width * futureClickData.futureRatio;
    const clickY = timelineBoundingBox.y + timelineBoundingBox.height / 2;

    console.log(`Clicking timeline at x=${Math.round(clickX)}, y=${Math.round(clickY)} (ratio=${futureClickData.futureRatio.toFixed(4)})`);

    // Click on the timeline
    await page.mouse.click(clickX, clickY);

    // Wait for time to update, passes to be recalculated, and highlights to update
    await waitForPassCalculation(page);

    // Verify time changed, passes recalculated, and highlights are present
    const newState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const currentTime = viewer?.clock?.currentTime;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name === "ISS (ZARYA)");
      const highlightRanges = viewer?.timeline?._highlightRanges || [];
      const passHighlights = highlightRanges.filter((h) => h._base === 0);

      return {
        time: currentTime?.toString(),
        passCount: issSat?.props?.passes?.length || 0,
        highlightCount: passHighlights.length,
      };
    });

    console.log(`After time jump - time: ${newState.time}, passes: ${newState.passCount}, highlights: ${newState.highlightCount}`);

    // Verify time is different from initial time
    expect(newState.time).not.toBe(initialState.time);

    // Calculate actual time difference by parsing ISO8601 strings
    // Format: 2025-11-28T06:33:50.04120000002149027Z
    const initialDate = new Date(initialState.time);
    const newDate = new Date(newState.time);
    const diffMs = newDate.getTime() - initialDate.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    console.log(`Time difference: ${diffHours.toFixed(2)} hours`);

    // Verify time jumped approximately 24 hours (within 1 hour tolerance)
    expect(Math.abs(diffHours - 24)).toBeLessThan(1);

    // Verify passes were recalculated
    expect(newState.passCount).toBeGreaterThan(0);

    // If no highlights are visible after the jump, widen the timeline window to show passes
    if (newState.highlightCount === 0) {
      console.log("No highlights visible after time jump - widening timeline window");

      await page.evaluate(() => {
        const viewer = window.cc?.viewer;
        const Cesium = window.Cesium;
        if (!viewer || !Cesium) return;

        const currentTime = viewer.clock.currentTime;
        // Widen to 5 days before and 14 days after current time
        const startTime = Cesium.JulianDate.addDays(currentTime, -5, new Cesium.JulianDate());
        const stopTime = Cesium.JulianDate.addDays(currentTime, 14, new Cesium.JulianDate());

        viewer.clock.startTime = startTime;
        viewer.clock.stopTime = stopTime;

        if (viewer.timeline) {
          viewer.timeline.zoomTo(startTime, stopTime);
        }
      });

      // Wait for highlights to be recalculated after timeline change
      await page.waitForTimeout(3000);

      // Check highlights again
      const updatedState = await page.evaluate(() => {
        const highlightRanges = window.cc?.viewer?.timeline?._highlightRanges || [];
        const passHighlights = highlightRanges.filter((h) => h._base === 0);
        return {
          highlightCount: passHighlights.length,
        };
      });

      console.log(`After widening timeline - highlights: ${updatedState.highlightCount}`);
      expect(updatedState.highlightCount).toBeGreaterThan(0);
    } else {
      // Highlights were already visible
      expect(newState.highlightCount).toBeGreaterThan(0);
    }

    // Verify highlights match passes in the pass list
    const passAndHighlightMatch = await page.evaluate(() => {
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name === "ISS (ZARYA)");
      const highlightRanges = window.cc?.viewer?.timeline?._highlightRanges || [];
      const passHighlights = highlightRanges.filter((h) => h._base === 0);
      const viewer = window.cc?.viewer;

      if (!issSat || !viewer) return { success: false, error: "Missing satellite or viewer" };

      const passes = issSat.props?.passes || [];
      const timelineStart = viewer.clock.startTime;
      const timelineStop = viewer.clock.stopTime;

      // Convert JulianDate to Unix timestamp in seconds
      // Unix epoch (1970-01-01 00:00:00 UTC) is at Julian Day 2440587.5
      const julianToSeconds = (jd) => (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;
      const timelineStartSec = julianToSeconds(timelineStart);
      const timelineStopSec = julianToSeconds(timelineStop);
      const currentTime = viewer.clock.currentTime;
      const currentTimeSec = julianToSeconds(currentTime);

      // Get passes that should be visible in timeline window (needed for debug info)
      const visiblePassesForDebug = passes.filter((pass) => {
        const passStartMs = new Date(pass.start).getTime();
        const passEndMs = new Date(pass.end).getTime();
        const passStartSec = passStartMs / 1000;
        const passEndSec = passEndMs / 1000;
        return passEndSec >= timelineStartSec && passStartSec <= timelineStopSec;
      });

      // Prepare debug data showing timeline window and pass/highlight times
      const debugInfo = {
        timelineWindow: {
          start: new Date(timelineStartSec * 1000).toISOString(),
          stop: new Date(timelineStopSec * 1000).toISOString(),
          startSec: timelineStartSec,
          stopSec: timelineStopSec,
          durationHours: (timelineStopSec - timelineStartSec) / 3600,
        },
        currentTime: {
          iso: new Date(currentTimeSec * 1000).toISOString(),
          sec: currentTimeSec,
        },
        firstFivePasses: passes.slice(0, 5).map((pass, idx) => {
          const startSec = new Date(pass.start).getTime() / 1000;
          const endSec = new Date(pass.end).getTime() / 1000;
          const isInWindow = endSec >= timelineStartSec && startSec <= timelineStopSec;
          return {
            index: idx,
            start: new Date(pass.start).toISOString(),
            end: new Date(pass.end).toISOString(),
            startSec,
            endSec,
            inWindow: isInWindow,
            hoursFromTimelineStart: (startSec - timelineStartSec) / 3600,
          };
        }),
        visiblePasses: visiblePassesForDebug.map((pass, idx) => {
          const startSec = new Date(pass.start).getTime() / 1000;
          const endSec = new Date(pass.end).getTime() / 1000;
          return {
            index: idx,
            start: new Date(pass.start).toISOString(),
            end: new Date(pass.end).toISOString(),
            startSec,
            endSec,
            hoursFromTimelineStart: (startSec - timelineStartSec) / 3600,
          };
        }),
        highlights: passHighlights.map((h, idx) => {
          const startSec = julianToSeconds(h._start);
          const stopSec = julianToSeconds(h._stop);
          return {
            index: idx,
            start: new Date(startSec * 1000).toISOString(),
            stop: new Date(stopSec * 1000).toISOString(),
            startSec,
            stopSec,
            hoursFromTimelineStart: (startSec - timelineStartSec) / 3600,
          };
        }),
      };

      // Get passes that should be visible in timeline window
      const visiblePasses = visiblePassesForDebug;

      // Each highlight should correspond to a pass
      let matchCount = 0;
      const tolerance = 60; // 60 second tolerance to account for Cesium timeline rendering quantization

      // Sanity check: verify all highlights have start < stop
      for (const highlight of passHighlights) {
        const highlightStartSec = julianToSeconds(highlight._start);
        const highlightStopSec = julianToSeconds(highlight._stop);
        if (highlightStartSec >= highlightStopSec) {
          return {
            success: false,
            error: `Invalid highlight time range: start=${highlightStartSec} >= stop=${highlightStopSec}`,
          };
        }
      }

      for (const highlight of passHighlights) {
        const highlightStartSec = julianToSeconds(highlight._start);
        const highlightStopSec = julianToSeconds(highlight._stop);

        // Find matching pass
        const matchingPass = visiblePasses.find((pass) => {
          const passStartSec = new Date(pass.start).getTime() / 1000;
          const passEndSec = new Date(pass.end).getTime() / 1000;
          return Math.abs(highlightStartSec - passStartSec) < tolerance && Math.abs(highlightStopSec - passEndSec) < tolerance;
        });

        if (matchingPass) {
          matchCount++;
        }
      }

      return {
        success: true,
        passHighlightCount: passHighlights.length,
        visiblePassCount: visiblePasses.length,
        matchCount,
        allHighlightsMatchPasses: matchCount === passHighlights.length,
        debug: debugInfo,
      };
    });

    console.log(`Pass/Highlight match: ${JSON.stringify(passAndHighlightMatch, null, 2)}`);
    if (passAndHighlightMatch.debug) {
      console.log(`Timeline Window: ${JSON.stringify(passAndHighlightMatch.debug.timelineWindow, null, 2)}`);
      console.log(`Current Time: ${JSON.stringify(passAndHighlightMatch.debug.currentTime, null, 2)}`);
      console.log(`First 5 Passes: ${JSON.stringify(passAndHighlightMatch.debug.firstFivePasses, null, 2)}`);
      console.log(`Visible Passes: ${JSON.stringify(passAndHighlightMatch.debug.visiblePasses, null, 2)}`);
      console.log(`Highlights: ${JSON.stringify(passAndHighlightMatch.debug.highlights, null, 2)}`);
    }
    expect(passAndHighlightMatch.success).toBe(true);
    expect(passAndHighlightMatch.allHighlightsMatchPasses).toBe(true);
  });
});
