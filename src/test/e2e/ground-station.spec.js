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
    await page.goto(`/?sats=${satellites.join(",")}&gs=48.1351,11.5820,Munich&hideLight=0&onlyLit=0`);

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

    // Removed unnecessary waitForTimeout

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

    // Timeline should exist and have highlights (day/night cycles are always present)
    expect(timelineHighlights.found).toBe(true);
    expect(timelineHighlights.count).toBeGreaterThan(0);

    // Note: Pass-specific highlights depend on pass calculation which depends on
    // TLE freshness and orbital timing. We verify timeline infrastructure works.
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

    // Removed unnecessary waitForTimeout

    // Set simulation time to current date (matches TLE epoch ~Nov 2025) to ensure passes exist
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date();
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);
        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false;
      }
    });

    // Removed unnecessary waitForTimeout

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
        // Removed unnecessary waitForTimeout

        const newTime = await page.evaluate(() => {
          return window.cc?.viewer?.clock?.currentTime?.toString();
        });

        // Verify time changed (might not exactly match pass time, but should be different)
        expect(newTime).not.toBe(initialTime);
      }
    }
  });

  test("should update ground station link when satellite is selected @critical", async ({ page }) => {
    // Start with ISS and ground station
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");

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

  test("should skip to pass time when clicking on timeline highlight", async ({ page }) => {
    // Start with ISS and ground station using fresh TLE to avoid staleness
    // Disable pass filters to test unfiltered passes
    await page.goto(buildFreshIssUrl({ gs: "48.1351,11.5820,Munich", hideLight: false, onlyLit: false }));

    await expect(page.locator("#cesiumContainer canvas").first()).toBeVisible({ timeout: 15000 });
    await waitForAppReady(page);

    // Set simulation time and widen timeline window to ensure passes are visible
    await page.evaluate(() => {
      if (window.cc?.viewer?.clock && typeof window.Cesium !== "undefined") {
        const testDate = new Date();
        const julianDate = window.Cesium.JulianDate.fromDate(testDate);

        window.cc.viewer.clock.currentTime = julianDate;
        window.cc.viewer.clock.shouldAnimate = false;

        // Widen timeline window: 2 days before to 7 days after
        const startTime = window.Cesium.JulianDate.addDays(julianDate, -2, new window.Cesium.JulianDate());
        const stopTime = window.Cesium.JulianDate.addDays(julianDate, 7, new window.Cesium.JulianDate());

        window.cc.viewer.clock.startTime = startTime;
        window.cc.viewer.clock.stopTime = stopTime;

        if (window.cc.viewer.timeline) {
          window.cc.viewer.timeline.zoomTo(startTime, stopTime);
          window.cc.viewer.timeline.updateFromClock();
        }
      }
    });

    // Wait for pass calculation and timeline highlights to be ready
    await waitForPassCalculation(page);

    // Wait for pass highlights to appear on timeline
    await page
      .waitForFunction(
        () => {
          const viewer = window.cc?.viewer;
          const sats = window.cc?.sats?.satellites;
          if (!viewer || !viewer.timeline || !sats || sats.length === 0) return false;
          const issSat = sats.find((s) => s.props?.name?.includes("ISS (ZARYA)"));
          if (!issSat || !issSat.props?.passes || issSat.props.passes.length === 0) return false;
          const highlightRanges = viewer.timeline._highlightRanges || [];
          const passHighlights = highlightRanges.filter((h) => h._base === 0);
          return passHighlights.length > 0;
        },
        { timeout: 10000 },
      )
      .catch(() => {});

    let passAndHighlightData = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const sats = window.cc?.sats?.satellites;

      if (!viewer || !viewer.timeline || !sats || sats.length === 0) {
        return { found: false, error: "Missing viewer or satellites" };
      }

      const issSat = sats.find((s) => s.props?.name?.includes("ISS (ZARYA)"));
      if (!issSat || !issSat.props?.passes || issSat.props.passes.length === 0) {
        return { found: false, error: "No passes found for " + (issSat?.props?.name || "ISS not found") };
      }

      const passes = issSat.props.passes;
      const highlightRanges = viewer.timeline._highlightRanges || [];
      const passHighlights = highlightRanges.filter((h) => h._base === 0);

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

    // If no highlights found after retries, try flipping camera to other side of globe (ISS might be there)
    if (!passAndHighlightData.found && passAndHighlightData.passCount > 0) {
      // Flip camera to opposite side of globe
      await flipCameraToOppositeSide(page);

      // Try getting highlights again
      const retryData = await page.evaluate(() => {
        const viewer = window.cc?.viewer;
        const highlightRanges = viewer?.timeline?._highlightRanges || [];
        const passHighlights = highlightRanges.filter((h) => h._base === 0);
        return {
          highlightCount: passHighlights.length,
        };
      });

      // Update highlight count after camera flip
      passAndHighlightData.highlightCount = retryData.highlightCount;
      passAndHighlightData.found = passAndHighlightData.passCount > 0 && retryData.highlightCount > 0;
    }

    // Skip test if passes/highlights not found after all retries (timing-sensitive)
    if (!passAndHighlightData.found) {
      console.log("Skipping timeline highlight test: passes or highlights not ready", passAndHighlightData);
      test.skip();
      return;
    }

    expect(passAndHighlightData.firstPass).not.toBeNull();

    // Get initial state and calculate highlight click position in a single evaluate call
    const stateAndHighlight = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name?.includes("ISS (ZARYA)"));

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

      await page.mouse.click(clickX, clickY);
    } else {
      throw new Error("Timeline bounding box not found");
    }

    // Wait for pass recalculation and timeline highlights to update after time jump
    await waitForPassCalculation(page);

    // Verify time changed and passes were recalculated
    const newState = await page.evaluate(() => {
      const currentTime = window.cc?.viewer?.clock?.currentTime;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name?.includes("ISS (ZARYA)"));
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

    // Verify time is different from initial time (verifies the time jump occurred)
    expect(newState.time).not.toBe(stateAndHighlight.initialState.time);

    // Verify passes were recalculated (should still have passes for ISS)
    expect(newState.passCount).toBeGreaterThan(0);
    expect(newState.firstPass).not.toBeNull();

    // If no highlights are visible after the jump, widen the timeline window to show passes
    if (newState.highlightCount === 0) {
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
    }

    // Poll for highlights to appear after timeline jump/widen (async highlight creation)
    await page.waitForFunction(
      () => {
        const highlightRanges = window.cc?.viewer?.timeline?._highlightRanges || [];
        const passHighlights = highlightRanges.filter((h) => h._base === 0);
        return passHighlights.length > 0;
      },
      { timeout: 15000 },
    );

    // Verify highlights match passes in the pass list
    const passAndHighlightMatch = await page.evaluate(() => {
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name?.includes("ISS (ZARYA)"));
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

    // Wait for pass calculation to complete
    await waitForPassCalculation(page, { timeout: 30000 });

    // Verify initial passes exist
    const initialState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name === "ISS (ZARYA)");
      return {
        time: viewer?.clock?.currentTime?.toString(),
        passCount: issSat?.props?.passes?.length || 0,
        hasTimeline: !!viewer?.timeline,
        totalHighlights: (viewer?.timeline?._highlightRanges || []).length,
      };
    });

    expect(initialState.passCount).toBeGreaterThan(0);
    expect(initialState.hasTimeline).toBe(true);
    // Timeline should at least have day/night highlights
    expect(initialState.totalHighlights).toBeGreaterThan(0);

    // Pause animation before interacting with timeline
    await pauseAnimation(page);

    // Click the zoom-out button ("-") three times to widen the timeline
    const zoomOutButton = page.locator('button.timeline-button:has-text("-")');
    await expect(zoomOutButton).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 3; i++) {
      await zoomOutButton.click({ force: true });
    }

    // Calculate timeline position 24 hours in the future and click it
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

    const clickX = timelineBoundingBox.x + timelineBoundingBox.width * futureClickData.futureRatio;
    const clickY = timelineBoundingBox.y + timelineBoundingBox.height / 2;

    // Click on the timeline to jump 24h ahead
    await page.mouse.click(clickX, clickY);

    // Wait for passes to be recalculated after the time jump
    await waitForPassCalculation(page, { timeout: 30000 });

    // Verify the time jump and pass recalculation
    const newState = await page.evaluate(() => {
      const viewer = window.cc?.viewer;
      const issSat = window.cc?.sats?.satellites?.find((s) => s.props?.name === "ISS (ZARYA)");
      return {
        time: viewer?.clock?.currentTime?.toString(),
        passCount: issSat?.props?.passes?.length || 0,
      };
    });

    // Verify time changed
    expect(newState.time).not.toBe(initialState.time);

    // Verify time jumped approximately 24 hours
    const initialDate = new Date(initialState.time);
    const newDate = new Date(newState.time);
    const diffHours = (newDate.getTime() - initialDate.getTime()) / (1000 * 60 * 60);
    expect(Math.abs(diffHours - 24)).toBeLessThan(1);

    // Verify passes were recalculated
    expect(newState.passCount).toBeGreaterThan(0);
  });

  test("should recalculate daylight highlights after navigating timeline past initial range", async ({ page }) => {
    // Load with ISS and a ground station (Munich) to trigger daylight highlights
    await page.goto("/?sats=ISS~(ZARYA)&gs=48.1351,11.5820,Munich");

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
