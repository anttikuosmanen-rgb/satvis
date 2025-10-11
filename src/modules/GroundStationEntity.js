import { BillboardGraphics, HorizontalOrigin, NearFarScalar, VerticalOrigin } from "@cesium/engine";
import dayjs from "dayjs";
import icon from "../images/icons/dish.svg";
import { CesiumComponentCollection } from "./util/CesiumComponentCollection";
import { DescriptionHelper } from "./util/DescriptionHelper";
import { useSatStore } from "../stores/sat";

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

    const filterStateChanged = this._cachedFilterState === null ||
      this._cachedFilterState.hideSunlightPasses !== currentFilterState.hideSunlightPasses ||
      this._cachedFilterState.showOnlyLitPasses !== currentFilterState.showOnlyLitPasses;

    if (filterStateChanged) {
      this.invalidatePassCache();
      this._cachedFilterState = currentFilterState;
    }

    // Check if we can use cached results
    const currentTimeMs = Cesium.JulianDate.toDate(time).getTime();
    const cacheValidityMs = 60 * 1000; // Cache valid for 60 seconds

    if (this._passesCache && this._passesCacheTime) {
      const cacheAge = currentTimeMs - this._passesCacheTime;
      if (cacheAge < cacheValidityMs) {
        // Return cached passes, filtered by current time window
        return this._filterAndSortPasses(this._passesCache, time, deltaHours);
      }
    }

    // Calculate new passes
    let passes = [];
    // Aggregate passes from all visible satellites
    this.sats.visibleSatellites.forEach((sat) => {
      sat.props.updatePasses(this.viewer.clock.currentTime);
      passes.push(...sat.props.passes);
    });

    // Filter passes based on groundstation (do this before caching)
    passes = passes.filter((pass) => pass.groundStationName === this.name);

    // Cache the raw passes
    this._passesCache = passes;
    this._passesCacheTime = currentTimeMs;

    // Filter and return
    return this._filterAndSortPasses(passes, time, deltaHours);
  }

  async passesAsync(time, deltaHours = 48) {
    // Check if filter state has changed
    const satStore = useSatStore();
    const currentFilterState = {
      hideSunlightPasses: satStore.hideSunlightPasses,
      showOnlyLitPasses: satStore.showOnlyLitPasses,
    };

    const filterStateChanged = this._cachedFilterState === null ||
      this._cachedFilterState.hideSunlightPasses !== currentFilterState.hideSunlightPasses ||
      this._cachedFilterState.showOnlyLitPasses !== currentFilterState.showOnlyLitPasses;

    if (filterStateChanged) {
      this.invalidatePassCache();
      this._cachedFilterState = currentFilterState;
    }

    // Check if we can use cached results
    const currentTimeMs = Cesium.JulianDate.toDate(time).getTime();
    const cacheValidityMs = 60 * 1000; // Cache valid for 60 seconds

    if (this._passesCache && this._passesCacheTime) {
      const cacheAge = currentTimeMs - this._passesCacheTime;
      if (cacheAge < cacheValidityMs) {
        // Return cached passes, filtered by current time window
        return this._filterAndSortPasses(this._passesCache, time, deltaHours);
      }
    }

    // Calculate new passes in chunks to avoid blocking UI
    let passes = [];
    const visibleSatellites = this.sats.visibleSatellites;

    // Process satellites in chunks of 5 to avoid blocking
    const chunkSize = 5;
    for (let i = 0; i < visibleSatellites.length; i += chunkSize) {
      const chunk = visibleSatellites.slice(i, i + chunkSize);

      // Process this chunk
      chunk.forEach((sat) => {
        sat.props.updatePasses(this.viewer.clock.currentTime);
        passes.push(...sat.props.passes);
      });

      // Yield to browser after each chunk
      if (i + chunkSize < visibleSatellites.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Filter passes based on groundstation (do this before caching)
    passes = passes.filter((pass) => pass.groundStationName === this.name);

    // Cache the raw passes
    this._passesCache = passes;
    this._passesCacheTime = currentTimeMs;

    // Filter and return
    return this._filterAndSortPasses(passes, time, deltaHours);
  }

  _filterAndSortPasses(passes, time, deltaHours) {
    // Filter passes based on time
    let filtered = passes.filter((pass) => dayjs(pass.start).diff(time, "hours") < deltaHours);

    // Filter out passes in sunlight if option is enabled
    const satStore = useSatStore();
    if (satStore.hideSunlightPasses) {
      filtered = filtered.filter((pass) =>
        // Show pass if either start or end in darkness
        pass.groundStationDarkAtStart || pass.groundStationDarkAtEnd);
    }

    // Sort passes by time
    filtered = filtered.sort((a, b) => a.start - b.start);
    return filtered;
  }
}
