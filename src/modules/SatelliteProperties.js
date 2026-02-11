import {
  Cartesian3,
  Ellipsoid,
  ExtrapolationType,
  JulianDate,
  LagrangePolynomialApproximation,
  Matrix3,
  ReferenceFrame,
  SampledPositionProperty,
  TimeInterval,
  TimeIntervalCollection,
  Transforms,
  defined,
} from "@cesium/engine";

import Orbit from "./Orbit";
import "./util/CesiumSampledPositionRawValueAccess";

import { CesiumCallbackHelper } from "./util/CesiumCallbackHelper";

export class SatelliteProperties {
  /**
   * Extract canonical name from a satellite name (strip all prefixes/suffixes)
   * Used for lookups and comparisons
   * @param {string} name - Raw satellite name (may include [Snapshot], [Custom], or * suffix)
   * @returns {string} Canonical name without decorations
   */
  static extractCanonicalName(name) {
    return name
      .trim()
      .replace(/^\[Snapshot\]\s*/i, "")
      .replace(/^\[Custom\]\s*/i, "")
      .replace(/\s*\*\s*$/, "")
      .trim();
  }

  /**
   * Extract display prefix from a satellite name
   * @param {string} name - Raw satellite name
   * @returns {string} The prefix (e.g., "[Snapshot] ", "[Custom] ") or empty string
   */
  static extractPrefix(name) {
    const match = name.match(/^(\[(?:Snapshot|Custom)\]\s*)/i);
    return match ? match[1] : "";
  }

  constructor(tle, tags = []) {
    // Parse raw name from TLE (first line)
    let rawName = tle.split("\n")[0].trim();
    if (tle.startsWith("0 ")) {
      rawName = rawName.substring(2);
    }

    // Extract canonical name (strip all prefixes/suffixes) - used for lookups
    this.canonicalName = SatelliteProperties.extractCanonicalName(rawName);

    // Store display decorations separately
    this.displayPrefix = SatelliteProperties.extractPrefix(rawName);
    this.displaySuffix = ""; // Will be set to " *" if epoch is in future

    // Set initial name (will be updated with suffix if prelaunch)
    this.name = rawName;

    this.orbit = new Orbit(this.canonicalName, tle);
    this.satnum = this.orbit.satnum;
    this.tags = tags;
    this.overpassMode = "elevation";

    // TLE signature for duplicate detection (lines 1+2, the actual orbital elements)
    this.tleSignature = this.computeTleSignature(tle);

    // Check if epoch is in the future and add asterisk to name if so
    if (this.isEpochInFuture()) {
      this.displaySuffix = " *";
      this.name = `${this.name} *`;
    }

    // Check for stale TLE (high-drag satellites with old epochs)
    this.stalenessInfo = this.orbit.checkTLEStaleness();
    this.isStale = this.stalenessInfo.isStale;
    if (this.isStale) {
      console.warn(`Stale TLE for ${this.name}: ${this.stalenessInfo.reason}`);
    }

    this.groundStations = [];
    this.passes = [];
    this.passInterval = undefined;
    this.passIntervals = new TimeIntervalCollection();
  }

  hasTag(tag) {
    return this.tags.includes(tag);
  }

  addTags(tags) {
    this.tags = [...new Set(this.tags.concat(tags))];
  }

  /**
   * Compute TLE signature for duplicate detection
   * Uses lines 1 and 2 (the actual orbital elements) to identify unique TLEs
   * @param {string} tle - The TLE string
   * @returns {string} Signature string for comparison
   */
  computeTleSignature(tle) {
    const lines = tle.split("\n");
    // Use lines 1 and 2 (the actual orbital elements)
    // Line 0 is the name, which may differ for the same satellite
    if (lines.length >= 3) {
      return `${lines[1].trim()}|${lines[2].trim()}`;
    }
    // Fallback for 2-line TLE format
    return lines.map((l) => l.trim()).join("|");
  }

  /**
   * Get the full display name (prefix + canonical name + suffix)
   * @returns {string} Full display name with all decorations
   */
  get displayName() {
    return `${this.displayPrefix}${this.canonicalName}${this.displaySuffix}`;
  }

  isEpochInFuture() {
    const { julianDate } = this.orbit;
    const julianDayNumber = Math.floor(julianDate);
    const secondsOfDay = (julianDate - julianDayNumber) * 60 * 60 * 24;
    const tleDate = new JulianDate(julianDayNumber, secondsOfDay);
    const now = JulianDate.now();
    return JulianDate.compare(tleDate, now) > 0;
  }

  getEpochJulianDate() {
    const { julianDate } = this.orbit;
    const julianDayNumber = Math.floor(julianDate);
    const secondsOfDay = (julianDate - julianDayNumber) * 60 * 60 * 24;
    return new JulianDate(julianDayNumber, secondsOfDay);
  }

  /**
   * Get pre-launch position if satellite should be locked to launch site
   * Returns position if: hasTag("Prelaunch") AND isEpochInFuture() AND time in [epoch-1h, epoch]
   * @param {JulianDate} time - Current simulation time
   * @param {LaunchSiteManager} launchSiteManager - Reference to launch site manager
   * @returns {Cartesian3|null} Launch site position or null
   */
  getPreLaunchPosition(time, launchSiteManager) {
    // Check if satellite has Prelaunch tag and epoch in future
    if (!this.hasTag("Prelaunch") || !this.isEpochInFuture()) {
      return null;
    }

    if (!launchSiteManager) {
      return null;
    }

    const epochJD = this.getEpochJulianDate();
    const epochMinus1h = JulianDate.addSeconds(epochJD, -3600, new JulianDate());
    const epochMinus3days = JulianDate.addDays(epochJD, -3, new JulianDate());

    // Don't show prelaunch satellite more than 3 days before epoch
    if (JulianDate.compare(time, epochMinus3days) < 0) {
      return "hidden";
    }

    // Lock to launch site until 1 hour before epoch, then follow orbit
    if (JulianDate.compare(time, epochMinus1h) < 0) {
      // Cache nearest launch site on first call
      if (!this._cachedLaunchSite) {
        // Use position at epoch minus 1 hour (first orbital position)
        const firstPos = this.computePosition(epochMinus1h);
        this._cachedLaunchSite = launchSiteManager.findNearestLaunchSite(firstPos.positionFixed);
      }
      return this._cachedLaunchSite?.cartesian;
    }

    return null;
  }

  position(time) {
    // Check for pre-launch override
    if (this._launchSiteManager) {
      const preLaunchPos = this.getPreLaunchPosition(time, this._launchSiteManager);
      if (preLaunchPos === "hidden") {
        // Don't show satellite more than 3 days before epoch
        return undefined;
      }
      if (preLaunchPos) {
        return preLaunchPos;
      }
    }
    return this.sampledPosition.fixed.getValue(time);
  }

  getSampledPositionsForNextOrbit(start, reference = "inertial", loop = true) {
    const end = JulianDate.addSeconds(start, this.orbit.orbitalPeriod * 60, new JulianDate());
    const rawPositions = this.sampledPosition[reference].getRawValues(start, end);
    // Filter out undefined positions (e.g., pre-launch satellites that are hidden)
    const positions = rawPositions.filter((p) => p !== undefined);
    if (positions.length === 0) {
      return [];
    }
    if (loop && positions.length > 0) {
      // Readd the first position to the end of the array to close the loop
      return [...positions, positions[0]];
    }
    return positions;
  }

  createSampledPosition(viewer, callback) {
    this.updateSampledPosition(viewer.clock.currentTime);
    callback(this.sampledPosition);

    const samplingRefreshRate = (this.orbit.orbitalPeriod * 60) / 4;
    const removeCallback = CesiumCallbackHelper.createPeriodicTimeCallback(viewer, samplingRefreshRate, (time) => {
      this.updateSampledPosition(time);
      callback(this.sampledPosition);
    });
    return () => {
      removeCallback();
      this.sampledPosition = undefined;
    };
  }

  updateSampledPosition(time) {
    // Determine sampling interval based on sampled positions per orbit and orbital period
    // 120 samples per orbit seems to be a good compromise between performance and accuracy
    const samplingPointsPerOrbit = 120;
    const orbitalPeriod = this.orbit.orbitalPeriod * 60;
    const samplingInterval = orbitalPeriod / samplingPointsPerOrbit;
    // console.log("updateSampledPosition", this.name, this.orbit.orbitalPeriod, samplingInterval.toFixed(2));

    // Calculate desired sampling range (half orbit back, 1.5 orbits forward)
    let requestedStart = JulianDate.addSeconds(time, -orbitalPeriod / 2, new JulianDate());
    let requestedStop = JulianDate.addSeconds(time, orbitalPeriod * 1.5, new JulianDate());

    // For satellites with future epochs, don't try to sample before the epoch
    // SGP4 propagation is unreliable before the TLE epoch time
    // Allow sampling from 1 hour before epoch to show pre-launch position
    const { julianDate } = this.orbit;
    const julianDayNumber = Math.floor(julianDate);
    const secondsOfDay = (julianDate - julianDayNumber) * 60 * 60 * 24;
    const epochJulianDate = new JulianDate(julianDayNumber, secondsOfDay);
    const epochMinus1Hour = JulianDate.addSeconds(epochJulianDate, -3600, new JulianDate());

    if (JulianDate.compare(requestedStart, epochMinus1Hour) < 0) {
      requestedStart = epochMinus1Hour;
      // When start is clamped to future epoch, ensure stop is also after start
      // This allows prelaunch satellites to have valid samples when time jumps to after epoch
      if (JulianDate.compare(requestedStop, requestedStart) <= 0) {
        requestedStop = JulianDate.addSeconds(requestedStart, orbitalPeriod * 2, new JulianDate());
      }
    }

    const request = new TimeInterval({
      start: requestedStart,
      stop: requestedStop,
    });

    // (Re)create sampled position if it does not exist or if it does not contain the current time
    // For future-epoch satellites, the interval might start after the current time,
    // but we still need to create samples for HOLD extrapolation to work
    const needsInit = !this.sampledPosition || (!TimeInterval.contains(this.sampledPosition.interval, time) && JulianDate.compare(time, epochMinus1Hour) >= 0);

    if (needsInit) {
      this.initSampledPosition(request.start);
    } else if (!this.sampledPosition) {
      // For future-epoch satellites before their epoch, initialize at epoch - 1 hour
      this.initSampledPosition(epochMinus1Hour);
    }

    // Determine which parts of the requested interval are missing
    const intersect = TimeInterval.intersect(this.sampledPosition.interval, request);
    const missingSecondsEnd = JulianDate.secondsDifference(request.stop, intersect.stop);
    const missingSecondsStart = JulianDate.secondsDifference(intersect.start, request.start);
    // console.log(`updateSampledPosition ${this.name}`,
    //   `Missing ${missingSecondsStart.toFixed(2)}s ${missingSecondsEnd.toFixed(2)}s`,
    //   `Request ${Cesium.TimeInterval.toIso8601(request, 0)}`,
    //   `Current ${Cesium.TimeInterval.toIso8601(this.sampledPosition.interval, 0)}`,
    //   `Intersect ${Cesium.TimeInterval.toIso8601(intersect, 0)}`,
    // );

    if (missingSecondsStart > 0) {
      const samplingStart = JulianDate.addSeconds(intersect.start, -missingSecondsStart, new JulianDate());
      const samplingStop = this.sampledPosition.interval.start;
      this.addSamples(samplingStart, samplingStop, samplingInterval);
    }
    if (missingSecondsEnd > 0) {
      const samplingStart = this.sampledPosition.interval.stop;
      const samplingStop = JulianDate.addSeconds(intersect.stop, missingSecondsEnd, new JulianDate());
      this.addSamples(samplingStart, samplingStop, samplingInterval);
    }

    // Remove no longer needed samples
    const removeBefore = new TimeInterval({
      start: JulianDate.fromIso8601("1957"),
      stop: request.start,
      isStartIncluded: false,
      isStopIncluded: false,
    });
    const removeAfter = new TimeInterval({
      start: request.stop,
      stop: JulianDate.fromIso8601("2100"),
      isStartIncluded: false,
      isStopIncluded: false,
    });
    this.sampledPosition.fixed.removeSamples(removeBefore);
    this.sampledPosition.inertial.removeSamples(removeBefore);
    this.sampledPosition.fixed.removeSamples(removeAfter);
    this.sampledPosition.inertial.removeSamples(removeAfter);

    this.sampledPosition.interval = request;
  }

  initSampledPosition(currentTime) {
    this.sampledPosition = {};
    this.sampledPosition.interval = new TimeInterval({
      start: currentTime,
      stop: currentTime,
      isStartIncluded: false,
      isStopIncluded: false,
    });
    this.sampledPosition.fixed = new SampledPositionProperty();
    this.sampledPosition.fixed.backwardExtrapolationType = ExtrapolationType.HOLD;
    this.sampledPosition.valid = true; // Initialize as valid
    this.sampledPosition.fixed.forwardExtrapolationType = ExtrapolationType.HOLD;
    this.sampledPosition.fixed.setInterpolationOptions({
      interpolationDegree: 5,
      interpolationAlgorithm: LagrangePolynomialApproximation,
    });
    this.sampledPosition.inertial = new SampledPositionProperty(ReferenceFrame.INERTIAL);
    this.sampledPosition.inertial.backwardExtrapolationType = ExtrapolationType.HOLD;
    this.sampledPosition.inertial.forwardExtrapolationType = ExtrapolationType.HOLD;
    this.sampledPosition.inertial.setInterpolationOptions({
      interpolationDegree: 5,
      interpolationAlgorithm: LagrangePolynomialApproximation,
    });
    this.sampledPosition.valid = true;
  }

  addSamples(start, stop, samplingInterval) {
    const times = [];
    const positionsFixed = [];
    const positionsInertial = [];
    for (let time = start; JulianDate.compare(stop, time) >= 0; time = JulianDate.addSeconds(time, samplingInterval, new JulianDate())) {
      const { positionFixed, positionInertial } = this.computePosition(time);
      times.push(time);
      positionsFixed.push(positionFixed);
      positionsInertial.push(positionInertial);
    }
    // Add all samples at once as adding a sorted array avoids searching for the correct position every time
    this.sampledPosition.fixed.addSamples(times, positionsFixed);
    this.sampledPosition.inertial.addSamples(times, positionsInertial);
  }

  computePositionInertialTEME(time) {
    const eci = this.orbit.positionECI(JulianDate.toDate(time));

    // Check for SGP4 errors or null results
    if (this.orbit.error || !eci) {
      this.sampledPosition.valid = false;
      return Cartesian3.ZERO;
    }

    // Validate position to catch SGP4 garbage results (e.g., from stale high-drag TLEs)
    if (!this.orbit.validatePosition(eci)) {
      if (!this._invalidPositionWarned) {
        console.warn(`Invalid SGP4 position for ${this.name} - satellite may have decayed or TLE is too stale`);
        this._invalidPositionWarned = true;
      }
      this.sampledPosition.valid = false;
      return Cartesian3.ZERO;
    }

    // Reset valid flag to true when we successfully compute a valid position
    // This allows orbit components to be recreated after temporary invalidity
    // (e.g., pre-launch satellites when scrubbing backwards in time before epoch)
    if (this.sampledPosition.valid === false) {
      this.sampledPosition.valid = true;
    }

    return new Cartesian3(eci.x * 1000, eci.y * 1000, eci.z * 1000);
  }

  computePosition(timestamp) {
    const positionInertialTEME = this.computePositionInertialTEME(timestamp);

    const temeToFixed = Transforms.computeTemeToPseudoFixedMatrix(timestamp);
    if (!defined(temeToFixed)) {
      console.error("Reference frame transformation data failed to load");
    }
    const positionFixed = Matrix3.multiplyByVector(temeToFixed, positionInertialTEME, new Cartesian3());

    const fixedToIcrf = Transforms.computeFixedToIcrfMatrix(timestamp);
    if (!defined(fixedToIcrf)) {
      console.error("Reference frame transformation data failed to load");
    }
    const positionInertialICRF = Matrix3.multiplyByVector(fixedToIcrf, positionFixed, new Cartesian3());

    // Show computed sampled position
    // window.cc.viewer.entities.add({
    //  //position: positionFixed,
    //  position: new Cesium.ConstantPositionProperty(positionInertialICRF, Cesium.ReferenceFrame.INERTIAL),
    //  point: {
    //    pixelSize: 8,
    //    color: Cesium.Color.TRANSPARENT,
    //    outlineColor: Cesium.Color.YELLOW,
    //    outlineWidth: 2,
    //  }
    // });

    return { positionFixed, positionInertial: positionInertialICRF };
  }

  /**
   * Calculate the satellite's ground track (subsatellite point path on Earth's surface)
   *
   * @param {JulianDate} julianDate - Current time reference point
   * @param {number} samplesFwd - Number of sample intervals forward in time (default: 2)
   * @param {number} samplesBwd - Number of sample intervals backward in time (default: 0)
   * @param {number} interval - Time interval between samples in seconds (default: 600 = 10 minutes)
   * @returns {Cartesian3[]} Array of 3D positions representing the ground track
   */
  groundTrack(julianDate, samplesFwd = 2, samplesBwd = 0, interval = 600) {
    const groundTrack = [];

    // Calculate time range for ground track sampling
    // Negative startTime goes backward in time, positive stopTime goes forward
    const startTime = -samplesBwd * interval; // e.g., 0 * 600 = 0 (no backward samples by default)
    const stopTime = samplesFwd * interval; // e.g., 2 * 600 = 1200 seconds (20 minutes forward)

    // Sample satellite positions at regular intervals to create ground track
    for (let time = startTime; time <= stopTime; time += interval) {
      // Create timestamp for this sample point
      const timestamp = JulianDate.addSeconds(julianDate, time, new JulianDate());

      // Get satellite position at this time using SGP4 orbital mechanics
      // This returns the 3D Cartesian position in Earth-fixed coordinates
      groundTrack.push(this.position(timestamp));
    }

    // Return array of positions that form the ground track
    // Cesium will project these 3D positions onto Earth's surface for display
    return groundTrack;
  }

  /**
   * Calculate the visible area width from satellite altitude
   * This represents the diameter of the area on Earth's surface from which
   * the satellite can be seen above the horizon (minimum 10° elevation)
   *
   * @param {Cesium.JulianDate} time - Time for satellite position calculation
   * @param {number} minElevation - Minimum elevation angle in degrees (default: 10°)
   * @returns {number} Visible area diameter in kilometers
   */
  getVisibleAreaWidth(time, minElevation = 10) {
    // Get satellite position at given time
    const satellitePosition = this.position(time);
    if (!satellitePosition) return 0;

    // Calculate satellite altitude above Earth's surface
    const ellipsoid = Ellipsoid.WGS84;
    const cartographic = ellipsoid.cartesianToCartographic(satellitePosition);
    if (!cartographic) return 0;

    const altitudeKm = cartographic.height / 1000; // Convert to kilometers
    const earthRadiusKm = 6371; // Average Earth radius in km

    // Calculate satellite visibility radius using simple geometric approach
    // For 10° minimum elevation, use the horizon distance formula with elevation correction

    const minElevationRad = minElevation * (Math.PI / 180);

    // For 10° minimum elevation, use a more accurate geometric calculation
    // The key insight: lower satellites have smaller visibility circles at high elevation angles

    // Maximum slant range from observer to satellite at minimum elevation
    // Using geometry: range = (R + h) * sin(arccos(R/(R+h)) - elevation_angle)
    const satelliteDistance = earthRadiusKm + altitudeKm;
    const nadir_angle = Math.acos(earthRadiusKm / satelliteDistance);
    const effective_angle = nadir_angle - minElevationRad;

    let visibleRadiusKm;
    if (effective_angle <= 0) {
      // Satellite too low for this elevation angle
      visibleRadiusKm = 0;
    } else {
      // Ground range is approximately slant_range * cos(elevation)
      const slant_range = satelliteDistance * Math.sin(effective_angle);
      visibleRadiusKm = slant_range * Math.cos(minElevationRad);
    }
    const visibleDiameterKm = 2 * visibleRadiusKm;

    return visibleDiameterKm;
  }

  get groundStationAvailable() {
    return this.groundStations.length > 0;
  }

  async updatePasses(time) {
    if (!this.groundStationAvailable) {
      return false;
    }
    // Check if still inside of current pass interval
    if (typeof this.passInterval !== "undefined" && TimeInterval.contains(new TimeInterval({ start: this.passInterval.start, stop: this.passInterval.stop }), time)) {
      return false;
    }
    this.passInterval = {
      start: JulianDate.addDays(time, -1, JulianDate.clone(time)),
      stop: JulianDate.addDays(time, 1, JulianDate.clone(time)),
      stopPrediction: JulianDate.addDays(time, 4, JulianDate.clone(time)),
    };

    let allPasses = [];
    const epochInFuture = this.isEpochInFuture();

    // Get epoch time for filtering
    const { julianDate } = this.orbit;
    const julianDayNumber = Math.floor(julianDate);
    const secondsOfDay = (julianDate - julianDayNumber) * 60 * 60 * 24;
    const epochJulianDate = new JulianDate(julianDayNumber, secondsOfDay);
    const epochTime = JulianDate.toDate(epochJulianDate);

    // Calculate passes for all ground stations in parallel
    const passPromises = this.groundStations.map(async (groundStation) => {
      let passes;
      if (this.overpassMode === "swath") {
        passes = await this.orbit.computePassesSwath(
          groundStation.position,
          this.swath,
          JulianDate.toDate(this.passInterval.start),
          JulianDate.toDate(this.passInterval.stopPrediction),
        );
      } else {
        passes = await this.orbit.computePassesElevation(groundStation.position, JulianDate.toDate(this.passInterval.start), JulianDate.toDate(this.passInterval.stopPrediction));
      }
      passes.forEach((pass) => {
        pass.groundStationName = groundStation.name;
        pass.epochInFuture = epochInFuture;
        pass.epochTime = epochTime;
      });
      return passes;
    });

    const passArrays = await Promise.all(passPromises);
    allPasses = passArrays.flat();

    // Sort passes by time
    allPasses = allPasses.sort((a, b) => a.start - b.start);

    this.passes = allPasses;
    this.computePassIntervals();
    return true;
  }

  clearPasses() {
    this.passInterval = undefined;
    this.passes = [];
    this.passIntervals = new TimeIntervalCollection();
  }

  computePassIntervals() {
    const passIntervalArray = this.passes.map((pass) => {
      const startJulian = JulianDate.fromDate(new Date(pass.start));
      const endJulian = JulianDate.fromDate(new Date(pass.end));
      return new TimeInterval({
        start: startJulian,
        stop: endJulian,
      });
    });
    this.passIntervals = new TimeIntervalCollection(passIntervalArray);
  }

  get swath() {
    // Use canonicalName (without prefixes/suffixes) for matching
    const nameToMatch = this.canonicalName;

    // Hardcoded swath for certain satellites
    if (["SUOMI NPP", "NOAA 20 (JPSS-1)", "NOAA 21 (JPSS-2)"].includes(nameToMatch)) {
      return 3000;
    }
    if (["AQUA", "TERRA"].includes(nameToMatch)) {
      return 2330;
    }
    if (nameToMatch.includes("SENTINEL-2")) {
      return 290;
    }
    if (nameToMatch.includes("SENTINEL-3")) {
      return 740;
    }
    if (nameToMatch.includes("LANDSAT")) {
      return 185;
    }
    if (nameToMatch.includes("FENGYUN")) {
      return 2900;
    }
    if (nameToMatch.includes("METOP")) {
      return 2900;
    }
    return 200;
  }
}
