import * as satellitejs from "satellite.js";
import dayjs from "dayjs";
import * as Astronomy from "astronomy-engine";
import { GroundStationConditions } from "./util/GroundStationConditions";
import { SGP4WorkerPool } from "../workers/SGP4WorkerPool";

const deg2rad = Math.PI / 180;
const rad2deg = 180 / Math.PI;

export default class Orbit {
  constructor(name, tle) {
    this.name = name;
    this.tle = tle.split("\n");
    this.satrec = satellitejs.twoline2satrec(this.tle[1], this.tle[2]);
  }

  get satnum() {
    return this.satrec.satnum;
  }

  get error() {
    return this.satrec.error;
  }

  get julianDate() {
    return this.satrec.jdsatepoch;
  }

  get orbitalPeriod() {
    const meanMotionRad = this.satrec.no;
    const period = (2 * Math.PI) / meanMotionRad;
    return period;
  }

  positionECI(time) {
    const result = satellitejs.propagate(this.satrec, time);
    return result ? result.position : null;
  }

  positionECF(time) {
    const positionEci = this.positionECI(time);
    if (!positionEci) return null;
    const gmst = satellitejs.gstime(time);
    const positionEcf = satellitejs.eciToEcf(positionEci, gmst);
    return positionEcf;
  }

  positionGeodetic(timestamp, calculateVelocity = false) {
    const result = satellitejs.propagate(this.satrec, timestamp);
    if (!result) return null;
    const { position: positionEci, velocity: velocityVector } = result;
    const gmst = satellitejs.gstime(timestamp);
    const positionGd = satellitejs.eciToGeodetic(positionEci, gmst);

    return {
      longitude: positionGd.longitude * rad2deg,
      latitude: positionGd.latitude * rad2deg,
      height: positionGd.height * 1000,
      ...(calculateVelocity && {
        velocity: Math.sqrt(velocityVector.x * velocityVector.x + velocityVector.y * velocityVector.y + velocityVector.z * velocityVector.z),
      }),
    };
  }

  async computePassesElevation(groundStationPosition, startDate = dayjs().toDate(), endDate = dayjs(startDate).add(7, "day").toDate(), minElevation = 5, maxPasses = 50) {
    // Try to use WebWorker if available, otherwise fall back to main thread
    if (SGP4WorkerPool.isAvailable()) {
      try {
        const passes = await SGP4WorkerPool.computePassesElevation(this.tle, groundStationPosition, startDate.getTime(), endDate.getTime(), minElevation, maxPasses);

        // Add additional data that worker can't calculate (requires astronomy-engine)
        for (const pass of passes) {
          pass.name = this.name;
          pass.groundStationDarkAtStart = GroundStationConditions.isInDarkness(groundStationPosition, new Date(pass.start));
          pass.satelliteEclipsedAtStart = this.isInEclipse(new Date(pass.start));
          pass.groundStationDarkAtEnd = GroundStationConditions.isInDarkness(groundStationPosition, new Date(pass.end));
          pass.satelliteEclipsedAtEnd = this.isInEclipse(new Date(pass.end));
          pass.eclipseTransitions = this.findEclipseTransitions(pass.start, pass.end, 30);
        }

        return passes;
      } catch (error) {
        console.warn("WebWorker pass calculation failed, falling back to main thread:", error);
        // Fall through to main thread calculation
      }
    }

    // Main thread calculation (fallback)
    return this.computePassesElevationSync(groundStationPosition, startDate, endDate, minElevation, maxPasses);
  }

  computePassesElevationSync(groundStationPosition, startDate = dayjs().toDate(), endDate = dayjs(startDate).add(7, "day").toDate(), minElevation = 5, maxPasses = 50) {
    // Skip pass calculation for satellites with very long orbital periods
    // (e.g., geostationary satellites at ~1436 minutes)
    // These satellites stay continuously visible and don't have traditional "passes"
    if (this.orbitalPeriod > 600) {
      return [];
    }

    // For satellites with future epochs, ensure we don't try to calculate before the epoch
    // SGP4 propagation is unreliable before the TLE epoch time
    // Allow calculation from 1 hour before epoch to show pre-launch position
    const epochDate = new Date((this.julianDate - 2440587.5) * 86400000); // Convert Julian date to JS Date
    const epochMinus1Hour = new Date(epochDate.getTime() - 3600000); // 1 hour before epoch
    const effectiveStartDate = startDate < epochMinus1Hour ? epochMinus1Hour : startDate;

    // Keep original position for sun calculations (degrees)
    const originalGroundStation = { ...groundStationPosition };

    // Convert ground station position to radians and proper units for satellite.js
    const groundStation = { ...groundStationPosition };
    groundStation.latitude *= deg2rad;
    groundStation.longitude *= deg2rad;
    groundStation.height /= 1000; // Convert meters to kilometers

    // Initialize tracking variables
    const date = new Date(effectiveStartDate);
    const passes = [];
    let pass = false;
    let ongoingPass = false;
    let lastElevation = 0;

    // Main calculation loop - step through time until end date
    while (date < endDate) {
      // Calculate satellite position and look angles from ground station
      const positionEcf = this.positionECF(date);
      if (!positionEcf) {
        date.setMinutes(date.getMinutes() + 1);
        continue;
      }
      const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);
      const elevation = lookAngles.elevation / deg2rad; // Convert to degrees

      if (elevation > minElevation) {
        // Satellite is visible above minimum elevation threshold
        if (!ongoingPass) {
          // Start of new pass - record initial conditions
          pass = {
            start: date.getTime(),
            azimuthStart: lookAngles.azimuth,
            maxElevation: elevation,
            azimuthApex: lookAngles.azimuth,
            groundStationDarkAtStart: GroundStationConditions.isInDarkness(originalGroundStation, date),
            satelliteEclipsedAtStart: this.isInEclipse(date),
            name: this.name,
          };
          ongoingPass = true;
        } else if (elevation > pass.maxElevation) {
          // Update peak conditions during ongoing pass
          pass.maxElevation = elevation;
          pass.apex = date.getTime();
          pass.azimuthApex = lookAngles.azimuth;
        }
        // Small time step during visible pass for accuracy
        date.setSeconds(date.getSeconds() + 5);
      } else if (ongoingPass) {
        // End of pass - finalize pass data and add to results
        pass.end = date.getTime();
        pass.duration = pass.end - pass.start;
        pass.azimuthEnd = lookAngles.azimuth;
        pass.groundStationDarkAtEnd = GroundStationConditions.isInDarkness(originalGroundStation, date);
        pass.satelliteEclipsedAtEnd = this.isInEclipse(date);

        // Find eclipse transitions during the pass
        pass.eclipseTransitions = this.findEclipseTransitions(pass.start, pass.end, 30);

        // Convert azimuth angles from radians to degrees
        pass.azimuthStart /= deg2rad;
        pass.azimuthApex /= deg2rad;
        pass.azimuthEnd /= deg2rad;
        passes.push(pass);

        // Stop if we've found enough passes
        if (passes.length > maxPasses) {
          break;
        }

        ongoingPass = false;
        lastElevation = -180;
        // Skip ahead roughly half an orbital period to next potential pass
        date.setMinutes(date.getMinutes() + this.orbitalPeriod * 0.5);
      } else {
        // Satellite not visible - use adaptive time stepping for efficiency
        const deltaElevation = elevation - lastElevation;
        lastElevation = elevation;

        if (deltaElevation < 0) {
          // Satellite moving away from horizon - skip ahead half orbit
          date.setMinutes(date.getMinutes() + this.orbitalPeriod * 0.5);
          lastElevation = -180;
        } else if (elevation < -20) {
          // Very far below horizon - large time steps
          date.setMinutes(date.getMinutes() + 5);
        } else if (elevation < -5) {
          // Moderately below horizon - medium time steps
          date.setMinutes(date.getMinutes() + 1);
        } else if (elevation < -1) {
          // Close to horizon - smaller time steps
          date.setSeconds(date.getSeconds() + 5);
        } else {
          // Very close to horizon - finest time steps for accuracy
          date.setSeconds(date.getSeconds() + 2);
        }
      }
    }
    return passes;
  }

  async computePassesSwath(groundStationPosition, swathKm, startDate = dayjs().toDate(), endDate = dayjs(startDate).add(7, "day").toDate(), maxPasses = 50) {
    // Try to use WebWorker if available, otherwise fall back to main thread
    if (SGP4WorkerPool.isAvailable()) {
      try {
        const passes = await SGP4WorkerPool.computePassesSwath(this.tle, groundStationPosition, swathKm, startDate.getTime(), endDate.getTime(), maxPasses);

        // Add additional data that worker can't calculate (requires astronomy-engine)
        for (const pass of passes) {
          pass.name = this.name;
          pass.groundStationDarkAtStart = GroundStationConditions.isInDarkness(groundStationPosition, new Date(pass.start));
          pass.satelliteEclipsedAtStart = this.isInEclipse(new Date(pass.start));
          pass.groundStationDarkAtEnd = GroundStationConditions.isInDarkness(groundStationPosition, new Date(pass.end));
          pass.satelliteEclipsedAtEnd = this.isInEclipse(new Date(pass.end));
          pass.eclipseTransitions = this.findEclipseTransitions(pass.start, pass.end, 30);
        }

        return passes;
      } catch (error) {
        console.warn("WebWorker swath calculation failed, falling back to main thread:", error);
        // Fall through to main thread calculation
      }
    }

    // Main thread calculation (fallback)
    return this.computePassesSwathSync(groundStationPosition, swathKm, startDate, endDate, maxPasses);
  }

  computePassesSwathSync(groundStationPosition, swathKm, startDate = dayjs().toDate(), endDate = dayjs(startDate).add(7, "day").toDate(), maxPasses = 50) {
    // For satellites with future epochs, ensure we don't try to calculate before the epoch
    // SGP4 propagation is unreliable before the TLE epoch time
    // Allow calculation from 1 hour before epoch to show pre-launch position
    const epochDate = new Date((this.julianDate - 2440587.5) * 86400000); // Convert Julian date to JS Date
    const epochMinus1Hour = new Date(epochDate.getTime() - 3600000); // 1 hour before epoch
    const effectiveStartDate = startDate < epochMinus1Hour ? epochMinus1Hour : startDate;

    // Keep original position for sun calculations (degrees)
    const originalGroundStation = { ...groundStationPosition };

    const groundStation = { ...groundStationPosition };
    groundStation.latitude *= deg2rad;
    groundStation.longitude *= deg2rad;
    groundStation.height /= 1000;

    const date = new Date(effectiveStartDate);
    const passes = [];
    let pass = false;
    let ongoingPass = false;
    let lastDistance = Number.MAX_VALUE;

    while (date < endDate) {
      const positionGeodetic = this.positionGeodetic(date);
      if (!positionGeodetic) {
        date.setMinutes(date.getMinutes() + 1);
        continue;
      }

      // Convert satellite position to radians for calculations
      const satLat = positionGeodetic.latitude * deg2rad;
      const satLon = positionGeodetic.longitude * deg2rad;

      // Calculate great circle distance between satellite and ground station
      const deltaLat = satLat - groundStation.latitude;
      const deltaLon = satLon - groundStation.longitude;
      const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) + Math.cos(groundStation.latitude) * Math.cos(satLat) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const earthRadius = 6371; // Earth radius in km
      const distanceKm = earthRadius * c;

      // Check if ground station is within swath
      const halfSwath = swathKm / 2;
      const withinSwath = distanceKm <= halfSwath;

      if (withinSwath) {
        if (!ongoingPass) {
          // Start of new pass - record initial conditions
          pass = {
            name: this.name,
            start: date.getTime(),
            minDistance: distanceKm,
            minDistanceTime: date.getTime(),
            swathWidth: swathKm,
            groundStationDarkAtStart: GroundStationConditions.isInDarkness(originalGroundStation, date),
            satelliteEclipsedAtStart: this.isInEclipse(date),
            // Add placeholder values for card rendering compatibility
            maxElevation: 0, // Not applicable for swath mode
            azimuthApex: 0, // Not applicable for swath mode
          };
          ongoingPass = true;
        } else if (distanceKm < pass.minDistance) {
          // Update minimum distance (closest approach)
          pass.minDistance = distanceKm;
          pass.minDistanceTime = date.getTime();
        }
        date.setSeconds(date.getSeconds() + 30); // 30 second steps during pass
      } else if (ongoingPass) {
        // End of pass - finalize pass data
        pass.end = date.getTime();
        pass.duration = pass.end - pass.start;
        pass.groundStationDarkAtEnd = GroundStationConditions.isInDarkness(originalGroundStation, date);
        pass.satelliteEclipsedAtEnd = this.isInEclipse(date);

        // Find eclipse transitions during the pass
        pass.eclipseTransitions = this.findEclipseTransitions(pass.start, pass.end, 30);

        passes.push(pass);
        if (passes.length >= maxPasses) {
          break;
        }
        ongoingPass = false;
        lastDistance = Number.MAX_VALUE;
        // Skip ahead to avoid immediate re-entry
        date.setMinutes(date.getMinutes() + Math.max(5, this.orbitalPeriod * 0.1));
      } else {
        // Not in pass, adjust time step based on distance and previous distance
        const deltaDistance = distanceKm - lastDistance;
        lastDistance = distanceKm;

        if (deltaDistance > 0 && distanceKm > halfSwath * 4) {
          // Moving away and far from swath, skip ahead more
          date.setMinutes(date.getMinutes() + Math.max(10, this.orbitalPeriod * 0.2));
        } else if (distanceKm > halfSwath * 3) {
          // Far from swath
          date.setMinutes(date.getMinutes() + 5);
        } else if (distanceKm > halfSwath * 2) {
          // Moderately far from swath
          date.setMinutes(date.getMinutes() + 2);
        } else if (distanceKm > halfSwath * 1.2) {
          // Getting closer to swath
          date.setMinutes(date.getMinutes() + 1);
        } else {
          // Very close to swath threshold, use fine time steps
          date.setSeconds(date.getSeconds() + 15);
        }
      }
    }

    return passes;
  }

  /**
   * Determines if satellite is in Earth's shadow (eclipsed)
   * @param {Date} date - Time to check eclipse status
   * @returns {boolean} True if satellite is in Earth's shadow
   */
  isInEclipse(date) {
    try {
      // Get satellite position in ECF coordinates
      const satEcf = this.positionECF(date);

      // Convert ECF to ECI coordinates for astronomy calculations
      const gmst = satellitejs.gstime(date);
      const satEci = satellitejs.ecfToEci(satEcf, gmst);

      // Convert to kilometers and get position vector
      const satPos = {
        x: satEci.x,
        y: satEci.y,
        z: satEci.z,
      };

      // Get Sun's position using astronomy-engine in proper geocentric coordinates
      const astroTime = new Astronomy.AstroTime(date);

      // Use GeoVector to get Sun position in geocentric equatorial coordinates
      // This gives us the Sun's position relative to Earth's center in the same
      // coordinate system as our satellite ECI coordinates
      const sunGeoVector = Astronomy.GeoVector(Astronomy.Body.Sun, astroTime, false);

      // Convert to km (astronomy-engine uses AU)
      const auToKm = 149597870.7;
      const sunPos = {
        x: sunGeoVector.x * auToKm,
        y: sunGeoVector.y * auToKm,
        z: sunGeoVector.z * auToKm,
      };

      // Earth radius in km
      const earthRadius = 6378.137;

      // Calculate if satellite is in Earth's shadow
      return this.calculateEarthShadow(satPos, sunPos, earthRadius);
    } catch (error) {
      console.warn("Eclipse calculation failed:", error);
      return false; // Default to sunlit if calculation fails
    }
  }

  /**
   * Calculate if satellite is in Earth's shadow using geometric shadow model
   * @param {Object} satPos - Satellite position {x, y, z} in km
   * @param {Object} sunPos - Sun position {x, y, z} in km
   * @param {number} earthRadius - Earth radius in km
   * @returns {boolean} True if satellite is in shadow
   */
  calculateEarthShadow(satPos, sunPos, earthRadius) {
    // Vector from Sun to satellite
    const sunToSat = {
      x: satPos.x - sunPos.x,
      y: satPos.y - sunPos.y,
      z: satPos.z - sunPos.z,
    };

    // Vector from Sun to Earth center (opposite of sunPos since Earth is at origin)
    const sunToEarth = {
      x: -sunPos.x,
      y: -sunPos.y,
      z: -sunPos.z,
    };

    // Distance from satellite to Sun-Earth line
    const sunToEarthMag = Math.sqrt(sunToEarth.x * sunToEarth.x + sunToEarth.y * sunToEarth.y + sunToEarth.z * sunToEarth.z);
    const sunToSatMag = Math.sqrt(sunToSat.x * sunToSat.x + sunToSat.y * sunToSat.y + sunToSat.z * sunToSat.z);

    // Check if satellite is on the sun side of Earth
    // If satellite is closer to sun than Earth is, it's on the sun side
    if (sunToSatMag < sunToEarthMag) {
      return false; // Satellite is on sun side, cannot be in shadow
    }

    // Dot product to find projection
    const dotProduct = sunToSat.x * sunToEarth.x + sunToSat.y * sunToEarth.y + sunToSat.z * sunToEarth.z;
    const projection = dotProduct / sunToEarthMag;

    // Calculate perpendicular distance from satellite to Sun-Earth line
    const perpDistance = Math.sqrt(sunToSatMag * sunToSatMag - projection * projection);

    // Simple umbra calculation - satellite is in shadow if within Earth's shadow cone
    // This is a simplified model; a more accurate model would include penumbra
    const shadowRadius = earthRadius; // Simplified - actual shadow radius varies with distance

    return perpDistance < shadowRadius;
  }

  /**
   * Find eclipse transition times during a satellite pass
   * @param {number} startTime - Pass start time in milliseconds
   * @param {number} endTime - Pass end time in milliseconds
   * @param {number} timeStep - Time step in seconds for searching
   * @returns {Array} Array of transition times {time, fromShadow: boolean}
   */
  findEclipseTransitions(startTime, endTime, timeStep = 10) {
    const transitions = [];
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    const currentDate = new Date(startDate);
    let wasInEclipse = this.isInEclipse(currentDate);

    while (currentDate < endDate) {
      currentDate.setSeconds(currentDate.getSeconds() + timeStep);
      const isInEclipse = this.isInEclipse(currentDate);

      if (isInEclipse !== wasInEclipse) {
        // Eclipse state changed - record transition
        transitions.push({
          time: currentDate.getTime(),
          fromShadow: wasInEclipse, // true if transitioning from shadow to sunlight
          toShadow: isInEclipse, // true if transitioning from sunlight to shadow
        });
        wasInEclipse = isInEclipse;
      }
    }

    return transitions;
  }
}
