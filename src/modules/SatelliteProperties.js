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
  constructor(tle, tags = []) {
    this.name = tle.split("\n")[0].trim();
    if (tle.startsWith("0 ")) {
      this.name = this.name.substring(2);
    }
    this.orbit = new Orbit(this.name, tle);
    this.satnum = this.orbit.satnum;
    this.tags = tags;
    this.overpassMode = "elevation";

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

  position(time) {
    return this.sampledPosition.fixed.getValue(time);
  }

  getSampledPositionsForNextOrbit(start, reference = "inertial", loop = true) {
    const end = JulianDate.addSeconds(start, this.orbit.orbitalPeriod * 60, new JulianDate());
    const positions = this.sampledPosition[reference].getRawValues(start, end);
    if (loop) {
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

    // Always keep half an orbit backwards and 1.5 full orbits forward in the sampled position
    const request = new TimeInterval({
      start: JulianDate.addSeconds(time, -orbitalPeriod / 2, new JulianDate()),
      stop: JulianDate.addSeconds(time, orbitalPeriod * 1.5, new JulianDate()),
    });

    // (Re)create sampled position if it does not exist or if it does not contain the current time
    if (!this.sampledPosition || !TimeInterval.contains(this.sampledPosition.interval, time)) {
      this.initSampledPosition(request.start);
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
    if (this.orbit.error) {
      this.sampledPosition.valid = false;
      return Cartesian3.ZERO;
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
    const stopTime = samplesFwd * interval;   // e.g., 2 * 600 = 1200 seconds (20 minutes forward)

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

    // Debug logging for visibility area calculations
    console.log(`[${this.name}] Visibility area calculation:`, {
      altitudeKm: altitudeKm.toFixed(1),
      minElevationDeg: minElevation,
      satelliteDistance: satelliteDistance.toFixed(1),
      nadirAngleDeg: (nadir_angle * 180 / Math.PI).toFixed(2),
      effectiveAngleDeg: (effective_angle * 180 / Math.PI).toFixed(2),
      visibleRadiusKm: visibleRadiusKm.toFixed(1),
      visibleDiameterKm: visibleDiameterKm.toFixed(1)
    });

    return visibleDiameterKm;
  }

  get groundStationAvailable() {
    return this.groundStations.length > 0;
  }

  updatePasses(time) {
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
    this.groundStations.forEach((groundStation) => {
      let passes;
      if (this.overpassMode === "swath") {
        passes = this.orbit.computePassesSwath(groundStation.position, this.swath, JulianDate.toDate(this.passInterval.start), JulianDate.toDate(this.passInterval.stopPrediction));
      } else {
        passes = this.orbit.computePassesElevation(groundStation.position, JulianDate.toDate(this.passInterval.start), JulianDate.toDate(this.passInterval.stopPrediction));
      }
      passes.forEach((pass) => {
        pass.groundStationName = groundStation.name;
      });
      allPasses.push(...passes);
    });

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
    // Hardcoded swath for certain satellites
    if (["SUOMI NPP", "NOAA 20 (JPSS-1)", "NOAA 21 (JPSS-2)"].includes(this.name)) {
      return 3000;
    }
    if (["AQUA", "TERRA"].includes(this.name)) {
      return 2330;
    }
    if (this.name.includes("SENTINEL-2")) {
      return 290;
    }
    if (this.name.includes("SENTINEL-3")) {
      return 740;
    }
    if (this.name.includes("LANDSAT")) {
      return 185;
    }
    if (this.name.includes("FENGYUN")) {
      return 2900;
    }
    if (this.name.includes("METOP")) {
      return 2900;
    }
    return 200;
  }
}
