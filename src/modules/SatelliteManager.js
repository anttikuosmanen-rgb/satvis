import {
  CameraEventType,
  Cartesian2,
  Cartesian3,
  ClockStep,
  Color,
  Entity,
  HorizontalOrigin,
  JulianDate,
  KeyboardEventModifier,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  Ray,
  ScreenSpaceEventType,
  Transforms,
  VerticalOrigin,
} from "@cesium/engine";
import { useSatStore } from "../stores/sat";
import { SatelliteComponentCollection } from "./SatelliteComponentCollection";
import { SatelliteProperties } from "./SatelliteProperties";
import { GroundStationEntity } from "./GroundStationEntity";

import { CesiumCleanupHelper } from "./util/CesiumCleanupHelper";
import { CesiumTimelineHelper } from "./util/CesiumTimelineHelper";
import { filterAndSortPasses } from "./util/PassFilter";
import { GroundStationConditions } from "./util/GroundStationConditions";
import { LoadingSpinner } from "./util/LoadingSpinner";
import { formatZenithTooltip, formatSunTooltip } from "./util/zenithViewHelper";

export class SatelliteManager {
  #enabledComponents = ["Point", "Label"];

  #enabledTags = new Set();

  #enabledSatellites = new Set();

  #groundStations = [];

  #overpassMode = "elevation";

  // Pass calculation state tracking to prevent race conditions
  #passCalculationInProgress = false;
  #currentPassCalculation = null;

  constructor(viewer) {
    this.viewer = viewer;

    this.satellites = [];
    this.satellitesByCanonical = new Map(); // O(1) lookup by canonical name -> sat[]
    this.availableComponents = ["Point", "Label", "Orbit", "Orbit track", "Visibility area", "Height stick"];

    // Track whether initial TLE loading is complete
    // This prevents showing satellites before TLE data is loaded (race condition fix)
    this._initialTleLoadComplete = false;

    // Initialize loading spinner
    this.loadingSpinner = new LoadingSpinner(viewer);

    // Initialize pass highlight update debounce timer
    this.passHighlightUpdateTimer = null;

    // Cache debug logging state to avoid repeated store access
    // Initialize as false, will be set up when store is available
    this._debugLoggingEnabled = false;
    this._debugLoggingSetup = false;

    // Flag to prevent pass updates while satellite database is being modified
    this._isUpdatingSatellites = false;

    // State for spacebar toggle functionality
    this.lastTrackedSatelliteName = null; // Persists across deselection
    this.lastGlobeView = null; // Stores camera position/orientation

    this.viewer.trackedEntityChanged.addEventListener(() => {
      if (this.trackedSatellite) {
        this.getSatellite(this.trackedSatellite).show(this.#enabledComponents);
        // Persist the satellite name for spacebar toggle
        this.lastTrackedSatelliteName = this.trackedSatellite;
      }
      useSatStore().trackedSatellite = this.trackedSatellite;
    });

    // Add timeline change listener to recalculate daytime ranges when needed
    this.setupTimelineChangeListener();

    // Add listener for timeline marker (current time) changes
    this.setupPassHighlightUpdateListener();
  }

  // Setup debug logging subscription (call once when store is available)
  #setupDebugLogging() {
    if (this._debugLoggingSetup) {
      return;
    }
    try {
      const satStore = useSatStore();
      satStore.$subscribe((_mutation, state) => {
        this._debugLoggingEnabled = state.debugConsoleLog;
      });
      this._debugLoggingEnabled = satStore.debugConsoleLog;
      this._debugLoggingSetup = true;
    } catch {
      // Store not available yet, will try again on next call
    }
  }

  // Helper method for debug logging
  #debugLog(...args) {
    // Setup subscription on first call (when store is available)
    if (!this._debugLoggingSetup) {
      this.#setupDebugLogging();
    }
    if (this._debugLoggingEnabled) {
      console.log(...args);
    }
  }

  setupTimelineChangeListener() {
    if (!this.viewer.clock) {
      return;
    }

    // Listen for clock range changes
    this.viewer.clock.onTick.addEventListener(() => {
      // Only check occasionally (every 60 ticks) to avoid performance issues
      if (this.viewer.clock.clockStep === ClockStep.SYSTEM_CLOCK || this.viewer.clock.clockStep === ClockStep.TICK_DEPENDENT) {
        return; // Don't check during normal time progression
      }

      // Throttle checks - only check every 60 frames
      if (!this._lastTimelineCheck) {
        this._lastTimelineCheck = 0;
      }
      this._lastTimelineCheck++;
      if (this._lastTimelineCheck % 60 !== 0) {
        return;
      }

      this.checkAndUpdateDaytimeRanges();
    });

    // Also listen for timeline zoom events by checking start/stop time changes
    let lastStartTime = this.viewer.clock.startTime;
    let lastStopTime = this.viewer.clock.stopTime;

    const checkTimelineChange = () => {
      const currentStart = this.viewer.clock.startTime;
      const currentStop = this.viewer.clock.stopTime;

      if (!JulianDate.equals(lastStartTime, currentStart) || !JulianDate.equals(lastStopTime, currentStop)) {
        lastStartTime = JulianDate.clone(currentStart);
        lastStopTime = JulianDate.clone(currentStop);

        // Delay the check slightly to avoid multiple rapid updates
        setTimeout(() => this.checkAndUpdateDaytimeRanges(), 100);
      }
    };

    // Check for timeline changes periodically (every 10 seconds instead of 1 second)
    // With 60-day buffer, we rarely need to recalculate daytime ranges
    setInterval(checkTimelineChange, 10000);

    // Debounce mechanism for timeline events to avoid excessive recalculations
    let debounceTimer = null;
    const debouncedDaytimeCheck = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        try {
          // First constrain timeline bounds to prevent invalid dates
          if (window.cc && window.cc.constrainTimelineBounds) {
            window.cc.constrainTimelineBounds();
          }
          this.checkAndUpdateDaytimeRanges();
        } catch (error) {
          console.error("Error in debounced daytime check:", error);
        }
      }, 500); // Wait 500ms after last event before recalculating
    };

    // Also add direct event listeners to the timeline widget for more responsive updates
    if (this.viewer.timeline && this.viewer.timeline.container) {
      const timelineContainer = this.viewer.timeline.container;

      // Listen for wheel events (scrolling) with debouncing
      timelineContainer.addEventListener("wheel", debouncedDaytimeCheck);

      // Listen for mouse events that might change timeline with debouncing
      ["mouseup", "touchend"].forEach((eventType) => {
        timelineContainer.addEventListener(eventType, debouncedDaytimeCheck);
      });
    }
  }

  async checkAndUpdateDaytimeRanges() {
    try {
      if (this.#groundStations.length > 0) {
        const firstGroundStation = this.#groundStations[0];
        if (CesiumTimelineHelper.needsRecalculation(this.viewer, firstGroundStation)) {
          CesiumTimelineHelper.clearGroundStationDaytimeRanges(this.viewer);
          await CesiumTimelineHelper.addGroundStationDaytimeRanges(this.viewer, firstGroundStation);
        }
      }
    } catch (error) {
      console.error("Error updating daytime ranges:", error);
    }
  }

  setupPassHighlightUpdateListener() {
    // Debounced update function
    const schedulePassHighlightUpdate = () => {
      // Clear existing debounce timer
      if (this.passHighlightUpdateTimer) {
        this.#debugLog("[schedulePassHighlightUpdate] Clearing existing timer");
        clearTimeout(this.passHighlightUpdateTimer);
      }

      this.#debugLog("[schedulePassHighlightUpdate] Setting 3-second timer");
      // Set new debounce timer - wait 3 seconds after last change before updating
      this.passHighlightUpdateTimer = setTimeout(() => {
        this.#debugLog("[schedulePassHighlightUpdate] Timer fired after 3 seconds");
        this.updatePassHighlightsAfterTimelineChange();
      }, 3000);
    };

    // Listen for ClockMonitor time jump events
    if (typeof window !== "undefined") {
      window.addEventListener("cesium:clockTimeJumped", () => {
        schedulePassHighlightUpdate();
      });
    }

    // Listen to timeline widget events for interactions
    if (this.viewer.timeline && this.viewer.timeline.container) {
      const timelineContainer = this.viewer.timeline.container;

      // When user releases mouse/touch after scrubbing, schedule update
      ["mouseup", "touchend"].forEach((eventType) => {
        timelineContainer.addEventListener(eventType, () => {
          this.#debugLog("[setupPassHighlightUpdateListener] Timeline interaction ended (mouseup/touchend), scheduling update");
          schedulePassHighlightUpdate();
        });
      });

      // Also handle click events (for clicking on timeline directly without drag)
      timelineContainer.addEventListener("click", () => {
        this.#debugLog("[setupPassHighlightUpdateListener] Timeline clicked, scheduling update");
        schedulePassHighlightUpdate();
      });
    }

    // Listen for clock onStop event (triggered by animation controls like pause button)
    this.viewer.clock.onStop.addEventListener(() => {
      this.#debugLog("[setupPassHighlightUpdateListener] Clock stopped, scheduling update");
      schedulePassHighlightUpdate();
    });

    // IMPORTANT: Also listen to the Animation widget's realtime button specifically
    // The Cesium Animation widget has buttons that directly manipulate the clock
    if (this.viewer.animation && this.viewer.animation.container) {
      const animationContainer = this.viewer.animation.container;

      // Listen for any click events on the animation widget
      // The realtime button (clock/watch icon) will trigger a time change
      animationContainer.addEventListener("click", () => {
        this.#debugLog("[setupPassHighlightUpdateListener] Animation widget clicked");
        // Always schedule update when animation widget is clicked, as the button
        // might have caused a significant time jump (e.g., realtime button)
        setTimeout(() => {
          const currentTime = this.viewer.clock.currentTime;
          this.#debugLog("[setupPassHighlightUpdateListener] Current time after animation click:", JulianDate.toDate(currentTime));
          this.#debugLog("[setupPassHighlightUpdateListener] Scheduling update after animation click");
          schedulePassHighlightUpdate();
        }, 100);
      });
    }
  }

  updatePassHighlightsAfterTimelineChange() {
    this.#debugLog("[updatePassHighlightsAfterTimelineChange] Timeline changed, triggering pass recalculation");

    // Skip if satellite database is being updated
    if (this._isUpdatingSatellites) {
      this.#debugLog("[updatePassHighlightsAfterTimelineChange] Satellites are being updated, skipping");
      return;
    }

    // Skip timeline highlight updates during fast playback to avoid performance degradation
    // At high clock multipliers (>10x), timeline highlights would be updated too frequently
    // causing excessive DOM manipulation and severe FPS drops
    const clockMultiplier = Math.abs(this.viewer.clock.multiplier || 1);
    if (clockMultiplier > 10) {
      this.#debugLog(`[updatePassHighlightsAfterTimelineChange] Clock multiplier is ${clockMultiplier}x, skipping timeline highlight update for performance`);
      return;
    }

    // Skip if no ground station or no active satellites
    if (this.#groundStations.length === 0 || this.activeSatellites.length === 0) {
      this.#debugLog("[updatePassHighlightsAfterTimelineChange] No GS or satellites, skipping");
      return;
    }

    const selectedEntity = this.viewer.selectedEntity;

    if (!selectedEntity) {
      this.#debugLog("[updatePassHighlightsAfterTimelineChange] No selected entity, skipping");
      return;
    }

    this.#debugLog("[updatePassHighlightsAfterTimelineChange] Selected entity:", selectedEntity.name);
    this.#debugLog("[updatePassHighlightsAfterTimelineChange] Current time:", JulianDate.toDate(this.viewer.clock.currentTime));

    // For ground stations, invalidate the ground station pass cache and trigger async pass updates
    // This ensures fresh passes are calculated from the new timeline position
    if (selectedEntity.name && selectedEntity.name.includes("Groundstation")) {
      this.#debugLog("[updatePassHighlightsAfterTimelineChange] Invalidating ground station cache and updating passes");

      // First, invalidate caches
      this.#groundStations.forEach((gs) => {
        if (gs.invalidatePassCache) {
          gs.invalidatePassCache();
        }
      });

      // Invalidate satellite pass intervals to force recalculation
      // This is necessary because updatePasses() skips if current time is within existing passInterval
      this.activeSatellites.forEach((sat) => {
        if (sat.props) {
          sat.props.passInterval = undefined;
        }
      });

      // Then trigger async pass calculations for all active satellites
      const currentTime = this.viewer.clock.currentTime;
      const passPromises = this.activeSatellites.map((sat) =>
        sat.props.updatePasses(currentTime).catch((err) => {
          console.warn(`[updatePassHighlightsAfterTimelineChange] Failed to update passes for ${sat.props.name}:`, err);
        }),
      );

      // When pass calculations complete, update highlights and force a description refresh
      Promise.all(passPromises).then(() => {
        this.#debugLog("[updatePassHighlightsAfterTimelineChange] Pass calculations complete, updating highlights and refreshing description");

        // Clear existing highlights
        CesiumTimelineHelper.clearHighlightRanges(this.viewer);

        // Update timeline highlights with new passes - use batched filtering for performance
        const currentJsDate = JulianDate.toDate(currentTime);
        this.#debugLog(`[updatePassHighlightsAfterTimelineChange] Filtering passes for time: ${currentJsDate.toISOString()}`);

        // Collect all satellites with passes
        const satellitesWithPasses = this.activeSatellites
          .filter((sat) => sat.props.passes && sat.props.passes.length > 0)
          .map((sat) => ({
            name: sat.props.name,
            passes: sat.props.passes,
          }));

        if (satellitesWithPasses.length === 0) {
          this.#debugLog("[updatePassHighlightsAfterTimelineChange] No satellites with passes");
          // Continue to refresh description and render even if no passes
        } else {
          // Get filter state once for all satellites
          const satStore = useSatStore();
          const filterState = {
            hideSunlightPasses: satStore.hideSunlightPasses,
            showOnlyLitPasses: satStore.showOnlyLitPasses,
          };

          // Get VISIBLE timeline window bounds for filtering passes
          // Use timeline._startJulian/_endJulian which reflect the user's zoomed view
          // NOT clock.startTime/stopTime which are the clock simulation bounds
          const timeline = this.viewer.timeline;
          const timelineStart = timeline?._startJulian ? JulianDate.toDate(timeline._startJulian) : JulianDate.toDate(this.viewer.clock.startTime);
          const timelineStop = timeline?._endJulian ? JulianDate.toDate(timeline._endJulian) : JulianDate.toDate(this.viewer.clock.stopTime);
          const timelineStartMs = timelineStart.getTime();
          const timelineStopMs = timelineStop.getTime();
          const currentTimeMs = currentJsDate.getTime();

          this.#debugLog(`[updatePassHighlightsAfterTimelineChange] Timeline window: ${timelineStart.toISOString()} to ${timelineStop.toISOString()}`);

          // Collect ALL passes from all satellites, filter, and sort globally by proximity to current time
          // This ensures passes closest to current simulation time are prioritized across all satellites
          const maxTotalHighlights = 100; // Maximum highlights across all satellites

          // Collect all passes with their satellite name
          const allPasses = [];
          satellitesWithPasses.forEach(({ name, passes }) => {
            this.#debugLog(`[updatePassHighlightsAfterTimelineChange] ${name}: ${passes.length} total passes`);

            passes.forEach((pass) => {
              const passStartMs = new Date(pass.start).getTime();
              const passEndMs = new Date(pass.end).getTime();

              // Filter to timeline window
              if (passEndMs < timelineStartMs || passStartMs > timelineStopMs) {
                return;
              }

              // Filter epoch passes
              if (pass.epochInFuture && pass.epochTime) {
                const epochMinus90 = new Date(pass.epochTime.getTime() - 90 * 60 * 1000);
                const passStart = new Date(pass.start);
                if (passStart < epochMinus90) {
                  return;
                }
              }

              // Filter sunlight passes if enabled
              if (filterState.hideSunlightPasses) {
                if (!pass.groundStationDarkAtStart && !pass.groundStationDarkAtEnd) {
                  return;
                }
              }

              // Filter eclipsed passes if enabled
              if (filterState.showOnlyLitPasses) {
                const litAtStart = !pass.satelliteEclipsedAtStart;
                const litAtEnd = !pass.satelliteEclipsedAtEnd;
                const hasTransitions = pass.eclipseTransitions && pass.eclipseTransitions.length > 0;
                if (!litAtStart && !litAtEnd && !hasTransitions) {
                  return;
                }
              }

              // Calculate distance from current time for sorting
              const passMidMs = (passStartMs + passEndMs) / 2;
              const distanceFromCurrent = Math.abs(passMidMs - currentTimeMs);

              allPasses.push({
                satelliteName: name,
                pass,
                distanceFromCurrent,
              });
            });
          });

          this.#debugLog(`[updatePassHighlightsAfterTimelineChange] Total passes after filtering: ${allPasses.length}`);

          // Sort all passes globally by distance from current time (nearest first)
          allPasses.sort((a, b) => a.distanceFromCurrent - b.distanceFromCurrent);

          // Take the top N closest passes
          const closestPasses = allPasses.slice(0, maxTotalHighlights);
          this.#debugLog(`[updatePassHighlightsAfterTimelineChange] Selected ${closestPasses.length} closest passes`);

          // Group passes by satellite for adding highlights
          const passesBySatellite = new Map();
          closestPasses.forEach(({ satelliteName, pass }) => {
            if (!passesBySatellite.has(satelliteName)) {
              passesBySatellite.set(satelliteName, []);
            }
            passesBySatellite.get(satelliteName).push(pass);
          });

          // Add highlights for each satellite (skip per-satellite limit since we've already globally limited)
          let totalPassesAdded = 0;
          passesBySatellite.forEach((passes, satelliteName) => {
            CesiumTimelineHelper.addHighlightRanges(this.viewer, passes, satelliteName, { skipPerSatelliteLimit: true });
            totalPassesAdded += passes.length;
          });

          this.#debugLog(`[updatePassHighlightsAfterTimelineChange] Total ${totalPassesAdded} passes added to timeline`);
        }

        // Force timeline widget update
        if (this.viewer.timeline) {
          this.viewer.timeline.updateFromClock();
          if (this.viewer.timeline._makeTics) {
            this.viewer.timeline._makeTics();
          }
        }

        // Refresh ground station description to update the pass list
        this.#groundStations.forEach((gs) => {
          if (gs.refreshDescription) {
            gs.refreshDescription();
          }
        });

        // Request render to update the UI
        if (this.viewer && this.viewer.scene) {
          this.viewer.scene.requestRender();
        }

        // Dispatch event: pass calculation completed
        // This event is used by E2E tests to wait for calculation completion
        window.dispatchEvent(
          new CustomEvent("satvis:passCalculationComplete", {
            detail: {
              source: "updatePassHighlightsAfterTimelineChange",
              satelliteCount: this.activeSatellites.length,
            },
          }),
        );
      });
    } else {
      // For satellites, trigger recalculation by temporarily clearing and restoring the selection
      // This invokes the existing pass calculation logic in SatelliteComponentCollection
      const entity = selectedEntity;
      this.#debugLog("[updatePassHighlightsAfterTimelineChange] Unselecting entity");
      this.viewer.selectedEntity = undefined;

      // Use a slightly longer delay to ensure the unselect event completes
      setTimeout(() => {
        this.#debugLog("[updatePassHighlightsAfterTimelineChange] Re-selecting entity");
        this.viewer.selectedEntity = entity;
      }, 50);
    }
  }

  addFromTleUrls(urlTagList) {
    // Initiate async download of all TLE URLs and update store afterwards
    const promises = urlTagList.map(([url, tags]) => this.addFromTleUrl(url, tags, false));
    return Promise.all(promises).then(() => {
      this.updateStore();

      // Mark initial TLE loading as complete and show satellites
      // This ensures satellites from URL parameters are shown after TLE data loads
      if (!this._initialTleLoadComplete) {
        this._initialTleLoadComplete = true;
        // Now show the satellites that were enabled via URL parameters
        if (this.#enabledSatellites.size > 0 || this.#enabledTags.size > 0) {
          this.invalidateGroundStationCaches();
          this.showEnabledSatellites();
          // Note: updatePassHighlightsForEnabledSatellites() is called automatically
          // when showEnabledSatellites() completes (after batch processing)
        }
      }
    });
  }

  addFromTleUrl(url, tags, updateStore = true) {
    return fetch(url, {
      mode: "no-cors",
    })
      .then((response) => {
        if (!response.ok) {
          throw Error(response.statusText);
        }
        return response;
      })
      .then((response) => response.text())
      .then((data) => {
        const lines = data.split(/\r?\n/);
        for (let i = 3; i < lines.length; i += 3) {
          const tle = lines.slice(i - 3, i).join("\n");
          this.addFromTle(tle, tags, updateStore);
        }
      })
      .catch((error) => {
        console.log(error);
      });
  }

  addFromTle(tle, tags, updateStore = true) {
    const sat = new SatelliteComponentCollection(this.viewer, tle, tags);
    // Wire launchSiteManager reference to satellite for pre-launch position override
    if (this.launchSiteManager) {
      sat.props._launchSiteManager = this.launchSiteManager;
    }
    this.#add(sat);
    if (updateStore) {
      this.updateStore();
    }
  }

  #add(newSat) {
    const canonical = newSat.props.canonicalName;

    // Initialize array for this canonical name if needed
    if (!this.satellitesByCanonical.has(canonical)) {
      this.satellitesByCanonical.set(canonical, []);
    }

    const existing = this.satellitesByCanonical.get(canonical);

    // Check for true duplicate (same canonical name AND same TLE signature AND same prefix)
    // Prefix check ensures [Snapshot] satellites aren't merged with originals even if TLE matches
    const exactDuplicate = existing.find((s) => s.props.tleSignature === newSat.props.tleSignature && s.props.displayPrefix === newSat.props.displayPrefix);

    if (exactDuplicate) {
      // True duplicate - just merge tags, no need to replace
      exactDuplicate.props.addTags(newSat.props.tags);
      return;
    }

    // Check for TLE update (same canonical name AND same NORAD number, but different TLE)
    // This handles the case where TLE files are refreshed with updated orbital elements
    const samePhysicalSatellite = existing.find((s) => s.props.satnum === newSat.props.satnum && s.props.displayPrefix === newSat.props.displayPrefix);

    if (samePhysicalSatellite) {
      // Same physical satellite (same satnum and prefix) - update with newer TLE
      // Merge tags from existing satellite into new one
      newSat.props.addTags(samePhysicalSatellite.props.tags);

      // Clean up old satellite entities from Cesium viewer
      if (samePhysicalSatellite.hide) {
        samePhysicalSatellite.hide();
      }

      // Invalidate pass cache
      if (samePhysicalSatellite.invalidatePassCache) {
        samePhysicalSatellite.invalidatePassCache();
      }

      // Remove old satellite from collections
      const satIndex = this.satellites.indexOf(samePhysicalSatellite);
      if (satIndex !== -1) {
        this.satellites.splice(satIndex, 1);
      }
      const existingIndex = existing.indexOf(samePhysicalSatellite);
      if (existingIndex !== -1) {
        existing.splice(existingIndex, 1);
      }

      // Continue to add the new satellite with updated TLE data below
    } else if (existing.some((s) => s.props.displayPrefix === newSat.props.displayPrefix)) {
      // Same canonical name and same prefix but different NORAD ID - disambiguate
      // This handles cases like multiple "StarSh" satellites in classified catalogs
      // Skip disambiguation when prefixes differ (e.g., original vs [Snapshot] version)

      // Rename existing satellites with same prefix that don't already have NORAD ID appended
      for (const sat of existing) {
        if (sat.props.displayPrefix === newSat.props.displayPrefix && sat.props.satnum !== newSat.props.satnum && !sat.props.name.includes(`[${sat.props.satnum}]`)) {
          const newName = `${sat.props.canonicalName} [${sat.props.satnum}]`;
          sat.props.name = newName;
          sat.props.orbit.name = newName;
          if (sat.components?.Point) {
            sat.components.Point.name = newName;
          }
        }
      }

      // Rename the new satellite to include its NORAD ID
      newSat.props.name = `${newSat.props.canonicalName} [${newSat.props.satnum}]`;
      newSat.props.orbit.name = newSat.props.name;
    }

    // New satellite or TLE update - add to collections
    if (this.groundStationAvailable) {
      newSat.groundStations = this.#groundStations;
    }
    // Set overpass mode for newly added satellite
    newSat.props.overpassMode = this.#overpassMode;
    this.satellites.push(newSat);
    existing.push(newSat);

    if (this.satIsActive(newSat)) {
      newSat.show(this.#enabledComponents);
      if (this.pendingTrackedSatellite === newSat.props.name) {
        this.trackedSatellite = newSat.props.name;
      }
    }
  }

  updateStore() {
    const satStore = useSatStore();
    satStore.availableTags = this.tags;
    satStore.availableSatellitesByTag = this.taglist;

    // Dispatch event that satellites have been loaded
    window.dispatchEvent(new CustomEvent("satellitesLoaded"));

    // Refresh labels to pick up new dynamic elevation text behavior
    setTimeout(() => this.refreshLabels(), 1000);

    // If ground station exists and we have active satellites, trigger pass calculation
    // This handles the case where satellites finish loading after URL state (including
    // overpass mode) has already been applied
    if (this.#groundStations.length > 0 && this.activeSatellites.length > 0) {
      this.recalculatePassesAsync();
    }
  }

  get taglist() {
    const taglist = {};
    this.satellites.forEach((sat) => {
      // Skip stale satellites (decayed or TLE too old for reliable propagation)
      if (sat.props.isStale) {
        return;
      }
      sat.props.tags.forEach((tag) => {
        (taglist[tag] = taglist[tag] || []).push(sat.props.name);
      });
    });
    // Sort satellites within each tag
    Object.values(taglist).forEach((sats) => {
      sats.sort();
    });
    // Return with keys sorted alphabetically
    const sortedKeys = Object.keys(taglist).sort((a, b) => a.localeCompare(b));
    const sortedTaglist = {};
    sortedKeys.forEach((key) => {
      sortedTaglist[key] = taglist[key];
    });
    return sortedTaglist;
  }

  /**
   * Returns a map of satellite name to NORAD catalog number
   * Used for searching satellites by NORAD ID
   * @returns {Object} Map of satellite name to satnum (NORAD ID)
   */
  get satelliteNoradMap() {
    const noradMap = {};
    this.satellites.forEach((sat) => {
      if (!sat.props.isStale) {
        noradMap[sat.props.name] = sat.props.satnum;
      }
    });
    return noradMap;
  }

  get selectedSatellite() {
    const satellite = this.satellites.find((sat) => sat.isSelected);
    return satellite ? satellite.props.name : "";
  }

  get trackedSatellite() {
    const satellite = this.satellites.find((sat) => sat.isTracked);
    return satellite ? satellite.props.name : "";
  }

  set trackedSatellite(name) {
    if (!name) {
      if (this.trackedSatellite) {
        this.viewer.trackedEntity = undefined;
      }
      return;
    }
    if (name === this.trackedSatellite) {
      return;
    }

    const sat = this.getSatellite(name);
    if (sat) {
      sat.track();
      this.pendingTrackedSatellite = undefined;
    } else {
      // Satellite does not exist (yet?)
      this.pendingTrackedSatellite = name;
    }
  }

  get visibleSatellites() {
    return this.satellites.filter((sat) => sat.created);
  }

  get satelliteNames() {
    return this.satellites.map((sat) => sat.props.name);
  }

  /**
   * Primary lookup method - handles any name format (with or without prefixes/suffixes)
   * @param {string} name - Satellite name (can include [Snapshot], [Custom] prefix or * suffix)
   * @returns {SatelliteComponentCollection|undefined} The satellite or undefined if not found
   */
  getSatellite(name) {
    // Extract canonical name from search term
    const canonical = SatelliteProperties.extractCanonicalName(name);

    // Look up by canonical name
    const matches = this.satellitesByCanonical.get(canonical) || [];
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0];

    // Multiple satellites with same canonical name (e.g., original + snapshot)
    // First try exact display name match
    const exactMatch = matches.find((s) => s.props.name === name);
    if (exactMatch) return exactMatch;

    // Otherwise return the one without prefix (original), or first match
    return matches.find((s) => !s.props.displayPrefix) || matches[0];
  }

  /**
   * Find satellite with specific prefix (e.g., for snapshot restore)
   * @param {string} canonicalName - Canonical name (may include decorations - will be stripped)
   * @param {string} prefix - The prefix to match (e.g., "[Snapshot] ")
   * @returns {SatelliteComponentCollection|undefined} The satellite with matching prefix
   */
  getSatelliteWithPrefix(canonicalName, prefix) {
    const canonical = SatelliteProperties.extractCanonicalName(canonicalName);
    const matches = this.satellitesByCanonical.get(canonical) || [];
    return matches.find((s) => s.props.displayPrefix === prefix);
  }

  /**
   * Get all satellites with same canonical name
   * @param {string} canonicalName - Canonical name (may include decorations - will be stripped)
   * @returns {SatelliteComponentCollection[]} Array of satellites with matching canonical name
   */
  getSatellitesByCanonical(canonicalName) {
    const canonical = SatelliteProperties.extractCanonicalName(canonicalName);
    return this.satellitesByCanonical.get(canonical) || [];
  }

  refreshLabels() {
    // Force refresh of all existing satellite labels to pick up new dynamic text
    this.visibleSatellites.forEach((sat) => {
      if (sat.components.Label) {
        sat.disableComponent("Label");
        sat.enableComponent("Label");
      }
    });
  }

  get enabledSatellites() {
    return Array.from(this.#enabledSatellites);
  }

  set enabledSatellites(newSats) {
    this.#enabledSatellites = new Set(newSats);

    // Only show satellites if initial TLE loading is complete
    // This prevents race condition where URL parameters are applied before TLE data loads
    if (this._initialTleLoadComplete) {
      this.showEnabledSatellites();

      // Invalidate pass cache since visible satellites changed
      this.invalidateGroundStationCaches();

      // Calculate and display pass highlights if ground station exists
      this.updatePassHighlightsForEnabledSatellites();
    }

    const satStore = useSatStore();
    satStore.enabledSatellites = newSats;
  }

  get tags() {
    const tags = this.satellites.map((sat) => sat.props.tags);
    return [...new Set([].concat(...tags))].sort((a, b) => a.localeCompare(b));
  }

  getSatellitesWithTag(tag) {
    return this.satellites.filter((sat) => sat.props.hasTag(tag));
  }

  /**
   * Returns true if the satellite is enabled by tag or name
   * @param {SatelliteComponentCollection} sat
   * @returns {boolean} true if the satellite is enabled
   */
  satIsActive(sat) {
    // Stale satellites (decayed or TLE too old) should never be active
    if (sat.props.isStale) {
      return false;
    }
    const enabledByTag = sat.props.tags.some((tag) => this.#enabledTags.has(tag));
    const enabledByName = this.#enabledSatellites.has(sat.props.name);
    return enabledByTag || enabledByName;
  }

  get activeSatellites() {
    return this.satellites.filter((sat) => this.satIsActive(sat));
  }

  showEnabledSatellites() {
    // Set flag to prevent pass updates during satellite operations
    this._isUpdatingSatellites = true;

    const toShow = [];
    const toHide = [];

    // First pass: categorize satellites
    this.satellites.forEach((sat) => {
      if (this.satIsActive(sat)) {
        toShow.push(sat);
      } else if (sat.created) {
        // Only hide satellites that have components (were previously shown)
        // Satellites that were never shown don't need to be hidden
        toHide.push(sat);
      }
    });

    // Auto-disable components based on active satellite count BEFORE showing
    // This ensures components are correctly disabled before satellites are shown
    const activeCount = toShow.length;
    const componentsToDisable = [];

    // Define component thresholds
    const thresholds = {
      "Visibility area": 50,
      "Height stick": 100,
      Orbit: 200,
      "Orbit track": 200,
      Label: 500,
    };

    // Check each component against its threshold
    Object.entries(thresholds).forEach(([componentName, threshold]) => {
      const isEnabled = this.#enabledComponents.includes(componentName);
      const shouldBeDisabled = activeCount >= threshold;

      if (shouldBeDisabled && isEnabled) {
        componentsToDisable.push(componentName);
      }
    });

    // Disable components that exceed thresholds
    let componentsChanged = false;
    if (componentsToDisable.length > 0) {
      componentsToDisable.forEach((componentName) => {
        this.disableComponent(componentName);
      });
      componentsChanged = true;
    }

    // Update store if components were changed
    if (componentsChanged) {
      const satStore = useSatStore();
      satStore.enabledComponents = this.#enabledComponents;
    }

    // Show loading spinner if there are satellites to process
    const hasWork = toShow.length > 0 || toHide.length > 0;
    if (hasWork) {
      this.loadingSpinner.show();
    } else {
      // No work to do - clear flag immediately
      this._isUpdatingSatellites = false;
      return;
    }

    // Batch process satellites with larger batches for faster loading
    const batchSize = 100;

    // Process satellites to show in batches
    const processBatch = (list, operation, index = 0) => {
      if (index >= list.length) {
        // Done with this operation
        if (operation === "show" && toHide.length > 0) {
          // Start hiding after showing is complete
          processBatch(toHide, "hide");
        } else if (operation === "hide" && this.visibleSatellites.length === 0) {
          CesiumCleanupHelper.cleanup(this.viewer);
        }

        // Hide loading spinner when all operations are complete
        if (operation === "hide" || (operation === "show" && toHide.length === 0)) {
          this.loadingSpinner.hide();
          // Clear flag when completely done
          this._isUpdatingSatellites = false;

          // Now that satellites are shown, calculate passes if ground station exists
          // This ensures passes are calculated after initial satellite loading
          if (this.#groundStations.length > 0) {
            this.updatePassHighlightsForEnabledSatellites();
          }
        }

        // Request render after batch completion
        if (this.viewer && this.viewer.scene) {
          this.viewer.scene.requestRender();
        }
        return;
      }

      const batch = list.slice(index, index + batchSize);
      batch.forEach((sat) => {
        if (operation === "show") {
          sat.show(this.#enabledComponents);
        } else {
          sat.hide();
        }
      });

      // Request render after this batch
      if (this.viewer && this.viewer.scene) {
        this.viewer.scene.requestRender();
      }

      // Schedule next batch immediately for faster loading
      setTimeout(() => processBatch(list, operation, index + batchSize), 0);
    };

    // Start processing
    if (toShow.length > 0) {
      processBatch(toShow, "show");
    } else if (toHide.length > 0) {
      processBatch(toHide, "hide");
    }
  }

  get enabledTags() {
    return Array.from(this.#enabledTags);
  }

  set enabledTags(newTags) {
    this.#enabledTags = new Set(newTags);
    this.showEnabledSatellites();

    // Invalidate pass cache since visible satellites changed
    this.invalidateGroundStationCaches();

    // Calculate and display pass highlights if ground station exists
    this.updatePassHighlightsForEnabledSatellites();

    const satStore = useSatStore();
    satStore.enabledTags = newTags;
  }

  get components() {
    const components = this.satellites.map((sat) => sat.components);
    return [...new Set([].concat(...components))];
  }

  get enabledComponents() {
    return this.#enabledComponents;
  }

  set enabledComponents(newComponents) {
    const oldComponents = this.#enabledComponents;
    const add = newComponents.filter((x) => !oldComponents.includes(x));
    const del = oldComponents.filter((x) => !newComponents.includes(x));
    add.forEach((component) => {
      this.enableComponent(component);
    });
    del.forEach((component) => {
      this.disableComponent(component);
    });
  }

  enableComponent(componentName) {
    if (!this.#enabledComponents.includes(componentName)) {
      this.#enabledComponents.push(componentName);
    }

    this.activeSatellites.forEach((sat) => {
      sat.enableComponent(componentName);
    });
  }

  disableComponent(componentName) {
    this.#enabledComponents = this.#enabledComponents.filter((name) => name !== componentName);

    // Disable component for ALL satellites (not just active), to ensure cleanup
    // This is especially important when disabling components due to high satellite counts
    this.satellites.forEach((sat) => {
      if (sat.created) {
        sat.disableComponent(componentName);
      }
    });
  }

  get groundStationAvailable() {
    return this.#groundStations.length > 0;
  }

  invalidateGroundStationCaches() {
    // Invalidate pass cache on all ground stations when satellite visibility changes
    this.#groundStations.forEach((gs) => {
      if (gs.invalidatePassCache) {
        gs.invalidatePassCache();
      }
    });

    // Always clear highlights when satellite visibility changes
    CesiumTimelineHelper.clearHighlightRanges(this.viewer);

    // Refresh highlights if a ground station is currently selected
    const selectedEntity = this.viewer.selectedEntity;
    if (selectedEntity && selectedEntity.name && selectedEntity.name.includes("Groundstation")) {
      // Trigger recalculation by temporarily clearing and restoring selection
      setTimeout(() => {
        const entity = selectedEntity;
        this.viewer.selectedEntity = undefined;
        setTimeout(() => {
          this.viewer.selectedEntity = entity;
        }, 10);
      }, 10);
    }
  }

  updatePassHighlightsForEnabledSatellites() {
    // Skip if satellite database is being updated
    if (this._isUpdatingSatellites) {
      return;
    }

    // Only calculate if ground station exists
    if (this.#groundStations.length === 0) {
      return;
    }

    const currentTime = this.viewer.clock.currentTime;
    // Use activeSatellites to get all satellites enabled by tags OR by name
    const activeSatellites = this.activeSatellites;

    // Skip if no satellites enabled
    if (activeSatellites.length === 0) {
      return;
    }

    // Cancel any in-progress pass calculation to prevent race conditions
    // When timeline jumps or satellites change, we need fresh calculations
    if (this.#passCalculationInProgress) {
      if (this.#currentPassCalculation) {
        this.#currentPassCalculation.cancelled = true;
      }
    }

    // Mark calculation as in progress and create cancellation token
    this.#passCalculationInProgress = true;
    const calculationId = { cancelled: false };
    this.#currentPassCalculation = calculationId;

    // Dispatch event: pass calculation started
    window.dispatchEvent(
      new CustomEvent("satvis:passCalculationStart", {
        detail: {
          satelliteCount: activeSatellites.length,
          groundStationCount: this.#groundStations.length,
        },
      }),
    );

    // Show loading spinner during pass calculation
    this.loadingSpinner.show("Calculating passes...");

    // Clear existing pass highlights before recalculating to avoid duplicates
    CesiumTimelineHelper.clearHighlightRanges(this.viewer);

    // Update passes for all active satellites asynchronously
    const passPromises = activeSatellites.map((satellite) => {
      if (satellite && satellite.props) {
        return satellite.props
          .updatePasses(currentTime)
          .then(() => {
            // Filter passes based on time and user preferences (sunlight/eclipse filters)
            const filteredPasses = filterAndSortPasses(satellite.props.passes, JulianDate.toDate(currentTime));
            if (filteredPasses && filteredPasses.length > 0) {
              CesiumTimelineHelper.addHighlightRanges(this.viewer, filteredPasses, satellite.props.name);
            }
          })
          .catch(() => {
            // Silently ignore pass calculation errors
          });
      }
      return Promise.resolve();
    });

    Promise.all(passPromises).then(() => {
      // Always mark calculation as complete and reset flags
      // This must happen regardless of cancellation to prevent deadlocks
      this.#passCalculationInProgress = false;
      this.#currentPassCalculation = null;

      // Hide loading spinner
      this.loadingSpinner.hide();

      // Check if this calculation was cancelled by a newer calculation
      if (calculationId.cancelled) {
        return;
      }

      // Dispatch event: pass calculation completed
      // This event is used by E2E tests to wait for calculation completion
      window.dispatchEvent(
        new CustomEvent("satvis:passCalculationComplete", {
          detail: {
            satelliteCount: activeSatellites.length,
          },
        }),
      );

      // Force an immediate timeline update after all passes are loaded
      if (this.viewer.timeline) {
        this.viewer.timeline.updateFromClock();
        if (this.viewer.timeline._makeTics) {
          this.viewer.timeline._makeTics();
        }
      }
    });
  }

  focusGroundStation() {
    if (!this.groundStationAvailable) {
      return;
    }

    // If in zenith view, exit to normal view first
    if (this.isInZenithView) {
      this.exitZenithView();
      return;
    }

    // Normal focus behavior
    this.#groundStations[0].track();
  }

  get isInZenithView() {
    return !!this.zenithViewCleanup;
  }

  /**
   * Apply appropriate camera controls based on current view mode
   * - In zenith view: disable zoom, translate, rotate; enable tilt and look
   * - In normal view: enable all controls
   * This is a centralized method to avoid code duplication
   */
  applyCameraControlsForCurrentMode() {
    const controller = this.viewer.scene.screenSpaceCameraController;

    if (this.isInZenithView) {
      // Zenith view: restricted controls
      controller.enableZoom = false;
      controller.enableTranslate = false;
      controller.enableRotate = false;
      controller.enableTilt = true;
      controller.enableLook = true;
    } else {
      // Normal view: all controls enabled
      controller.enableZoom = true;
      controller.enableTranslate = true;
      controller.enableRotate = true;
      controller.enableTilt = true;
      controller.enableLook = true;
    }
  }

  exitZenithView() {
    if (this.zenithViewCleanup) {
      this.zenithViewCleanup();
    }
    // Dispatch event for UI to update
    window.dispatchEvent(new CustomEvent("zenithViewChanged", { detail: { active: false } }));

    // Return to a reasonable view of Earth from distance
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(0, 20, 20000000), // 20,000 km away
      orientation: {
        heading: 0,
        pitch: -CesiumMath.PI_OVER_TWO, // Look down at Earth
        roll: 0,
      },
      duration: 1.5,
    });
  }

  zenithViewFromGroundStation() {
    if (!this.groundStationAvailable) {
      return;
    }

    const groundStation = this.#groundStations[0];
    const position = groundStation.position;

    // Convert lat/lon/height to Cartesian3 for ground station position
    const groundStationPosition = Cartesian3.fromDegrees(position.longitude, position.latitude, position.height);

    // Check if camera is already at ground station position
    const currentCameraPosition = this.viewer.camera.positionWC;
    const distanceToGroundStation = Cartesian3.distance(currentCameraPosition, groundStationPosition);

    // If camera is more than 1km from ground station, focus on it first
    if (distanceToGroundStation > 1000) {
      // Select ground station entity first (so it shows in zenith view)
      const groundStationEntity = groundStation.components.Groundstation;
      this.viewer.selectedEntity = groundStationEntity;

      // Track ground station to move camera
      this.viewer.trackedEntity = groundStationEntity;

      // Enter zenith view after a short delay for camera to start moving
      setTimeout(() => {
        this.enterZenithViewImmediate();
      }, 300); // Reduced delay - just enough for tracking to engage
      return;
    }

    // Camera is already at ground station, enter zenith view immediately
    this.enterZenithViewImmediate();
  }

  enterZenithViewImmediate() {
    if (!this.groundStationAvailable) {
      return;
    }

    const groundStation = this.#groundStations[0];
    const position = groundStation.position;

    // Convert lat/lon/height to Cartesian3 for camera position
    const cameraPosition = Cartesian3.fromDegrees(position.longitude, position.latitude, position.height);

    // Clear any tracked entity
    this.viewer.trackedEntity = undefined;

    // If camera is in Inertial mode, switch to Fixed mode for zenith view
    // Zenith view needs to stay aligned with the rotating Earth
    let previousCameraMode = null;
    if (window.cc && window.cc.cameraMode === "Inertial") {
      previousCameraMode = "Inertial";
      window.cc.cameraMode = "Fixed";
    }

    // Clean up any existing zenith view handler
    if (this.zenithViewCleanup) {
      this.zenithViewCleanup();
    }

    // Set camera to ground station position looking straight up (zenith)
    this.viewer.camera.setView({
      destination: cameraPosition,
      orientation: {
        heading: 0, // North
        pitch: CesiumMath.toRadians(90), // 90 degrees = straight up (zenith)
        roll: 0,
      },
    });

    // Lock camera position at ground station, only allow looking around
    const controller = this.viewer.scene.screenSpaceCameraController;
    const originalZoomEnabled = controller.enableZoom;
    const originalTranslateEnabled = controller.enableTranslate;
    const originalRotateEnabled = controller.enableRotate;

    // Store original event type mappings before modifying
    const originalLookEventTypes = controller.lookEventTypes;
    const originalTiltEventTypes = controller.tiltEventTypes;

    // Replace default double-click behavior with ground station selection
    const screenSpaceEventHandler = this.viewer.screenSpaceEventHandler;
    const originalLeftDoubleClick = screenSpaceEventHandler.getInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // Custom double-click handler for zenith view
    const zenithDoubleClickHandler = () => {
      // Select ground station entity when double-clicking
      const groundStationEntity = groundStation.components.Groundstation;
      if (groundStationEntity) {
        this.viewer.selectedEntity = groundStationEntity;
      }
    };

    screenSpaceEventHandler.setInputAction(zenithDoubleClickHandler, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    controller.enableZoom = false; // Disable default zoom (we use custom wheel handler)
    controller.enableTranslate = false; // Disable panning/moving position
    controller.enableRotate = false; // Disable orbiting which moves camera position
    controller.enableTilt = true; // Allow tilting camera up/down
    controller.enableLook = true; // Allow looking around from fixed position

    // Remap left mouse drag to look instead of rotate (which moves camera position)
    controller.lookEventTypes = [CameraEventType.LEFT_DRAG, CameraEventType.RIGHT_DRAG];
    controller.tiltEventTypes = [
      CameraEventType.MIDDLE_DRAG,
      {
        eventType: CameraEventType.LEFT_DRAG,
        modifier: KeyboardEventModifier.SHIFT,
      },
    ];

    // Store original FOV and apply zenith view FOV
    const originalFov = this.viewer.camera.frustum.fov;

    // FOV settings (in degrees)
    const minFov = 30; // Maximum zoom (narrowest field of view)
    const maxFov = 150; // Maximum wide view
    let currentFov = 90; // Start with 90 degree FOV (medium view)

    // Apply initial FOV
    this.viewer.camera.frustum.fov = CesiumMath.toRadians(currentFov);

    // Create FOV readout display
    const viewReadout = document.createElement("div");
    viewReadout.id = "zenithViewReadout";
    viewReadout.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 14px;
      z-index: 1000;
      pointer-events: none;
    `;
    viewReadout.textContent = `FOV: ${currentFov.toFixed(0)}°`;
    this.viewer.container.appendChild(viewReadout);

    // Create azimuth scale markers on the horizon
    const zenithEntities = [];
    const horizonRadius = 50000; // 50 km from ground station
    const tickLength = 5000; // 5 km tick marks

    // Cardinal directions mapping
    const cardinals = {
      0: "N",
      90: "E",
      180: "S",
      270: "W",
    };

    // Create markers every 30 degrees
    for (let azimuth = 0; azimuth < 360; azimuth += 30) {
      const azimuthRad = CesiumMath.toRadians(azimuth);

      // Calculate position at horizon for this azimuth
      const dx = Math.sin(azimuthRad) * horizonRadius;
      const dy = Math.cos(azimuthRad) * horizonRadius;

      // Convert to lat/lon offset (approximate for small distances)
      const latOffset = dy / 111000; // degrees latitude
      const lonOffset = dx / (111000 * Math.cos(CesiumMath.toRadians(position.latitude))); // degrees longitude

      const markerLat = position.latitude + latOffset;
      const markerLon = position.longitude + lonOffset;

      // Create tick mark (short line extending outward)
      const tickStart = Cartesian3.fromDegrees(markerLon, markerLat, position.height);
      const tickDx = Math.sin(azimuthRad) * tickLength;
      const tickDy = Math.cos(azimuthRad) * tickLength;
      const tickLatOffset = (dy + tickDy) / 111000;
      const tickLonOffset = (dx + tickDx) / (111000 * Math.cos(CesiumMath.toRadians(position.latitude)));
      const tickEnd = Cartesian3.fromDegrees(position.longitude + tickLonOffset, position.latitude + tickLatOffset, position.height);

      const tickEntity = this.viewer.entities.add({
        polyline: {
          positions: [tickStart, tickEnd],
          width: 2,
          material: Color.WHITE,
          clampToGround: false,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always render on top
        },
      });
      zenithEntities.push(tickEntity);

      // Create label with degree marking
      let labelText = `${azimuth}°`;
      if (cardinals[azimuth]) {
        labelText = `${cardinals[azimuth]} (${azimuth}°)`;
      }

      // Position label slightly beyond the tick mark
      const labelDistance = horizonRadius + tickLength + 3000;
      const labelDx = Math.sin(azimuthRad) * labelDistance;
      const labelDy = Math.cos(azimuthRad) * labelDistance;
      const labelLatOffset = labelDy / 111000;
      const labelLonOffset = labelDx / (111000 * Math.cos(CesiumMath.toRadians(position.latitude)));

      const labelEntity = this.viewer.entities.add({
        position: Cartesian3.fromDegrees(position.longitude + labelLonOffset, position.latitude + labelLatOffset, position.height),
        label: {
          text: labelText,
          font: "14px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, 0),
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, // Always render on top
        },
      });
      zenithEntities.push(labelEntity);
    }

    // Add custom mouse wheel handler for FOV zoom
    const canvas = this.viewer.scene.canvas;

    // ── Zenith view interaction: Alt/Az tooltip + sun symbol ──────────────────
    const R2D = 180 / Math.PI;
    const gsCartesian = Cartesian3.fromDegrees(position.longitude, position.latitude, position.height);
    const enuMatrix = Transforms.eastNorthUpToFixedFrame(gsCartesian);

    // Helper: screen position → Alt/Az
    const screenToAltAz = (mousePos) => {
      const ray = this.viewer.camera.getPickRay(mousePos, new Ray());
      if (!ray) return null;
      const invEnu = Matrix4.inverseTransformation(enuMatrix, new Matrix4());
      const d = Matrix4.multiplyByPointAsVector(invEnu, ray.direction, new Cartesian3());
      const alt = Math.atan2(d.z, Math.hypot(d.x, d.y)) * R2D;
      const az = (Math.atan2(d.x, d.y) * R2D + 360) % 360;
      return { alt, az };
    };

    // Helper: project sun's actual position to screen.
    // Uses manual perspective projection (camera vectors + trig) instead of
    // cartesianToCanvasCoordinates which is unreliable near the FOV boundary.
    // Returns screen {x, y} if the sun is on-screen, null if behind camera or off-screen.
    const sunDirToScreen = (sunAltDeg, sunAzDeg) => {
      const cam = this.viewer.camera;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // Sun direction in ENU at its actual altitude
      const altR = (sunAltDeg * Math.PI) / 180;
      const azR = (sunAzDeg * Math.PI) / 180;
      const sunENU = new Cartesian3(Math.cos(altR) * Math.sin(azR), Math.cos(altR) * Math.cos(azR), Math.sin(altR));

      // ENU → world (ECEF)
      const sunWorld = Matrix4.multiplyByPointAsVector(enuMatrix, sunENU, new Cartesian3());
      Cartesian3.normalize(sunWorld, sunWorld);

      // Project onto camera axes
      const dotFwd = Cartesian3.dot(sunWorld, cam.direction);
      if (dotFwd <= 0.01) return null; // behind camera or at extreme edge

      const dotRight = Cartesian3.dot(sunWorld, cam.right);
      const dotUp = Cartesian3.dot(sunWorld, cam.up);

      // Perspective projection
      const fov = cam.frustum.fov;
      const f = w >= h ? w / 2 / Math.tan(fov / 2) : h / 2 / Math.tan(fov / 2);

      const sx = w / 2 + (dotRight / dotFwd) * f;
      const sy = h / 2 - (dotUp / dotFwd) * f;

      // Only show if on screen
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) return null;
      return { x: sx, y: sy };
    };

    // Tooltip div
    const tooltip = document.createElement("div");
    tooltip.dataset.testid = "zenith-tooltip";
    tooltip.style.cssText = `
      position: absolute; pointer-events: none; display: none;
      background: rgba(0,0,0,0.75); color: #fff; padding: 5px 10px;
      border-radius: 4px; font-family: monospace; font-size: 13px;
      z-index: 1001; white-space: pre; line-height: 1.5;
    `;
    this.viewer.container.appendChild(tooltip);

    // Sun symbol div — needs z-index > canvas (z-index:0) to be visible.
    // Cesium UI chrome (toolbar, animation, timeline) is given z-index:1002 via injected CSS
    // during zenith view so it renders on top of the symbol.
    const sunSymbol = document.createElement("div");
    sunSymbol.dataset.testid = "zenith-sun-symbol";
    sunSymbol.textContent = "☀";
    sunSymbol.style.cssText = `
      position: absolute; font-size: 20px; display: none; cursor: default;
      z-index: 1001; transform: translate(-50%, -50%);
      filter: drop-shadow(0 0 3px rgba(255,180,0,0.9));
      pointer-events: auto;
    `;
    this.viewer.container.appendChild(sunSymbol);

    // Elevate Cesium UI chrome above the sun symbol while zenith view is active.
    const zenithUiCss = document.createElement("style");
    zenithUiCss.textContent = `
      .cesium-viewer-toolbar,
      .cesium-viewer-animationContainer,
      .cesium-viewer-timelineContainer,
      .cesium-viewer-fullscreenContainer,
      .cesium-viewer-vrContainer { z-index: 1002 !important; }
    `;
    document.head.appendChild(zenithUiCss);

    // Mouse move: hide tooltip immediately, show after 1.5 s of stillness
    let tooltipTimer = null;
    const mouseMoveHandler = (event) => {
      tooltip.style.display = "none";
      clearTimeout(tooltipTimer);
      const rect = canvas.getBoundingClientRect();
      const mousePos = new Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
      tooltipTimer = setTimeout(() => {
        const altAz = screenToAltAz(mousePos);
        if (!altAz) return;
        const picked = this.viewer.scene.pick(mousePos);
        const state = picked?.id?._smartPathState;
        tooltip.textContent = formatZenithTooltip(altAz.alt, altAz.az, state);
        tooltip.style.left = mousePos.x + 16 + "px";
        tooltip.style.top = mousePos.y - 8 + "px";
        tooltip.style.display = "block";
      }, 1500);
    };

    const mouseLeaveHandler = () => {
      clearTimeout(tooltipTimer);
      tooltip.style.display = "none";
    };

    canvas.addEventListener("mousemove", mouseMoveHandler);
    canvas.addEventListener("mouseleave", mouseLeaveHandler);

    // Sun symbol hover — show tooltip immediately (no delay for explicit hover)
    sunSymbol.addEventListener("mouseenter", (e) => {
      clearTimeout(tooltipTimer);
      const sunPos = cachedSunPos || GroundStationConditions.getSunPosition(position, JulianDate.toDate(this.viewer.clock.currentTime));
      tooltip.textContent = formatSunTooltip(sunPos.altitude, sunPos.azimuth);
      const rect = canvas.getBoundingClientRect();
      tooltip.style.left = e.clientX - rect.left + 16 + "px";
      tooltip.style.top = e.clientY - rect.top - 8 + "px";
      tooltip.style.display = "block";
    });
    sunSymbol.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      tooltip.style.left = e.clientX - rect.left + 16 + "px";
      tooltip.style.top = e.clientY - rect.top - 8 + "px";
    });
    sunSymbol.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    // Sun position cache — recalculate every 30s of simulated time
    let cachedSunPos = null;
    let cachedSunSimTime = 0;
    const SUN_CACHE_SIM_SEC = 30;

    // Sun symbol position update (runs on each clock tick)
    const updateSunSymbol = () => {
      const simTime = JulianDate.toDate(this.viewer.clock.currentTime).getTime() / 1000;
      if (!cachedSunPos || Math.abs(simTime - cachedSunSimTime) > SUN_CACHE_SIM_SEC) {
        const time = JulianDate.toDate(this.viewer.clock.currentTime);
        cachedSunPos = GroundStationConditions.getSunPosition(position, time);
        cachedSunSimTime = simTime;
      }
      const inTwilight = cachedSunPos.altitude < 0 && cachedSunPos.altitude > -18;
      if (!inTwilight) {
        sunSymbol.style.display = "none";
        return;
      }
      const screen = sunDirToScreen(cachedSunPos.altitude, cachedSunPos.azimuth);
      if (!screen) {
        sunSymbol.style.display = "none";
        return;
      }
      sunSymbol.style.left = screen.x + "px";
      sunSymbol.style.top = screen.y + "px";
      sunSymbol.style.display = "block";
    };
    const clockTickRemover = this.viewer.clock.onTick.addEventListener(updateSunSymbol);
    updateSunSymbol(); // Populate immediately on enter
    // ── end zenith interaction ────────────────────────────────────────────────

    const wheelHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();

      // Reversed: scroll down (deltaY > 0) = zoom in (decrease FOV)
      //           scroll up (deltaY < 0) = zoom out (increase FOV)
      const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05;
      currentFov = currentFov * zoomFactor;

      // Clamp FOV between min and max
      currentFov = Math.max(minFov, Math.min(maxFov, currentFov));

      // Update camera FOV
      this.viewer.camera.frustum.fov = CesiumMath.toRadians(currentFov);

      // Update readout
      viewReadout.textContent = `FOV: ${currentFov.toFixed(0)}°`;

      // Request render to update the view
      this.viewer.scene.requestRender();
    };

    canvas.addEventListener("wheel", wheelHandler, { passive: false, capture: true });

    // Add post-render event to keep horizon level (roll = 0)
    const postRenderListener = this.viewer.scene.postRender.addEventListener(() => {
      // Force camera roll to 0 to keep horizon level.
      // Skip when near zenith (pitch ≈ 90°): at that angle camera.heading is ambiguous
      // due to gimbal lock, and calling setView(heading=...) corrupts camera.right,
      // breaking the sun symbol edge-clamping fallback.
      const nearZenith = Math.abs(this.viewer.camera.pitch - CesiumMath.PI_OVER_TWO) < 0.2;
      if (this.viewer.camera.roll !== 0 && !nearZenith) {
        const heading = this.viewer.camera.heading;
        const pitch = this.viewer.camera.pitch;
        this.viewer.camera.setView({
          orientation: {
            heading: heading,
            pitch: pitch,
            roll: 0,
          },
        });
      }
    });

    // Dispatch event for UI to update
    window.dispatchEvent(new CustomEvent("zenithViewChanged", { detail: { active: true } }));

    // Request immediate render to kickstart terrain loading
    this.viewer.scene.requestRender();

    // Cleanup function
    this.zenithViewCleanup = () => {
      canvas.removeEventListener("wheel", wheelHandler, { capture: true });
      postRenderListener(); // Remove post-render listener
      controller.enableZoom = originalZoomEnabled;
      controller.enableTranslate = originalTranslateEnabled;
      controller.enableRotate = originalRotateEnabled;
      controller.lookEventTypes = originalLookEventTypes;
      controller.tiltEventTypes = originalTiltEventTypes;
      // Restore double-click behavior
      if (originalLeftDoubleClick) {
        screenSpaceEventHandler.setInputAction(originalLeftDoubleClick, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      }
      // Restore original FOV
      this.viewer.camera.frustum.fov = originalFov;
      // Remove view readout
      if (viewReadout && viewReadout.parentNode) {
        viewReadout.parentNode.removeChild(viewReadout);
      }
      // Remove all azimuth entities
      zenithEntities.forEach((entity) => {
        this.viewer.entities.remove(entity);
      });
      // Remove zenith interaction elements and listeners
      canvas.removeEventListener("mousemove", mouseMoveHandler);
      canvas.removeEventListener("mouseleave", mouseLeaveHandler);
      clearTimeout(tooltipTimer);
      clockTickRemover();
      if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      if (sunSymbol.parentNode) sunSymbol.parentNode.removeChild(sunSymbol);
      if (zenithUiCss.parentNode) zenithUiCss.parentNode.removeChild(zenithUiCss);
      // Restore previous camera mode if it was changed
      if (previousCameraMode && window.cc) {
        window.cc.cameraMode = previousCameraMode;
      }
      this.zenithViewCleanup = null;
    };

    // Also cleanup when tracked entity changes
    const trackedEntityListener = this.viewer.trackedEntityChanged.addEventListener(() => {
      if (this.zenithViewCleanup) {
        this.zenithViewCleanup();
      }
      trackedEntityListener();
    });
  }

  createGroundstation(position, name) {
    const groundStation = new GroundStationEntity(this.viewer, this, position, name);
    groundStation.show();
    return groundStation;
  }

  addGroundStation(position, name) {
    // Ensure minimum height of 2 meters above ellipsoid for proper camera rendering in zenith view
    // Camera at 0 meters can cause terrain/globe rendering issues
    if (position.height < 2) {
      position.height = 2;
    }

    // Remove existing ground station if one exists (only support one station at a time)
    if (this.#groundStations.length > 0) {
      const existingStation = this.#groundStations[0];

      // Use hide() method to properly remove components
      existingStation.hide();

      // Remove all entities associated with the ground station from viewer
      Object.values(existingStation.components).forEach((component) => {
        if (component instanceof Entity && this.viewer.entities.contains(component)) {
          this.viewer.entities.remove(component);
        }
      });
    }

    // Additional safety cleanup: remove any remaining ground station entities
    const entitiesToRemove = [];
    this.viewer.entities.values.forEach((entity) => {
      if (entity.name && entity.name.includes("Groundstation")) {
        entitiesToRemove.push(entity);
      }
    });
    entitiesToRemove.forEach((entity) => {
      this.viewer.entities.remove(entity);
    });

    const groundStation = this.createGroundstation(position, name);
    this.groundStations = [groundStation]; // Replace with single station
  }

  get groundStations() {
    return this.#groundStations;
  }

  set groundStations(newGroundStations) {
    // Clean up old ground stations by removing their entities from the viewer
    // This prevents stale entity references from accumulating
    this.#groundStations.forEach((gs) => {
      // Invalidate pass cache
      if (gs.invalidatePassCache) {
        gs.invalidatePassCache();
      }
      // Remove entities from Cesium viewer
      if (gs.hide) {
        gs.hide();
      }
    });

    this.#groundStations = newGroundStations;

    // Set groundstation for all satellites
    this.satellites.forEach((sat) => {
      sat.groundStations = this.#groundStations;
    });

    // Update daytime ranges for first ground station
    CesiumTimelineHelper.clearGroundStationDaytimeRanges(this.viewer);
    if (this.#groundStations.length > 0) {
      CesiumTimelineHelper.addGroundStationDaytimeRanges(this.viewer, this.#groundStations[0]);
    }

    // Calculate and display pass highlights for enabled satellites
    // (clearHighlightRanges is called inside updatePassHighlightsForEnabledSatellites)
    this.updatePassHighlightsForEnabledSatellites();

    // Update store for url state
    const satStore = useSatStore();
    // TODO Store all groundsations in url param with name
    satStore.groundStations = this.#groundStations.map((gs) => ({
      lat: gs.position.latitude,
      lon: gs.position.longitude,
      name: gs.hasName ? gs.name : undefined,
    }));
  }

  get overpassMode() {
    return this.#overpassMode;
  }

  set overpassMode(newMode) {
    this.#overpassMode = newMode;
    // Update overpass mode for all satellites
    this.satellites.forEach((sat) => {
      sat.props.overpassMode = newMode;
    });
    // Clear passes immediately to show old data is stale
    this.satellites.forEach((sat) => {
      if (sat.props.groundStationAvailable) {
        sat.props.clearPasses();
      }
    });

    // Invalidate ground station caches
    this.invalidateGroundStationCaches();

    // Recalculate passes asynchronously in batches to avoid blocking UI
    this.recalculatePassesAsync();
  }

  async recalculatePassesAsync() {
    // Only recalculate for active satellites (enabled by tag or name) that have a ground station
    const satellitesWithGS = this.activeSatellites.filter((sat) => sat.props.groundStationAvailable);
    if (satellitesWithGS.length === 0) return;

    // Clear existing highlights before recalculating
    CesiumTimelineHelper.clearHighlightRanges(this.viewer);

    // Process satellites in batches - WebWorkers handle parallelization
    const batchSize = 20;
    for (let i = 0; i < satellitesWithGS.length; i += batchSize) {
      const batch = satellitesWithGS.slice(i, i + batchSize);

      // Process this batch asynchronously
      const batchPromises = batch.map((sat) =>
        sat.props.updatePasses(this.viewer.clock.currentTime).catch((err) => {
          console.warn(`Failed to update passes for ${sat.props.name}:`, err);
        }),
      );
      await Promise.all(batchPromises);

      // Yield to browser after each batch to keep UI responsive
      if (i + batchSize < satellitesWithGS.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    // Add timeline highlights for all active satellites that have passes
    // Apply filters for sunlight/eclipse based on user preferences
    const activeSatellites = this.activeSatellites.filter((sat) => sat.props.groundStationAvailable);
    const currentTime = JulianDate.toDate(this.viewer.clock.currentTime);
    activeSatellites.forEach((satellite) => {
      if (satellite.props.passes && satellite.props.passes.length > 0) {
        const filteredPasses = filterAndSortPasses(satellite.props.passes, currentTime);
        if (filteredPasses.length > 0) {
          CesiumTimelineHelper.addHighlightRanges(this.viewer, filteredPasses, satellite.props.name);
        }
      }
    });

    // Force immediate timeline update
    if (this.viewer.timeline) {
      this.viewer.timeline.updateFromClock();
      if (this.viewer.timeline._makeTics) {
        this.viewer.timeline._makeTics();
      }
    }

    // Refresh the currently selected entity's info box if it's a satellite or ground station
    const selectedEntity = this.viewer.selectedEntity;
    if (selectedEntity) {
      // Trigger refresh by temporarily clearing and restoring selection
      const entity = selectedEntity;
      this.viewer.selectedEntity = undefined;
      setTimeout(() => {
        this.viewer.selectedEntity = entity;
      }, 10);
    }
  }
}
