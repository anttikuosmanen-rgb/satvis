import * as Cesium from "@cesium/engine";
import dayjs from "dayjs";
import { useToast } from "vue-toastification";

import Orbit from "./Orbit";
import { PushManager } from "./util/PushManager";
import "./util/CesiumSampledPositionRawValueAccess";

import satvisIcon from "../assets/android-chrome-192x192.png";
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

    this.groundStations = [];
    this.passes = [];
    this.passInterval = undefined;
    this.passIntervals = new Cesium.TimeIntervalCollection();
    this.pm = new PushManager({
      icon: satvisIcon,
    });
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
    const end = Cesium.JulianDate.addSeconds(start, this.orbit.orbitalPeriod * 60, new Cesium.JulianDate());
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
    const request = new Cesium.TimeInterval({
      start: Cesium.JulianDate.addSeconds(time, -orbitalPeriod / 2, new Cesium.JulianDate()),
      stop: Cesium.JulianDate.addSeconds(time, orbitalPeriod * 1.5, new Cesium.JulianDate()),
    });

    // (Re)create sampled position if it does not exist or if it does not contain the current time
    if (!this.sampledPosition || !Cesium.TimeInterval.contains(this.sampledPosition.interval, time)) {
      this.initSampledPosition(request.start);
    }

    // Determine which parts of the requested interval are missing
    const intersect = Cesium.TimeInterval.intersect(this.sampledPosition.interval, request);
    const missingSecondsEnd = Cesium.JulianDate.secondsDifference(request.stop, intersect.stop);
    const missingSecondsStart = Cesium.JulianDate.secondsDifference(intersect.start, request.start);
    // console.log(`updateSampledPosition ${this.name}`,
    //   `Missing ${missingSecondsStart.toFixed(2)}s ${missingSecondsEnd.toFixed(2)}s`,
    //   `Request ${Cesium.TimeInterval.toIso8601(request, 0)}`,
    //   `Current ${Cesium.TimeInterval.toIso8601(this.sampledPosition.interval, 0)}`,
    //   `Intersect ${Cesium.TimeInterval.toIso8601(intersect, 0)}`,
    // );

    if (missingSecondsStart > 0) {
      const samplingStart = Cesium.JulianDate.addSeconds(intersect.start, -missingSecondsStart, new Cesium.JulianDate());
      const samplingStop = this.sampledPosition.interval.start;
      this.addSamples(samplingStart, samplingStop, samplingInterval);
    }
    if (missingSecondsEnd > 0) {
      const samplingStart = this.sampledPosition.interval.stop;
      const samplingStop = Cesium.JulianDate.addSeconds(intersect.stop, missingSecondsEnd, new Cesium.JulianDate());
      this.addSamples(samplingStart, samplingStop, samplingInterval);
    }

    // Remove no longer needed samples
    const removeBefore = new Cesium.TimeInterval({
      start: Cesium.JulianDate.fromIso8601("1957"),
      stop: request.start,
      isStartIncluded: false,
      isStopIncluded: false,
    });
    const removeAfter = new Cesium.TimeInterval({
      start: request.stop,
      stop: Cesium.JulianDate.fromIso8601("2100"),
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
    this.sampledPosition.interval = new Cesium.TimeInterval({
      start: currentTime,
      stop: currentTime,
      isStartIncluded: false,
      isStopIncluded: false,
    });
    this.sampledPosition.fixed = new Cesium.SampledPositionProperty();
    this.sampledPosition.fixed.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    this.sampledPosition.fixed.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    this.sampledPosition.fixed.setInterpolationOptions({
      interpolationDegree: 5,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
    });
    this.sampledPosition.inertial = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.INERTIAL);
    this.sampledPosition.inertial.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    this.sampledPosition.inertial.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
    this.sampledPosition.inertial.setInterpolationOptions({
      interpolationDegree: 5,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
    });
    this.sampledPosition.valid = true;
  }

  addSamples(start, stop, samplingInterval) {
    const times = [];
    const positionsFixed = [];
    const positionsInertial = [];
    for (let time = start; Cesium.JulianDate.compare(stop, time) >= 0; time = Cesium.JulianDate.addSeconds(time, samplingInterval, new Cesium.JulianDate())) {
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
    const eci = this.orbit.positionECI(Cesium.JulianDate.toDate(time));
    if (this.orbit.error) {
      this.sampledPosition.valid = false;
      return Cesium.Cartesian3.ZERO;
    }
    return new Cesium.Cartesian3(eci.x * 1000, eci.y * 1000, eci.z * 1000);
  }

  computePosition(timestamp) {
    const positionInertialTEME = this.computePositionInertialTEME(timestamp);

    const temeToFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(timestamp);
    if (!Cesium.defined(temeToFixed)) {
      console.error("Reference frame transformation data failed to load");
    }
    const positionFixed = Cesium.Matrix3.multiplyByVector(temeToFixed, positionInertialTEME, new Cesium.Cartesian3());

    const fixedToIcrf = Cesium.Transforms.computeFixedToIcrfMatrix(timestamp);
    if (!Cesium.defined(fixedToIcrf)) {
      console.error("Reference frame transformation data failed to load");
    }
    const positionInertialICRF = Cesium.Matrix3.multiplyByVector(fixedToIcrf, positionFixed, new Cesium.Cartesian3());

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

  groundTrack(julianDate, samplesFwd = 2, samplesBwd = 0, interval = 600) {
    const groundTrack = [];

    const startTime = -samplesBwd * interval;
    const stopTime = samplesFwd * interval;
    for (let time = startTime; time <= stopTime; time += interval) {
      const timestamp = Cesium.JulianDate.addSeconds(julianDate, time, new Cesium.JulianDate());
      groundTrack.push(this.position(timestamp));
    }
    return groundTrack;
  }

  get groundStationAvailable() {
    return this.groundStations.length > 0;
  }

  updatePasses(time) {
    if (!this.groundStationAvailable) {
      return false;
    }
    // Check if still inside of current pass interval
    if (typeof this.passInterval !== "undefined" &&
        Cesium.TimeInterval.contains(new Cesium.TimeInterval({ start: this.passInterval.start, stop: this.passInterval.stop }), time)) {
      return false;
    }
    this.passInterval = {
      start: Cesium.JulianDate.addDays(time, -1, Cesium.JulianDate.clone(time)),
      stop: Cesium.JulianDate.addDays(time, 1, Cesium.JulianDate.clone(time)),
      stopPrediction: Cesium.JulianDate.addDays(time, 4, Cesium.JulianDate.clone(time)),
    };

    let allPasses = [];
    this.groundStations.forEach((groundStation) => {
      const passes = this.orbit.computePassesElevation(
        groundStation.position,
        Cesium.JulianDate.toDate(this.passInterval.start),
        Cesium.JulianDate.toDate(this.passInterval.stopPrediction),
      );
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
    this.passIntervals = new Cesium.TimeIntervalCollection();
  }

  computePassIntervals() {
    const passIntervalArray = this.passes.map((pass) => {
      const startJulian = Cesium.JulianDate.fromDate(new Date(pass.start));
      const endJulian = Cesium.JulianDate.fromDate(new Date(pass.end));
      return new Cesium.TimeInterval({
        start: startJulian,
        stop: endJulian,
      });
    });
    this.passIntervals = new Cesium.TimeIntervalCollection(passIntervalArray);
  }

  notifyPasses(aheadMin = 5) {
    const toast = useToast();

    if (!this.groundStationAvailable) {
      toast.warning("Ground station required to notify for passes");
      return;
    }
    const passes = this.orbit.computePassesElevation(this.groundStationPosition);
    if (!passes) {
      toast.info(`No passes for ${this.name}`);
      return;
    }

    passes.forEach((pass) => {
      const start = dayjs(pass.start).startOf("second");
      this.pm.notifyAtDate(start.subtract(aheadMin, "minute"), `${pass.name} pass in ${aheadMin} minutes`);
      this.pm.notifyAtDate(start, `${pass.name} pass starting now`);
      // this.pm.notifyAtDate(dayjs().add(5, "second"), `${pass.name} test pass in ${aheadMin} minutes`);
    });
    toast.success(`Notifying for ${passes.length} passes of ${this.name}`);
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
