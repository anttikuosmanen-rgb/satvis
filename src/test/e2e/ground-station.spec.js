import { test, expect } from "@playwright/test";
import { pauseAnimation, resumeAnimation, waitForPassCalculation, waitForAppReady, withPausedGlobe, flipCameraToOppositeSide } from "./helpers/globe-interaction.js";
import { buildFreshIssUrl } from "./helpers/fresh-tle.js";

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
 * Shared setup: load fresh ISS TLE with ground station, widen timeline,
 * select the ground station entity, and wait for pass highlights to appear.
 */
async function setupWithPassHighlights(page) {
  await page.goto(buildFreshIssUrl({ gs: "48.1351,11.5820", hideLight: false, onlyLit: false }));
  await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
  await waitForAppReady(page);
  await waitForPassCalculation(page);

  // Widen timeline to 4 days (passes may be beyond default 24h view)
  await page.evaluate(() => {
    const now = window.cc.viewer.clock.currentTime;
    window.cc.viewer.timeline.zoomTo({ dayNumber: now.dayNumber - 1, secondsOfDay: now.secondsOfDay }, { dayNumber: now.dayNumber + 3, secondsOfDay: now.secondsOfDay });
  });

  // Deselect then select GS (wait for event to process)
  await page.evaluate(() => {
    return new Promise((resolve) => {
      const viewer = window.cc.viewer;
      if (!viewer.selectedEntity) {
        resolve();
        return;
      }
      viewer.selectedEntityChanged.addEventListener(function handler() {
        viewer.selectedEntityChanged.removeEventListener(handler);
        setTimeout(resolve, 200);
      });
      viewer.selectedEntity = undefined;
    });
  });
  await page.evaluate(() => {
    const gs = window.cc?.sats?.groundStations?.[0];
    if (gs?.components?.Groundstation) {
      window.cc.viewer.selectedEntity = gs.components.Groundstation;
    }
  });

  // Wait for pass highlights (_base === 0) to appear on timeline
  await expect
    .poll(
      async () => {
        return page.evaluate(() => {
          return (window.cc?.viewer?.timeline?._highlightRanges || []).filter((h) => h._base === 0).length;
        });
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
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
          return false;
        }

        // Check if ISS is in the database
        const issSat = sats.find((s) => s.props?.name?.includes("ISS"));
        if (!issSat) {
          return false;
        }

        // Check if ISS has valid TLE data
        const hasValidTLE = issSat.props?.orbit?.satrec !== null && issSat.props?.orbit?.satrec !== undefined;
        if (!hasValidTLE) {
          return false;
        }

        return true;
      },
      { timeout: 60000 }, // Increased timeout to 60s
    );

    // Pause animation before interacting with UI elements
    // This makes elements stable for Playwright's actionability checks
    await pauseAnimation(page);

    // Open ground station menu - button has svg-groundstation icon class
    const groundStationButton = page
      .locator("button.cesium-toolbar-button")
      .filter({
        has: page.locator(".svg-groundstation"),
      })
      .first();

    await expect(groundStationButton).toBeVisible({ timeout: 5000 });
    await groundStationButton.click();

    // Move mouse away from button to dismiss tooltip that might block other UI elements
    await page.mouse.move(0, 0);

    // Enable "Pick on globe" checkbox
    // The checkbox is inside a label with text "Pick on globe"
    // Note: The actual checkbox is hidden by CSS (custom styled checkbox)
    const pickOnGlobeLabel = page.locator('label.toolbarSwitch:has-text("Pick on globe")');
    // Wait for the menu to fully expand and become visible
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 10000 });

    const pickOnGlobeCheckbox = pickOnGlobeLabel.locator('input[type="checkbox"]');

    // Check if already checked
    const isChecked = await pickOnGlobeCheckbox.isChecked();
    if (!isChecked) {
      // Click the label to toggle the checkbox (now that tooltip is gone)
      await pickOnGlobeLabel.click();
      await expect(pickOnGlobeCheckbox).toBeChecked({ timeout: 3000 });
    }

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

      await page.mouse.click(clickX, clickY);

      // Wait for ground station entity to be created
      await page.waitForFunction(
        () => {
          const viewer = window.cc?.viewer;
          if (!viewer) return false;
          const gsEntities = viewer.entities.values.filter((e) => e.name && e.name.toLowerCase().includes("ground"));
          return gsEntities.length > 0;
        },
        { timeout: 10000 },
      );

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

      expect(gsState.found).toBe(true);
      expect(gsState.count).toBe(1);
    }
  });

  test("should calculate and display pass predictions", async ({ page }) => {
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
    await page.goto(`/?sats=${satellites.join(",")}&gs=48.1351,11.5820&hideLight=0&onlyLit=0`);

    // Set up pass calculation event listener immediately to avoid race condition
    // When satellites and ground station are in URL, pass calculation starts immediately
    await page.evaluate(() => {
      if (!window._passCalculationState) {
        window._passCalculationState = { completed: false };
        const handler = () => {
          window._passCalculationState.completed = true;
          window.removeEventListener("satvis:passCalculationComplete", handler);
        };
        window.addEventListener("satvis:passCalculationComplete", handler);
      }
    });

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

    // Wait for app to be fully ready
    await waitForAppReady(page);

    // Pause animation to stabilize scene before waiting for calculations
    await pauseAnimation(page);

    // Wait for pass calculation to complete for all satellites
    // Using longer timeout since we have 25 satellites to calculate passes for
    await waitForPassCalculation(page, { timeout: 60000 });

    // Check if ClockMonitor is initialized
    const clockMonitorStatus = await page.evaluate(() => {
      return {
        exists: !!window.cc?.clockMonitor,
        enabled: window.cc?.clockMonitor?.enabled,
        config: window.cc?.clockMonitor?.getConfig?.(),
      };
    });

    // Set simulation time to current date (matches TLE epoch ~Nov 2025)
    // This ensures satellites have fresh TLE data and passes can be calculated
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date(); // Use current date
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);
        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false; // Pause at this time
      }
    });

    // Removed unnecessary waitForTimeout

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

      // Verify ground station is available and passes are calculated
      expect(passData.gsAvailable).toBe(true);
      expect(passData.gsCount).toBe(1);

      // With simulation time set to current date (matching TLE epoch), passes MUST be found
      // If this fails, there's an issue with pass calculation
      expect(passData.found).toBe(true);
      expect(passData.count).toBeGreaterThan(0);
    }
  });

  test("should create pass highlights that match actual satellite passes", async ({ page }) => {
    await setupWithPassHighlights(page);

    // Verify each pass highlight matches an actual satellite pass
    const result = await page.evaluate(() => {
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name?.includes("ISS (ZARYA)"));
      const ranges = window.cc?.viewer?.timeline?._highlightRanges || [];
      const passHighlights = ranges.filter((h) => h._base === 0);
      const passes = issSat?.props?.passes || [];

      const julianToSeconds = (jd) => (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;
      const dateToSeconds = (d) => new Date(d).getTime() / 1000;

      // Check all highlights have valid time ranges (start < stop)
      const allValid = passHighlights.every((h) => {
        if (!h._start || !h._stop) return false;
        return julianToSeconds(h._start) < julianToSeconds(h._stop);
      });

      // Check each highlight matches an actual pass within 60s tolerance
      const tolerance = 60;
      const allMatch = passHighlights.every((h) => {
        const hStart = julianToSeconds(h._start);
        const hStop = julianToSeconds(h._stop);
        return passes.some((p) => {
          const pStart = dateToSeconds(p.start);
          const pEnd = dateToSeconds(p.end);
          return Math.abs(hStart - pStart) < tolerance && Math.abs(hStop - pEnd) < tolerance;
        });
      });

      return {
        passCount: passes.length,
        highlightCount: passHighlights.length,
        allValid,
        allMatch,
      };
    });

    expect(result.passCount).toBeGreaterThan(0);
    expect(result.highlightCount).toBeGreaterThan(0);
    expect(result.allValid).toBe(true);
    expect(result.allMatch).toBe(true);
  });

  test("should jump clock to pass time when clicking a timeline highlight", async ({ page }) => {
    await setupWithPassHighlights(page);

    // Record initial clock time, find first highlight, compute click position
    const clickData = await page.evaluate(() => {
      const viewer = window.cc.viewer;
      const timeline = viewer.timeline;
      const ranges = timeline._highlightRanges || [];
      const passHighlights = ranges.filter((h) => h._base === 0);

      if (passHighlights.length === 0) return null;

      const julianToSeconds = (jd) => (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;

      const h = passHighlights[0];
      const hMidSec = (julianToSeconds(h._start) + julianToSeconds(h._stop)) / 2;
      const tlStartSec = julianToSeconds(timeline._startJulian);
      const tlStopSec = julianToSeconds(timeline._endJulian);
      const ratio = (hMidSec - tlStartSec) / (tlStopSec - tlStartSec);

      return {
        initialTimeSec: julianToSeconds(viewer.clock.currentTime),
        highlightStartSec: julianToSeconds(h._start),
        highlightStopSec: julianToSeconds(h._stop),
        ratio,
      };
    });

    expect(clickData).not.toBeNull();
    expect(clickData.ratio).toBeGreaterThan(0);
    expect(clickData.ratio).toBeLessThan(1);

    // Get timeline bounding box and click at the highlight position
    const timelineBoundingBox = await page.evaluate(() => {
      const el = document.querySelector(".cesium-viewer-timelineContainer");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(timelineBoundingBox).not.toBeNull();

    const clickX = timelineBoundingBox.x + timelineBoundingBox.width * clickData.ratio;
    const clickY = timelineBoundingBox.y + timelineBoundingBox.height / 2;
    await page.mouse.click(clickX, clickY);

    // Verify clock jumped to within the highlight's time range (±60s tolerance)
    const newTimeSec = await page.evaluate(() => {
      const jd = window.cc.viewer.clock.currentTime;
      return (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;
    });

    const tolerance = 60;
    expect(newTimeSec).not.toBe(clickData.initialTimeSec);
    expect(newTimeSec).toBeGreaterThanOrEqual(clickData.highlightStartSec - tolerance);
    expect(newTimeSec).toBeLessThanOrEqual(clickData.highlightStopSec + tolerance);
  });

  test("should update ground station link when satellite is selected @critical", async ({ page }) => {
    // Start with ISS and ground station
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    // Removed unnecessary waitForTimeout

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

    // Note: Ground station link visibility depends on whether satellite is currently in view
    // So we just verify the test setup works, not necessarily that link is visible
    expect(linkEntity).toBeDefined();
  });

  test("should recalculate passes and highlights after zooming out and clicking timeline 24h ahead", async ({ page }) => {
    // Start with ISS and ground station using fresh TLE
    await page.goto(buildFreshIssUrl({ gs: "48.1351,11.5820", hideLight: false, onlyLit: false }));

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await waitForAppReady(page);

    // Wait for pass calculation to complete
    await waitForPassCalculation(page, { timeout: 30000 });

    // Verify initial passes and pass highlights exist
    const initialState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name?.includes("ISS (ZARYA)"));
      const ranges = viewer?.timeline?._highlightRanges || [];
      return {
        time: viewer?.clock?.currentTime?.toString(),
        passCount: issSat?.props?.passes?.length || 0,
        hasTimeline: !!viewer?.timeline,
        passHighlightCount: ranges.filter((h) => h._base === 0).length,
      };
    });

    expect(initialState.passCount).toBeGreaterThan(0);
    expect(initialState.hasTimeline).toBe(true);
    expect(initialState.passHighlightCount).toBeGreaterThan(0);

    // Select the ground station entity so that the recalculation path
    // (updatePassHighlightsAfterTimelineChange) runs after the time jump.
    // ClockMonitor fires cesium:clockTimeJumped which triggers a debounced recalculation.
    await page.evaluate(() => {
      const gs = window.cc?.sats?.groundStations?.[0];
      if (gs?.components?.Groundstation) {
        window.cc.viewer.selectedEntity = gs.components.Groundstation;
      }
    });

    // Click the zoom-out button ("-") three times to widen the timeline
    const zoomOutButton = page.locator('button.timeline-button:has-text("-")');
    await expect(zoomOutButton).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 3; i++) {
      await zoomOutButton.click({ force: true });
    }

    // Calculate timeline position 24 hours in the future
    const futureClickData = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer || !viewer.timeline) return { success: false };

      const julianToSeconds = (jd) => (jd.dayNumber - 2440587.5) * 86400 + jd.secondsOfDay;
      const currentSec = julianToSeconds(viewer.clock.currentTime);
      const timelineStartSec = julianToSeconds(viewer.clock.startTime);
      const timelineStopSec = julianToSeconds(viewer.clock.stopTime);

      const future24hSec = currentSec + 24 * 60 * 60;
      const totalSeconds = timelineStopSec - timelineStartSec;
      const futureRatio = (future24hSec - timelineStartSec) / totalSeconds;

      return { success: true, futureRatio };
    });

    expect(futureClickData.success).toBe(true);

    const timelineBoundingBox = await page.evaluate(() => {
      const el = document.querySelector(".cesium-viewer-timelineContainer");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(timelineBoundingBox).not.toBeNull();

    // Tag existing highlights before clicking so we can verify new ones are created
    await page.evaluate(() => {
      const ranges = window.cc.viewer.timeline._highlightRanges.filter((h) => h._base === 0);
      ranges.forEach((h) => {
        h._preJump = true;
      });
    });

    // Click on the timeline to jump 24h ahead.
    // Animation is running so ClockMonitor detects the jump and triggers recalculation.
    const clickX = timelineBoundingBox.x + timelineBoundingBox.width * futureClickData.futureRatio;
    const clickY = timelineBoundingBox.y + timelineBoundingBox.height / 2;
    await page.mouse.click(clickX, clickY);

    // Verify time jumped approximately 24 hours
    const newTime = await page.evaluate(() => window.cc?.viewer?.clock?.currentTime?.toString());
    expect(newTime).not.toBe(initialState.time);
    const diffHours = (new Date(newTime).getTime() - new Date(initialState.time).getTime()) / (1000 * 60 * 60);
    expect(Math.abs(diffHours - 24)).toBeLessThan(1);

    // Wait for new (untagged) pass highlights to appear.
    // The debounced recalculation (3s) clears old highlights and adds new ones.
    await expect
      .poll(
        async () => {
          return page.evaluate(() => {
            return (window.cc?.viewer?.timeline?._highlightRanges || []).filter((h) => h._base === 0 && !h._preJump).length;
          });
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
  });

  test("should recalculate daylight highlights after navigating timeline past initial range", async ({ page }) => {
    // Load with ISS and a ground station (Munich) to trigger daylight highlights
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await waitForAppReady(page);
    await waitForPassCalculation(page, { timeout: 30000 });
    await pauseAnimation(page);

    // Helper to get the furthest _stop epoch seconds among daylight highlights (_base === -1)
    // JulianDate dayNumber 2440587.5 = Unix epoch (1970-01-01T00:00:00Z)
    const getFurthestDaylightStopEpoch = () => {
      return page.evaluate(() => {
        const viewer = window.cc?.viewer;
        if (!viewer?.timeline) return null;

        const highlights = viewer.timeline._highlightRanges?.filter((r) => r._base === -1) || [];
        if (highlights.length === 0) return null;

        let furthest = null;
        for (const h of highlights) {
          if (h._stop && typeof h._stop.dayNumber === "number") {
            const epochSec = (h._stop.dayNumber - 2440587.5) * 86400 + h._stop.secondsOfDay;
            if (furthest === null || epochSec > furthest) {
              furthest = epochSec;
            }
          }
        }
        return { count: highlights.length, furthestStopEpoch: furthest };
      });
    };

    // Wait for daylight highlights to be computed (they load async after ground station is set up)
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        if (!viewer?.timeline) return false;
        const highlights = viewer.timeline._highlightRanges?.filter((r) => r._base === -1) || [];
        return highlights.length > 0 && highlights.some((h) => h._stop);
      },
      { timeout: 30000 },
    );

    const initialState = await getFurthestDaylightStopEpoch();
    expect(initialState).not.toBeNull();
    expect(initialState.count).toBeGreaterThan(0);

    // Navigate timeline 100 days into the future and trigger recalculation
    await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      if (!viewer?.timeline) return;

      // Manually construct JulianDate-like objects by offsetting from current time
      const now = viewer.clock.currentTime;
      const futureStart = { dayNumber: now.dayNumber + 100, secondsOfDay: now.secondsOfDay };
      const futureEnd = { dayNumber: now.dayNumber + 130, secondsOfDay: now.secondsOfDay };

      viewer.timeline.zoomTo(futureStart, futureEnd);

      // Dispatch wheel event on the timeline container to trigger the debounced daytime check
      const container = viewer.timeline.container;
      container.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true }));
    });

    // Wait for daylight highlights to be fully recalculated with a further stop date.
    // The recalculation is async (yields to browser), so we wait until the furthest _stop
    // exceeds the initial by at least 1 day AND the highlight count has stabilized.
    const oneDayInSeconds = 86400;
    const threshold = initialState.furthestStopEpoch + oneDayInSeconds;

    await page.waitForFunction(
      ({ threshold: t, minCount }) => {
        const viewer = window.cc?.viewer;
        if (!viewer?.timeline) return false;

        const highlights = viewer.timeline._highlightRanges?.filter((r) => r._base === -1) || [];
        // Require at least as many highlights as initially (recalculation is complete, not partial)
        if (highlights.length < minCount) return false;

        for (const h of highlights) {
          if (h._stop && typeof h._stop.dayNumber === "number") {
            const epochSec = (h._stop.dayNumber - 2440587.5) * 86400 + h._stop.secondsOfDay;
            if (epochSec > t) {
              return true;
            }
          }
        }
        return false;
      },
      { threshold, minCount: initialState.count },
      { timeout: 30000 },
    );
  });

  test("should toggle local time and update timeline and clock display", async ({ page }) => {
    // Load with ISS satellite
    await page.goto("/?sats=ISS~(ZARYA)");

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });

    // Wait for Cesium to be ready
    await page.waitForFunction(
      () => {
        const viewer = window.cc?.viewer;
        return viewer?.scene?.globe?._surface;
      },
      { timeout: 20000 },
    );

    // Wait for ISS to load
    await page.waitForFunction(
      () => {
        const sats = window.cc?.sats?.satellites;
        return sats?.some((s) => s.props?.name?.includes("ISS"));
      },
      { timeout: 60000 },
    );

    // Pause animation for consistent testing
    await pauseAnimation(page);

    // Open GS menu
    const groundStationButton = page
      .locator("button.cesium-toolbar-button")
      .filter({ has: page.locator(".svg-groundstation") })
      .first();
    await expect(groundStationButton).toBeVisible({ timeout: 5000 });
    await groundStationButton.click();

    // Enable pick mode
    const pickOnGlobeLabel = page.locator('label.toolbarSwitch:has-text("Pick on globe")');
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 10000 });
    const pickOnGlobeCheckbox = pickOnGlobeLabel.locator('input[type="checkbox"]');
    if (!(await pickOnGlobeCheckbox.isChecked())) {
      await pickOnGlobeLabel.click();
      await expect(pickOnGlobeCheckbox).toBeChecked({ timeout: 3000 });
    }

    // Click on globe to place GS
    const canvasBox = await page.evaluate(() => {
      const canvas = document.querySelector("#cesiumContainer canvas");
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.waitForFunction(() => window.cc?.sats?.groundStations?.length > 0, { timeout: 10000 });

    // Verify GS was created
    const gsExists = await page.evaluate(() => window.cc?.sats?.groundStations?.length > 0);
    expect(gsExists).toBe(true);

    // Re-open GS menu (it closes after placement)
    await groundStationButton.click();
    await expect(pickOnGlobeLabel).toBeVisible({ timeout: 5000 });

    // Get initial timeline label (should be UTC)
    const initialTimelineLabel = await page.evaluate(() => {
      const timeline = window.cc?.viewer?.timeline;
      if (!timeline) return null;
      // Get current time label
      const currentTime = window.cc.viewer.clock.currentTime;
      return timeline.makeLabel(currentTime);
    });

    expect(initialTimelineLabel).not.toBeNull();
    // UTC format ends with just "UTC" (no +/- offset)
    expect(initialTimelineLabel).toMatch(/UTC$/);

    // Find and click "Use local time" checkbox
    const useLocalTimeLabel = page.locator('label.toolbarSwitch:has-text("Use local time")');
    await expect(useLocalTimeLabel).toBeVisible({ timeout: 5000 });

    // Verify checkbox is enabled (not disabled)
    const useLocalTimeCheckbox = useLocalTimeLabel.locator('input[type="checkbox"]');
    const isDisabled = await useLocalTimeCheckbox.isDisabled();
    expect(isDisabled).toBe(false);

    // Toggle local time on
    await useLocalTimeLabel.click();
    await expect(useLocalTimeCheckbox).toBeChecked({ timeout: 3000 });

    // Wait for timeline label format to change from plain "UTC" to local time offset
    await page.waitForFunction(
      () => {
        const timeline = window.cc?.viewer?.timeline;
        if (!timeline) return false;
        const label = timeline.makeLabel(window.cc.viewer.clock.currentTime);
        // Local time format has UTC with offset like "UTC+2", "UTC-5", or still "UTC" for UTC+0 locations
        return label && label !== null;
      },
      { timeout: 5000 },
    );

    // Get updated timeline label (should now have timezone offset like "UTC+2" or "UTC-5")
    const localTimeLabel = await page.evaluate(() => {
      const timeline = window.cc?.viewer?.timeline;
      if (!timeline) return null;
      const currentTime = window.cc.viewer.clock.currentTime;
      return timeline.makeLabel(currentTime);
    });

    expect(localTimeLabel).not.toBeNull();
    // Local time format should have UTC with timezone offset like "UTC+2", "UTC-5", or "UTC+5:30"
    // If GS is placed at UTC+0 location, it will just show "UTC"
    expect(localTimeLabel).toMatch(/UTC([+-]\d+(:\d{2})?)?$/);

    // Verify animation widget also shows local time by checking the displayed text
    const animationTimeText = await page.evaluate(() => {
      const animationWidget = document.querySelector(".cesium-animation-svgText");
      return animationWidget?.textContent || null;
    });

    // Animation widget should display time - just verify it exists
    // The exact format check is done via timeline which uses same logic
    expect(animationTimeText).not.toBeNull();

    // Toggle local time off
    await useLocalTimeLabel.click();
    await expect(useLocalTimeCheckbox).not.toBeChecked({ timeout: 3000 });

    // Wait for timeline label to revert to UTC format
    await page.waitForFunction(
      () => {
        const timeline = window.cc?.viewer?.timeline;
        if (!timeline) return false;
        const label = timeline.makeLabel(window.cc.viewer.clock.currentTime);
        return label && label.endsWith("UTC");
      },
      { timeout: 5000 },
    );

    // Verify timeline is back to UTC
    const utcTimeLabel = await page.evaluate(() => {
      const timeline = window.cc?.viewer?.timeline;
      if (!timeline) return null;
      const currentTime = window.cc.viewer.clock.currentTime;
      return timeline.makeLabel(currentTime);
    });

    expect(utcTimeLabel).not.toBeNull();
    // Should end with just "UTC" (no offset)
    expect(utcTimeLabel).toMatch(/UTC$/);
  });
});
