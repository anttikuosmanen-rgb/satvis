import { BillboardGraphics, HorizontalOrigin, JulianDate, NearFarScalar, VerticalOrigin } from "@cesium/engine";
import icon from "../images/icons/dish.svg";
import { useSatStore } from "../stores/sat";
import { CesiumComponentCollection } from "./util/CesiumComponentCollection";
import { DescriptionHelper } from "./util/DescriptionHelper";
import { filterAndSortPasses } from "./util/PassFilter";

export class GroundStationEntity extends CesiumComponentCollection {
  constructor(viewer, sats, position, givenName = "") {
    super(viewer);
    this.sats = sats;
    this.position = position;
    this.givenName = givenName;

    // Cache for pass calculations to avoid recalculating on every click
    this._passesCache = null;
    this._passesCacheTime = null;
    this._cachedFilterState = null;

    this.createEntities();
  }

  createEntities() {
    this.createDescription();
    this.createGroundStation();
  }

  invalidatePassCache() {
    this._passesCache = null;
    this._passesCacheTime = null;

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
      const content = DescriptionHelper.renderGroundstationDescription(time, this.name, this.position, passes, this.sats.overpassMode);
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

    // Check if we can use cached results
    const currentTimeMs = JulianDate.toDate(time).getTime();
    const cacheValidityMs = 60 * 1000; // Cache valid for 60 seconds

    if (this._passesCache && this._passesCacheTime) {
      const cacheAge = currentTimeMs - this._passesCacheTime;
      if (cacheAge < cacheValidityMs) {
        // Return cached passes, filtered by current time window
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
        })
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

    // Cache the raw passes
    this._passesCache = passes;
    this._passesCacheTime = currentTimeMs;

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

    // Check if we can use cached results
    const currentTimeMs = JulianDate.toDate(time).getTime();
    const cacheValidityMs = 60 * 1000; // Cache valid for 60 seconds

    if (this._passesCache && this._passesCacheTime) {
      const cacheAge = currentTimeMs - this._passesCacheTime;
      if (cacheAge < cacheValidityMs) {
        // Return cached passes, filtered by current time window
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

    // Cache the raw passes
    this._passesCache = passes;
    this._passesCacheTime = currentTimeMs;

    // Filter and return
    return filterAndSortPasses(passes, time, deltaHours);
  }
}
