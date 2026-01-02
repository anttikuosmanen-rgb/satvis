import { BillboardGraphics, HorizontalOrigin, JulianDate, NearFarScalar, VerticalOrigin } from "@cesium/engine";
import icon from "../images/icons/dish.svg";
import { useSatStore } from "../stores/sat";
import { CesiumComponentCollection } from "./util/CesiumComponentCollection";
import { DescriptionHelper } from "./util/DescriptionHelper";
import { filterAndSortPasses } from "./util/PassFilter";
import { GroundStationConditions } from "./util/GroundStationConditions";

const deg2rad = Math.PI / 180;

export class GroundStationEntity extends CesiumComponentCollection {
  constructor(viewer, sats, position, givenName = "") {
    super(viewer);
    this.sats = sats;
    this.position = position;
    this.givenName = givenName;

    // Cache for pass calculations to avoid recalculating on every click
    this._passesCache = null;
    this._passesCacheTime = null; // JavaScript timestamp when cache was created
    this._passesCacheCesiumTime = null; // Cesium time when cache was created
    this._cachedFilterState = null;
    this._cacheIsValid = false; // Quick validity check flag

    // State for bright passes search feature
    this._brightPassesState = {
      isSearching: false,
      progress: { current: 0, total: 0, currentSatName: "" },
      brightnessCalculated: false, // Whether brightness has been calculated for passes
      filters: { minMagnitude: 4.0, includeAll: false, showOnlyBright: false },
      darknessWindow: null,
      abortRequested: false,
    };

    // Cache for brightness data - persists across pass recalculations
    // Key: `${satelliteName}_${passStartTime}`, Value: { peakMagnitude, peakBrightnessTime, isInShadow }
    this._brightnessCache = new Map();

    this.createEntities();
  }

  createEntities() {
    this.createDescription();
    this.createGroundStation();
  }

  invalidatePassCache() {
    this._passesCache = null;
    this._passesCacheTime = null;
    this._passesCacheCesiumTime = null;
    this._cacheIsValid = false;

    // Force description refresh by recreating it
    // This ensures the passes list in the info panel updates
    this.refreshDescription();
  }

  refreshDescription() {
    // Recreate the description to force it to recalculate with new passes
    if (this.components && this.components.Groundstation) {
      this.createDescription();
      this.components.Groundstation.description = this.description;
    }
  }

  createGroundStation() {
    const billboard = new BillboardGraphics({
      image: icon,
      horizontalOrigin: HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.BOTTOM,
      scaleByDistance: new NearFarScalar(1e2, 0.2, 4e7, 0.1),
    });
    this.createCesiumEntity("Groundstation", "billboard", billboard, this.name, this.description, this.position.cartesian, false);
  }

  createDescription() {
    this.description = DescriptionHelper.cachedCallbackProperty((time) => {
      const passes = this.passes(time);
      const content = DescriptionHelper.renderGroundstationDescription(
        time,
        this.name,
        this.position,
        passes,
        this.sats.overpassMode,
        this._brightPassesState,
        this._brightnessCache,
      );
      return content;
    });
  }

  get hasName() {
    return this.givenName !== "";
  }

  get name() {
    if (this.givenName) {
      return this.givenName;
    }
    return `Groundstation [${this.position.latitude.toFixed(2)}°, ${this.position.longitude.toFixed(2)}°]`;
  }

  passes(time, deltaHours = 48) {
    // Check if filter state has changed
    const satStore = useSatStore();
    const currentFilterState = {
      hideSunlightPasses: satStore.hideSunlightPasses,
      showOnlyLitPasses: satStore.showOnlyLitPasses,
    };

    const filterStateChanged =
      this._cachedFilterState === null ||
      this._cachedFilterState.hideSunlightPasses !== currentFilterState.hideSunlightPasses ||
      this._cachedFilterState.showOnlyLitPasses !== currentFilterState.showOnlyLitPasses;

    if (filterStateChanged) {
      this.invalidatePassCache();
      this._cachedFilterState = currentFilterState;
    }

    // Quick validity check using cached boolean flag
    if (this._cacheIsValid && this._passesCache) {
      return filterAndSortPasses(this._passesCache, time, deltaHours);
    }

    // Only do expensive validation if quick check failed
    if (this._passesCache && this._passesCacheTime && this._passesCacheCesiumTime) {
      const currentTimeMs = JulianDate.toDate(time).getTime();
      // Adjust cache validity based on clock multiplier to prevent excessive invalidation
      const clockMultiplier = Math.abs(this.viewer.clock.multiplier || 1.0);
      const clampedMultiplier = Math.max(0.1, Math.min(2000, clockMultiplier));

      // At 1x speed: cache valid for 60s of simulation time
      // At 1000x speed: cache valid for 60,000s of simulation time (keeps cache valid for ~60s real time)
      const baseCacheValidityMs = 60 * 1000;
      const cacheValidityMs = baseCacheValidityMs * clampedMultiplier;

      // Scale the hours threshold too - at high speeds, normal progression shouldn't invalidate
      // At 1x: 1 hour jump invalidates; at 1000x: 1000 hour jump invalidates
      const cacheValidityHours = Math.max(1, clampedMultiplier);

      const simTimeDiffMs = currentTimeMs - this._passesCacheTime;
      const cesiumTimeDiff = Math.abs(JulianDate.secondsDifference(time, this._passesCacheCesiumTime)) / 3600; // Hours

      // Cache is valid if simulation time hasn't advanced too much
      if (simTimeDiffMs < cacheValidityMs && cesiumTimeDiff < cacheValidityHours) {
        this._cacheIsValid = true; // Mark as valid for next quick check
        return filterAndSortPasses(this._passesCache, time, deltaHours);
      }
    }

    // Calculate new passes synchronously (using fallback sync methods)
    // For sync context, we can't await, so passes may not include worker-calculated data
    // This is used in CallbackProperties where async is not supported
    // The passesAsync method should be preferred when possible
    let passes = [];
    let needsAsyncUpdate = false;

    this.sats.activeSatellites.forEach((sat) => {
      // Note: updatePasses is now async, but we're in a sync context
      // The passes array will be updated asynchronously, so we use cached data
      // if available, otherwise return empty for this satellite
      if (sat.props.passes && sat.props.passes.length > 0) {
        passes.push(...sat.props.passes);
      } else {
        needsAsyncUpdate = true;
      }
    });

    // If we need async updates, trigger them and request a refresh when done
    if (needsAsyncUpdate) {
      const asyncPromises = this.sats.activeSatellites.map((sat) =>
        sat.props.updatePasses(this.viewer.clock.currentTime).catch((err) => {
          console.warn("Pass calculation failed:", err);
        }),
      );

      // When all async calculations complete, invalidate cache to force UI refresh
      Promise.all(asyncPromises).then(() => {
        this.invalidatePassCache();
        // Request a scene render to update the UI
        if (this.viewer && this.viewer.scene) {
          this.viewer.scene.requestRender();
        }
      });
    }

    // Filter passes based on groundstation (do this before caching)
    passes = passes.filter((pass) => pass.groundStationName === this.name);

    // Cache the raw passes with both real time and Cesium time
    this._passesCache = passes;
    this._passesCacheTime = JulianDate.toDate(time).getTime();
    this._passesCacheCesiumTime = JulianDate.clone(time);
    this._cacheIsValid = true; // Mark as valid

    // Filter and return
    return filterAndSortPasses(passes, time, deltaHours);
  }

  async passesAsync(time, deltaHours = 48) {
    // Check if filter state has changed
    const satStore = useSatStore();
    const currentFilterState = {
      hideSunlightPasses: satStore.hideSunlightPasses,
      showOnlyLitPasses: satStore.showOnlyLitPasses,
    };

    const filterStateChanged =
      this._cachedFilterState === null ||
      this._cachedFilterState.hideSunlightPasses !== currentFilterState.hideSunlightPasses ||
      this._cachedFilterState.showOnlyLitPasses !== currentFilterState.showOnlyLitPasses;

    if (filterStateChanged) {
      this.invalidatePassCache();
      this._cachedFilterState = currentFilterState;
    }

    // Quick validity check using cached boolean flag
    if (this._cacheIsValid && this._passesCache) {
      return filterAndSortPasses(this._passesCache, time, deltaHours);
    }

    // Only do expensive validation if quick check failed
    if (this._passesCache && this._passesCacheTime && this._passesCacheCesiumTime) {
      const currentTimeMs = JulianDate.toDate(time).getTime();
      // Adjust cache validity based on clock multiplier to prevent excessive invalidation
      const clockMultiplier = Math.abs(this.viewer.clock.multiplier || 1.0);
      const clampedMultiplier = Math.max(0.1, Math.min(2000, clockMultiplier));

      // At 1x speed: cache valid for 60s of simulation time
      // At 1000x speed: cache valid for 60,000s of simulation time (keeps cache valid for ~60s real time)
      const baseCacheValidityMs = 60 * 1000;
      const cacheValidityMs = baseCacheValidityMs * clampedMultiplier;

      // Scale the hours threshold too - at high speeds, normal progression shouldn't invalidate
      // At 1x: 1 hour jump invalidates; at 1000x: 1000 hour jump invalidates
      const cacheValidityHours = Math.max(1, clampedMultiplier);

      const simTimeDiffMs = currentTimeMs - this._passesCacheTime;
      const cesiumTimeDiff = Math.abs(JulianDate.secondsDifference(time, this._passesCacheCesiumTime)) / 3600; // Hours

      // Cache is valid if simulation time hasn't advanced too much
      if (simTimeDiffMs < cacheValidityMs && cesiumTimeDiff < cacheValidityHours) {
        this._cacheIsValid = true; // Mark as valid for next quick check
        return filterAndSortPasses(this._passesCache, time, deltaHours);
      }
    }

    // Calculate new passes in parallel using async updatePasses
    let passes = [];
    const activeSatellites = this.sats.activeSatellites;

    // Process all satellites in parallel (WebWorkers will handle distribution)
    const passPromises = activeSatellites.map(async (sat) => {
      await sat.props.updatePasses(this.viewer.clock.currentTime);
      return sat.props.passes;
    });

    // Wait for all pass calculations to complete
    const passArrays = await Promise.all(passPromises);
    passes = passArrays.flat();

    // Filter passes based on groundstation (do this before caching)
    passes = passes.filter((pass) => pass.groundStationName === this.name);

    // Cache the raw passes with both real time and Cesium time
    this._passesCache = passes;
    this._passesCacheTime = JulianDate.toDate(time).getTime();
    this._passesCacheCesiumTime = JulianDate.clone(time);
    this._cacheIsValid = true; // Mark as valid

    // Filter and return
    return filterAndSortPasses(passes, time, deltaHours);
  }

  /**
   * Calculate brightness for passes during the next darkness window using web workers.
   * Updates existing passes with peakMagnitude, peakBrightnessTime, and isInShadow.
   * Enables satellites with bright passes if includeAll mode is used.
   */
  async calculateBrightness() {
    const state = this._brightPassesState;
    state.isSearching = true;
    state.abortRequested = false;
    state.brightnessCalculated = false;
    this.refreshDescription();

    // Get darkness window
    state.darknessWindow = GroundStationConditions.getNextDarknessWindow(this.position, new Date());

    if (!state.darknessWindow) {
      // Polar day - no darkness window
      state.isSearching = false;
      this.refreshDescription();
      return;
    }

    // Get satellites to check
    const satellites = state.filters.includeAll ? this.sats.satellites : this.sats.activeSatellites;
    const validSatellites = satellites.filter((sat) => !sat.props.isStale);

    state.progress.total = validSatellites.length;
    state.progress.current = 0;

    // Position for pass calculation (degrees, meters)
    const groundStationPosition = {
      latitude: this.position.latitude,
      longitude: this.position.longitude,
      height: this.position.height || 0,
    };

    // Position for brightness calculations (radians, km)
    const observerGeodetic = {
      latitude: this.position.latitude * deg2rad,
      longitude: this.position.longitude * deg2rad,
      height: (this.position.height || 0) / 1000,
    };

    let completed = 0;
    const brightSatellites = new Set(); // Track satellites with bright passes

    // Process each satellite - use workers to calculate passes, then brightness on main thread
    const passPromises = validSatellites.map(async (sat) => {
      if (state.abortRequested) return null;

      try {
        // Calculate passes using web workers
        const passes = await sat.props.orbit.computePassesElevation(
          groundStationPosition,
          state.darknessWindow.start,
          state.darknessWindow.end,
          5, // min elevation
          20, // max passes
        );

        // Update progress
        completed++;
        state.progress.current = completed;
        state.progress.currentSatName = sat.props.name;

        // Update UI periodically
        if (completed % 10 === 0 || completed === validSatellites.length) {
          this.refreshDescription();
        }

        let hasBrightPasses = false;

        // Calculate brightness for each pass (main thread - needs astronomy-engine)
        for (const pass of passes) {
          if (state.abortRequested) break;

          try {
            const brightness = sat.props.orbit.estimatePeakBrightness(pass, observerGeodetic);
            if (brightness) {
              // Store in brightness cache using satellite name + pass start time as key
              // Ensure pass.start is converted to a timestamp for consistent key format
              const passStartMs = typeof pass.start === "number" ? pass.start : new Date(pass.start).getTime();
              const cacheKey = `${sat.props.name}_${passStartMs}`;
              this._brightnessCache.set(cacheKey, {
                peakMagnitude: brightness.magnitude,
                peakBrightnessTime: brightness.time,
                isInShadow: brightness.isInShadow,
              });

              // Check if this is a bright pass (meets magnitude filter)
              if (!brightness.isInShadow && brightness.magnitude <= state.filters.minMagnitude) {
                hasBrightPasses = true;
              }
            }
          } catch {
            // Brightness estimation failed
          }
        }

        return { sat, hasBrightPasses };
      } catch (error) {
        console.warn(`Pass calc failed for ${sat.props.name}:`, error);
        return null;
      }
    });

    // Wait for all calculations
    const results = await Promise.allSettled(passPromises);

    // Track satellites with bright passes
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;

      const { sat, hasBrightPasses } = result.value;

      if (hasBrightPasses) {
        brightSatellites.add(sat.props.name);
      }
    }

    // Enable satellites with bright passes if includeAll mode
    if (state.filters.includeAll && brightSatellites.size > 0) {
      const enabledSet = new Set(this.sats.enabledSatellites);
      const toEnable = [...brightSatellites].filter((name) => !enabledSet.has(name));

      if (toEnable.length > 0) {
        console.log(`[Brightness] Enabling ${toEnable.length} satellites with bright passes:`, toEnable);
        this.sats.enabledSatellites = [...this.sats.enabledSatellites, ...toEnable];
      }
    }

    console.log(`[Brightness] Calculation complete. Cache size: ${this._brightnessCache.size}`);

    state.isSearching = false;
    state.brightnessCalculated = true;
    this.invalidatePassCache(); // Force refresh to show brightness in cards
    this.refreshDescription();

    if (this.viewer?.scene) {
      this.viewer.scene.requestRender();
    }
  }

  /**
   * Cancel an ongoing brightness calculation.
   */
  cancelBrightnessCalculation() {
    this._brightPassesState.abortRequested = true;
    this._brightPassesState.isSearching = false;
    this.refreshDescription();
  }
}
