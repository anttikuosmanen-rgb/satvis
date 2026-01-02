import * as satellitejs from "satellite.js";
import dayjs from "dayjs";
import * as Astronomy from "astronomy-engine";
import { SGP4WorkerPool } from "../workers/SGP4WorkerPool";
import { GroundStationConditions } from "./util/GroundStationConditions";

const deg2rad = Math.PI / 180;
const rad2deg = 180 / Math.PI;

/**
 * Pre-compute ground station data for optimized look angles calculation.
 * This avoids repeated trig calculations since the ground station is constant.
 * @param {Object} observerGeodetic - {latitude, longitude, height} in radians and km
 * @returns {Object} Pre-computed values for fast look angles
 */
function precomputeGroundStationData(observerGeodetic) {
  const { latitude, longitude, height } = observerGeodetic;

  // Pre-compute trig values
  const sinLat = Math.sin(latitude);
  const cosLat = Math.cos(latitude);
  const sinLon = Math.sin(longitude);
  const cosLon = Math.cos(longitude);

  // Pre-compute observer ECF position (from satellite.js geodeticToEcf)
  const a = 6378.137;
  const b = 6356.7523142;
  const f = (a - b) / a;
  const e2 = 2 * f - f * f;
  const normal = a / Math.sqrt(1 - e2 * sinLat * sinLat);

  const observerEcf = {
    x: (normal + height) * cosLat * cosLon,
    y: (normal + height) * cosLat * sinLon,
    z: (normal * (1 - e2) + height) * sinLat,
  };

  return {
    sinLat,
    cosLat,
    sinLon,
    cosLon,
    observerEcf,
  };
}

/**
 * Fast look angles calculation using pre-computed ground station data.
 * Avoids repeated trig calculations and ECF conversion.
 * @param {Object} precomputed - Pre-computed ground station data from precomputeGroundStationData
 * @param {Object} satelliteEcf - Satellite position in ECF {x, y, z}
 * @returns {Object} {azimuth, elevation, rangeSat}
 */
function ecfToLookAnglesFast(precomputed, satelliteEcf) {
  const { sinLat, cosLat, sinLon, cosLon, observerEcf } = precomputed;

  // Calculate range vector
  const rx = satelliteEcf.x - observerEcf.x;
  const ry = satelliteEcf.y - observerEcf.y;
  const rz = satelliteEcf.z - observerEcf.z;

  // Topocentric coordinates (South, East, Zenith)
  const topS = sinLat * cosLon * rx + sinLat * sinLon * ry - cosLat * rz;
  const topE = -sinLon * rx + cosLon * ry;
  const topZ = cosLat * cosLon * rx + cosLat * sinLon * ry + sinLat * rz;

  // Look angles
  const rangeSat = Math.sqrt(topS * topS + topE * topE + topZ * topZ);
  const elevation = Math.asin(topZ / rangeSat);
  const azimuth = Math.atan2(-topE, topS) + Math.PI;

  return { azimuth, elevation, rangeSat };
}

export default class Orbit {
  // Eclipse calculation cache - stores results keyed by time bucket
  // Time bucket size: 30 seconds (30000ms) provides good balance between cache hits and accuracy
  static ECLIPSE_CACHE_BUCKET_SIZE = 30000;
  static eclipseCache = new Map(); // key: `${satnum}_${timeBucket}`, value: boolean
  static eclipseCacheMaxSize = 10000; // Limit cache size to prevent memory bloat

  /**
   * Known standard magnitudes for satellites at 1000km range, 50% illumination.
   * Used for brightness estimation when intrinsic magnitude is not provided.
   * Sources: Heavens-Above, SeeSat-L mailing list, peer-reviewed observations.
   *
   * Keys can be:
   * - NORAD catalog number (number) for specific satellites
   * - Name pattern (string) for satellite constellations
   *
   * Values are standard magnitudes (lower = brighter)
   */
  static STANDARD_MAGNITUDES = {
    // Space stations
    25544: -1.8, // ISS - International Space Station
    48274: -0.5, // Tiangong - Chinese Space Station (CSS)

    // Famous satellites
    20580: 1.5, // Hubble Space Telescope (HST)

    // Crewed vehicles (typical when docked or free-flying)
    // Dragon, Soyuz, Progress vary significantly

    // Patterns for constellation matching (checked by name)
    STARLINK: 6.0, // Starlink average (Gen1: 5.5-6.5, VisorSat: 6.5-7.0, Gen2: 6.0-7.0)
    "STARLINK VISORSAT": 6.8, // Starlink with sun visor
    ONEWEB: 7.5, // OneWeb constellation
    IRIDIUM: 6.0, // Iridium (non-flare, flares can reach -8)
    GLOBALSTAR: 6.5, // Globalstar constellation
    GPS: 8.5, // GPS Block III (MEO orbit)
    COSMOS: 5.5, // Generic Cosmos satellites (varies widely)
    DRAGON: 2.5, // SpaceX Dragon
    PROGRESS: 3.0, // Progress cargo spacecraft
    SOYUZ: 3.0, // Soyuz crewed spacecraft
    CYGNUS: 3.5, // Northrop Grumman Cygnus
    "HTV-": 3.0, // Japanese HTV/Kounotori
    CREW: 2.5, // Crew Dragon
  };

  // Default standard magnitude when satellite is not in known list
  static DEFAULT_STANDARD_MAGNITUDE = 4.0;

  /**
   * Get the standard magnitude for a satellite based on its NORAD ID or name.
   * @param {number} satnum - NORAD catalog number
   * @param {string} name - Satellite name
   * @returns {number} Standard magnitude (intrinsic brightness)
   */
  static getStandardMagnitude(satnum, name) {
    // First check by NORAD ID (exact match)
    if (satnum && Orbit.STANDARD_MAGNITUDES[satnum] !== undefined) {
      return Orbit.STANDARD_MAGNITUDES[satnum];
    }

    // Then check by name patterns
    if (name) {
      const upperName = name.toUpperCase();
      for (const [pattern, mag] of Object.entries(Orbit.STANDARD_MAGNITUDES)) {
        // Skip numeric keys (NORAD IDs)
        if (typeof pattern === "string" && isNaN(pattern)) {
          if (upperName.includes(pattern)) {
            return mag;
          }
        }
      }
    }

    return Orbit.DEFAULT_STANDARD_MAGNITUDE;
  }

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

  /**
   * Get the TLE epoch as a JavaScript Date
   * @returns {Date} The epoch date
   */
  get epochDate() {
    // Convert Julian date to JavaScript Date
    // Julian day 2440587.5 = Unix epoch (Jan 1, 1970)
    return new Date((this.julianDate - 2440587.5) * 86400000);
  }

  /**
   * Get the age of the TLE epoch in days
   * @returns {number} Days since epoch (negative if epoch is in future)
   */
  get epochAgeDays() {
    const now = new Date();
    return (now - this.epochDate) / (86400 * 1000);
  }

  /**
   * Get the drag coefficient (ndot - first derivative of mean motion)
   * satellite.js stores ndot directly from TLE (which is ndot/2 in rev/day^2)
   * @returns {number} ndot value from satrec (TLE format: ndot/2)
   */
  get dragCoefficient() {
    return this.satrec.ndot;
  }

  /**
   * Get the B* drag term
   * @returns {number} B* in 1/earth-radii
   */
  get bstar() {
    return this.satrec.bstar;
  }

  /**
   * Check if this is a high-drag satellite (LEO with significant decay)
   * @returns {boolean} True if satellite has high drag
   */
  get isHighDrag() {
    // High drag thresholds (using TLE format values):
    // - ndot > 0.0001 (TLE format, actual ndot/2 in rev/day^2) - significant orbital decay
    // - or B* > 0.0001 (drag term in 1/earth-radii)
    // - and mean motion > 10 rev/day (LEO satellite)
    const meanMotionRevDay = (this.satrec.no * 1440) / (2 * Math.PI);
    const isLEO = meanMotionRevDay > 10;
    const hasHighNdot = Math.abs(this.dragCoefficient) > 0.0001;
    const hasHighBstar = Math.abs(this.bstar) > 0.0001;

    return isLEO && (hasHighNdot || hasHighBstar);
  }

  /**
   * Estimate when the satellite will/did decay based on drag
   * Returns estimated days until decay from epoch (can be negative if already decayed)
   * @returns {number|null} Days until decay, or null if not applicable
   */
  get estimatedDaysUntilDecay() {
    if (!this.isHighDrag) {
      return null;
    }

    // The TLE ndot value is ndot/2 in rev/day^2
    // Actual ndot = 2 * dragCoefficient
    // If actual ndot = 0.002 rev/day^2, mean motion increases by 0.002 rev/day each day
    // LEO satellite decays roughly when it gains ~1 rev/day (from ~15 to ~16+ rev/day)
    // This is a simplification; actual decay is non-linear and accelerates
    const actualNdot = Math.abs(this.dragCoefficient) * 2;
    if (actualNdot < 0.00001) {
      return null; // Too low to estimate
    }

    // Rough estimate: time to decay ≈ 1 / (ndot * factor)
    // For ndot = 0.002, decay happens in roughly 200-300 days
    // Using factor of 5 gives reasonable estimates
    return Math.min(365, 1 / (actualNdot * 5));
  }

  /**
   * Check if the TLE is likely stale (too old for reliable propagation)
   * For high-drag satellites, SGP4 produces garbage after ~2x the decay time
   * @returns {{isStale: boolean, reason: string|null, epochAgeDays: number}}
   */
  checkTLEStaleness() {
    const epochAgeDays = this.epochAgeDays;

    // If epoch is in the future, it's not stale
    if (epochAgeDays < 0) {
      return { isStale: false, reason: null, epochAgeDays };
    }

    // For high-drag satellites, check if we're past the reliable propagation window
    if (this.isHighDrag) {
      const estimatedDecay = this.estimatedDaysUntilDecay;
      if (estimatedDecay !== null) {
        // SGP4 returns null for a while after decay, then garbage
        // The garbage zone starts at roughly 3-4x the decay time
        const maxReliableDays = estimatedDecay * 3;

        if (epochAgeDays > maxReliableDays) {
          return {
            isStale: true,
            reason: `High-drag satellite with TLE ${Math.round(epochAgeDays)} days old (max reliable: ~${Math.round(maxReliableDays)} days)`,
            epochAgeDays,
            estimatedDecayDays: estimatedDecay,
          };
        }
      }

      // General rule for high-drag: warn if TLE is > 60 days old
      if (epochAgeDays > 60) {
        return {
          isStale: true,
          reason: `High-drag LEO satellite with TLE ${Math.round(epochAgeDays)} days old`,
          epochAgeDays,
        };
      }
    }

    // For all satellites, TLEs > 365 days are considered stale
    if (epochAgeDays > 365) {
      return {
        isStale: true,
        reason: `TLE is ${Math.round(epochAgeDays)} days old (>1 year)`,
        epochAgeDays,
      };
    }

    return { isStale: false, reason: null, epochAgeDays };
  }

  /**
   * Validate a propagated position to check for SGP4 garbage results
   * @param {Object} position - Position object with x, y, z in km
   * @returns {boolean} True if position appears valid
   */
  validatePosition(position) {
    if (!position || typeof position.x !== "number" || typeof position.y !== "number" || typeof position.z !== "number") {
      return false;
    }

    // Check for NaN values
    if (Number.isNaN(position.x) || Number.isNaN(position.y) || Number.isNaN(position.z)) {
      return false;
    }

    const magnitude = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);
    const altitude = magnitude - 6378; // Earth radius in km

    // Sanity checks for position validity
    // - Altitude should be between -100 km (slight underground is ok for edge cases) and 100,000 km
    // - For LEO satellites (mean motion > 10 rev/day), max altitude should be ~3000 km
    const meanMotionRevDay = (this.satrec.no * 1440) / (2 * Math.PI);
    const isLEO = meanMotionRevDay > 10;

    if (altitude < -100) {
      return false; // Underground
    }

    if (isLEO && altitude > 5000) {
      // LEO satellite shouldn't be above 5000 km
      return false;
    }

    if (altitude > 1000000) {
      // Nothing should be above 1,000,000 km (FALCON 9 R/B 2015-007B at 641287 km apogee)
      return false;
    }

    return true;
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

    // Pre-compute ground station data for fast look angles calculation
    const gsPrecomputed = precomputeGroundStationData(groundStation);

    // Initialize tracking variables - use numeric timestamps for efficiency
    let timestamp = effectiveStartDate.getTime();
    const endTime = endDate.getTime();
    const passes = [];
    let pass = false;
    let ongoingPass = false;
    let lastElevation = 0;

    // Pre-compute time step constants in milliseconds
    const MS_PER_SEC = 1000;
    const MS_PER_MIN = 60000;
    const halfOrbitMs = this.orbitalPeriod * 0.5 * MS_PER_MIN;

    // Main calculation loop - step through time until end date
    while (timestamp < endTime) {
      // Create Date object only when needed for position calculation
      const date = new Date(timestamp);

      // Calculate satellite position and look angles from ground station
      const positionEcf = this.positionECF(date);

      if (!positionEcf) {
        timestamp += MS_PER_MIN;
        continue;
      }

      const lookAngles = ecfToLookAnglesFast(gsPrecomputed, positionEcf);
      const elevation = lookAngles.elevation / deg2rad; // Convert to degrees

      if (elevation > minElevation) {
        // Satellite is visible above minimum elevation threshold
        if (!ongoingPass) {
          // Start of new pass - record initial conditions
          const isDarkAtStart = GroundStationConditions.isInDarkness(originalGroundStation, date);
          const isEclipsedAtStart = this.isInEclipse(date);

          pass = {
            start: timestamp,
            azimuthStart: lookAngles.azimuth,
            maxElevation: elevation,
            azimuthApex: lookAngles.azimuth,
            groundStationDarkAtStart: isDarkAtStart,
            satelliteEclipsedAtStart: isEclipsedAtStart,
            name: this.name,
          };
          ongoingPass = true;
        } else if (elevation > pass.maxElevation) {
          // Update peak conditions during ongoing pass
          pass.maxElevation = elevation;
          pass.apex = timestamp;
          pass.azimuthApex = lookAngles.azimuth;
        }
        // Small time step during visible pass for accuracy
        timestamp += 5 * MS_PER_SEC;
      } else if (ongoingPass) {
        // End of pass - finalize pass data and add to results
        pass.end = timestamp;
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
        timestamp += halfOrbitMs;
      } else {
        // Satellite not visible - use adaptive time stepping for efficiency
        const deltaElevation = elevation - lastElevation;
        lastElevation = elevation;

        if (deltaElevation < 0) {
          // Satellite moving away from horizon - skip ahead half orbit
          timestamp += halfOrbitMs;
          lastElevation = -180;
        } else if (elevation < -20) {
          // Very far below horizon - large time steps
          timestamp += 5 * MS_PER_MIN;
        } else if (elevation < -5) {
          // Moderately below horizon - medium time steps
          timestamp += MS_PER_MIN;
        } else if (elevation < -1) {
          // Close to horizon - smaller time steps
          timestamp += 5 * MS_PER_SEC;
        } else {
          // Very close to horizon - finest time steps for accuracy
          timestamp += 2 * MS_PER_SEC;
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

    // Pre-compute ground station trig values for great circle distance
    const cosGsLat = Math.cos(groundStation.latitude);

    // Initialize tracking variables - use numeric timestamps for efficiency
    let timestamp = effectiveStartDate.getTime();
    const endTime = endDate.getTime();
    const passes = [];
    let pass = false;
    let ongoingPass = false;
    let lastDistance = Number.MAX_VALUE;

    // Pre-compute time step constants in milliseconds
    const MS_PER_SEC = 1000;
    const MS_PER_MIN = 60000;
    const halfSwath = swathKm / 2;

    while (timestamp < endTime) {
      // Create Date object only when needed for position calculation
      const date = new Date(timestamp);

      const positionGeodetic = this.positionGeodetic(date);

      if (!positionGeodetic) {
        timestamp += MS_PER_MIN;
        continue;
      }

      // Convert satellite position to radians for calculations
      const satLat = positionGeodetic.latitude * deg2rad;
      const satLon = positionGeodetic.longitude * deg2rad;

      // Calculate great circle distance between satellite and ground station
      const deltaLat = satLat - groundStation.latitude;
      const deltaLon = satLon - groundStation.longitude;
      const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) + cosGsLat * Math.cos(satLat) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const earthRadius = 6371; // Earth radius in km
      const distanceKm = earthRadius * c;

      // Check if ground station is within swath
      const withinSwath = distanceKm <= halfSwath;

      if (withinSwath) {
        if (!ongoingPass) {
          // Start of new pass - record initial conditions
          const isDarkAtStart = GroundStationConditions.isInDarkness(originalGroundStation, date);
          const isEclipsedAtStart = this.isInEclipse(date);

          pass = {
            name: this.name,
            start: timestamp,
            minDistance: distanceKm,
            minDistanceTime: timestamp,
            swathWidth: swathKm,
            groundStationDarkAtStart: isDarkAtStart,
            satelliteEclipsedAtStart: isEclipsedAtStart,
            // Add placeholder values for card rendering compatibility
            maxElevation: 0, // Not applicable for swath mode
            azimuthApex: 0, // Not applicable for swath mode
          };
          ongoingPass = true;
        } else if (distanceKm < pass.minDistance) {
          // Update minimum distance (closest approach)
          pass.minDistance = distanceKm;
          pass.minDistanceTime = timestamp;
        }
        timestamp += 30 * MS_PER_SEC; // 30 second steps during pass
      } else if (ongoingPass) {
        // End of pass - finalize pass data
        pass.end = timestamp;
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
        timestamp += Math.max(5, this.orbitalPeriod * 0.1) * MS_PER_MIN;
      } else {
        // Not in pass, adjust time step based on distance and previous distance
        const deltaDistance = distanceKm - lastDistance;
        lastDistance = distanceKm;

        if (deltaDistance > 0 && distanceKm > halfSwath * 4) {
          // Moving away and far from swath, skip ahead more
          timestamp += Math.max(10, this.orbitalPeriod * 0.2) * MS_PER_MIN;
        } else if (distanceKm > halfSwath * 3) {
          // Far from swath
          timestamp += 5 * MS_PER_MIN;
        } else if (distanceKm > halfSwath * 2) {
          // Moderately far from swath
          timestamp += 2 * MS_PER_MIN;
        } else if (distanceKm > halfSwath * 1.2) {
          // Getting closer to swath
          timestamp += MS_PER_MIN;
        } else {
          // Very close to swath threshold, use fine time steps
          timestamp += 15 * MS_PER_SEC;
        }
      }
    }

    return passes;
  }

  /**
   * Get Sun position in ECI coordinates (km)
   * Sun moves slowly (~1 degree per hour), so this can be cached for short durations
   * @param {number} timestamp - Time in milliseconds
   * @returns {Object} Sun position {x, y, z} in km
   */
  static getSunPositionECI(timestamp) {
    const date = new Date(timestamp);
    const astroTime = new Astronomy.AstroTime(date);
    const sunGeoVector = Astronomy.GeoVector(Astronomy.Body.Sun, astroTime, false);

    const auToKm = 149597870.7;
    return {
      x: sunGeoVector.x * auToKm,
      y: sunGeoVector.y * auToKm,
      z: sunGeoVector.z * auToKm,
    };
  }

  /**
   * Fast eclipse check using pre-computed sun position
   * Avoids repeated astronomy-engine calls within a pass
   * @param {number} timestamp - Time in milliseconds
   * @param {Object} sunPos - Pre-computed sun position {x, y, z} in km
   * @returns {boolean} True if satellite is in Earth's shadow
   */
  isInEclipseFast(timestamp, sunPos) {
    try {
      const date = new Date(timestamp);
      const satEcf = this.positionECF(date);
      if (!satEcf) return false;

      const gmst = satellitejs.gstime(date);
      const satEci = satellitejs.ecfToEci(satEcf, gmst);

      const satPos = { x: satEci.x, y: satEci.y, z: satEci.z };
      return this.calculateEarthShadow(satPos, sunPos, 6378.137);
    } catch {
      return false;
    }
  }

  /**
   * Determines if satellite is in Earth's shadow (eclipsed)
   * @param {Date} date - Time to check eclipse status
   * @returns {boolean} True if satellite is in Earth's shadow
   */
  isInEclipse(date) {
    // Round timestamp to nearest bucket for caching
    const timestamp = date.getTime();
    const timeBucket = Math.floor(timestamp / Orbit.ECLIPSE_CACHE_BUCKET_SIZE) * Orbit.ECLIPSE_CACHE_BUCKET_SIZE;
    const cacheKey = `${this.satnum}_${timeBucket}`;

    // Check cache first
    if (Orbit.eclipseCache.has(cacheKey)) {
      return Orbit.eclipseCache.get(cacheKey);
    }

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

      // Get Sun's position
      const sunPos = Orbit.getSunPositionECI(timestamp);

      // Earth radius in km
      const earthRadius = 6378.137;

      // Calculate if satellite is in Earth's shadow
      const result = this.calculateEarthShadow(satPos, sunPos, earthRadius);

      // Store in cache, evicting old entries if cache is too large
      if (Orbit.eclipseCache.size >= Orbit.eclipseCacheMaxSize) {
        // Remove oldest entry (first key in the Map)
        const firstKey = Orbit.eclipseCache.keys().next().value;
        Orbit.eclipseCache.delete(firstKey);
      }
      Orbit.eclipseCache.set(cacheKey, result);

      return result;
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
   * Find eclipse transition times during a satellite pass using binary search
   * Optimized: Uses cached sun position and binary search for fast detection
   * @param {number} startTime - Pass start time in milliseconds
   * @param {number} endTime - Pass end time in milliseconds
   * @param {number} precision - Precision in seconds for transition time (default 5s)
   * @returns {Array} Array of transition times {time, fromShadow: boolean}
   */
  findEclipseTransitions(startTime, endTime, precision = 5) {
    const transitions = [];
    const duration = endTime - startTime;

    // Cache sun position at midpoint of pass - sun moves <0.01 degrees during a typical 15-min pass
    const midTime = Math.floor((startTime + endTime) / 2);
    const sunPos = Orbit.getSunPositionECI(midTime);

    // For very short passes, just check start and end
    if (duration < 30000) {
      // < 30 seconds
      const startEclipse = this.isInEclipseFast(startTime, sunPos);
      const endEclipse = this.isInEclipseFast(endTime, sunPos);
      if (startEclipse !== endEclipse) {
        const transitionTime = this.binarySearchEclipseTransitionFast(startTime, endTime, precision * 1000, sunPos);
        transitions.push({
          time: transitionTime,
          fromShadow: startEclipse,
          toShadow: endEclipse,
        });
      }
      return transitions;
    }

    // Use coarse sampling to detect potential transitions
    // For typical LEO passes (5-15 min), use ~1-2 minute steps for initial scan
    const coarseStep = Math.min(120000, duration / 4); // Max 2 min, or duration/4
    const samplePoints = [];

    // Sample at coarse intervals using fast eclipse check
    for (let t = startTime; t <= endTime; t += coarseStep) {
      samplePoints.push({
        time: t,
        inEclipse: this.isInEclipseFast(t, sunPos),
      });
    }
    // Ensure we include the end point
    if (samplePoints[samplePoints.length - 1].time < endTime) {
      samplePoints.push({
        time: endTime,
        inEclipse: this.isInEclipseFast(endTime, sunPos),
      });
    }

    // Find transitions between sample points using binary search
    for (let i = 0; i < samplePoints.length - 1; i++) {
      const current = samplePoints[i];
      const next = samplePoints[i + 1];

      if (current.inEclipse !== next.inEclipse) {
        const transitionTime = this.binarySearchEclipseTransitionFast(current.time, next.time, precision * 1000, sunPos);
        transitions.push({
          time: transitionTime,
          fromShadow: current.inEclipse,
          toShadow: next.inEclipse,
        });
      }
    }

    return transitions;
  }

  /**
   * Binary search to find the exact eclipse transition time (fast version with cached sun)
   * @param {number} startTime - Start of search range (ms)
   * @param {number} endTime - End of search range (ms)
   * @param {number} precision - Desired precision in milliseconds
   * @param {Object} sunPos - Pre-computed sun position
   * @returns {number} Transition time in milliseconds
   */
  binarySearchEclipseTransitionFast(startTime, endTime, precision, sunPos) {
    let low = startTime;
    let high = endTime;
    const startEclipse = this.isInEclipseFast(low, sunPos);

    while (high - low > precision) {
      const midTime = Math.floor((low + high) / 2);
      const midEclipse = this.isInEclipseFast(midTime, sunPos);

      if (midEclipse === startEclipse) {
        low = midTime;
      } else {
        high = midTime;
      }
    }

    return Math.floor((low + high) / 2);
  }

  // ============================================================================
  // Satellite Brightness Estimation
  // ============================================================================

  /**
   * Convert observer geodetic position to ECI coordinates
   * @param {Object} observerGeodetic - {latitude, longitude, height} in radians and km
   * @param {Date} date - Time for coordinate conversion
   * @returns {Object} Observer position {x, y, z} in km (ECI frame)
   */
  static getObserverECI(observerGeodetic, date) {
    // Convert geodetic to ECF
    const observerEcf = satellitejs.geodeticToEcf(observerGeodetic);

    // Convert ECF to ECI
    const gmst = satellitejs.gstime(date);
    const observerEci = satellitejs.ecfToEci(observerEcf, gmst);

    return {
      x: observerEci.x,
      y: observerEci.y,
      z: observerEci.z,
    };
  }

  /**
   * Calculate the phase angle between Sun-Satellite-Observer
   * The phase angle determines how much of the satellite's illuminated side is visible
   * @param {Object} satEci - Satellite position {x, y, z} in km (ECI frame)
   * @param {Object} observerEci - Observer position {x, y, z} in km (ECI frame)
   * @param {Object} sunEci - Sun position {x, y, z} in km (ECI frame)
   * @returns {number} Phase angle in radians (0 = fully lit, π = fully shadowed)
   */
  static calculatePhaseAngle(satEci, observerEci, sunEci) {
    // Vector from satellite to sun
    const satToSun = {
      x: sunEci.x - satEci.x,
      y: sunEci.y - satEci.y,
      z: sunEci.z - satEci.z,
    };

    // Vector from satellite to observer
    const satToObs = {
      x: observerEci.x - satEci.x,
      y: observerEci.y - satEci.y,
      z: observerEci.z - satEci.z,
    };

    // Calculate magnitudes
    const magSatToSun = Math.sqrt(satToSun.x * satToSun.x + satToSun.y * satToSun.y + satToSun.z * satToSun.z);
    const magSatToObs = Math.sqrt(satToObs.x * satToObs.x + satToObs.y * satToObs.y + satToObs.z * satToObs.z);

    // Dot product
    const dotProduct = satToSun.x * satToObs.x + satToSun.y * satToObs.y + satToSun.z * satToObs.z;

    // Calculate phase angle (angle between sun-satellite and observer-satellite vectors)
    const cosPhase = dotProduct / (magSatToSun * magSatToObs);

    // Clamp to [-1, 1] to handle floating point errors
    return Math.acos(Math.max(-1, Math.min(1, cosPhase)));
  }

  /**
   * Calculate distance from observer to satellite
   * @param {Object} satEci - Satellite position {x, y, z} in km
   * @param {Object} observerEci - Observer position {x, y, z} in km
   * @returns {number} Range in km
   */
  static calculateRange(satEci, observerEci) {
    const dx = satEci.x - observerEci.x;
    const dy = satEci.y - observerEci.y;
    const dz = satEci.z - observerEci.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Calculate the phase function for diffuse reflection (Lambertian sphere approximation)
   * This models how brightness varies with phase angle
   * @param {number} phaseAngle - Phase angle in radians
   * @returns {number} Phase function value (0-1, where 1 is fully lit)
   */
  static phaseFunction(phaseAngle) {
    // Lambertian sphere phase function: (sin(β) + (π-β)*cos(β)) / π
    // This gives the fraction of reflected light visible at phase angle β
    const beta = phaseAngle;
    return (Math.sin(beta) + (Math.PI - beta) * Math.cos(beta)) / Math.PI;
  }

  /**
   * Estimate visual magnitude of satellite as seen from a ground station
   *
   * Uses the standard satellite magnitude formula:
   * m = m_std - 15 + 5*log10(range) - 2.5*log10(phaseFunction(β))
   *
   * Where:
   * - m_std is the intrinsic magnitude (standard magnitude at 1000km, 90° phase)
   * - range is distance from observer in km
   * - β is the phase angle (sun-satellite-observer angle)
   *
   * Typical intrinsic magnitudes:
   * - ISS: -1.8 (very bright, large)
   * - Starlink (visor-equipped): 5.5-6.5 (dim)
   * - Typical satellite: 2-4
   * - Small cubesat: 6-8
   *
   * @param {Date} date - Time for calculation
   * @param {Object} observerGeodetic - Ground station {latitude, longitude, height} in radians and km
   * @param {number|null} intrinsicMag - Intrinsic magnitude. If null/undefined, looks up from STANDARD_MAGNITUDES
   * @returns {Object|null} Brightness data or null if satellite not visible
   *   - magnitude: Visual magnitude (lower = brighter, negative = very bright)
   *   - range: Distance from observer in km
   *   - phaseAngle: Phase angle in degrees
   *   - isInShadow: Whether satellite is in Earth's shadow
   *   - phaseFunction: Phase function value (0-1)
   *   - standardMag: The standard magnitude used for calculation
   */
  estimateVisualMagnitude(date, observerGeodetic, intrinsicMag = null) {
    // Look up standard magnitude if not provided
    const stdMag = intrinsicMag ?? Orbit.getStandardMagnitude(this.satnum, this.name);
    try {
      // Get satellite position in ECI
      const satEcf = this.positionECF(date);
      if (!satEcf) return null;

      const gmst = satellitejs.gstime(date);
      const satEci = satellitejs.ecfToEci(satEcf, gmst);

      // Get observer position in ECI
      const observerEci = Orbit.getObserverECI(observerGeodetic, date);

      // Get sun position in ECI
      const sunEci = Orbit.getSunPositionECI(date.getTime());

      // Check if satellite is in Earth's shadow
      const isInShadow = this.isInEclipse(date);

      // Calculate range from observer to satellite
      const range = Orbit.calculateRange(satEci, observerEci);

      // Calculate phase angle
      const phaseAngle = Orbit.calculatePhaseAngle(satEci, observerEci, sunEci);
      const phaseAngleDeg = phaseAngle * rad2deg;

      // Calculate phase function
      const phaseFn = Orbit.phaseFunction(phaseAngle);

      // If in shadow, satellite is not illuminated (effectively infinite magnitude)
      if (isInShadow) {
        return {
          magnitude: Infinity,
          range,
          phaseAngle: phaseAngleDeg,
          isInShadow: true,
          phaseFunction: phaseFn,
          standardMag: stdMag,
        };
      }

      // Calculate visual magnitude using standard formula
      // m = m_std - 15 + 5*log10(range) - 2.5*log10(phaseFunction)
      // The -15 term normalizes for 1000km standard distance (5*log10(1000) = 15)
      let magnitude;
      if (phaseFn > 0) {
        magnitude = stdMag - 15 + 5 * Math.log10(range) - 2.5 * Math.log10(phaseFn);
      } else {
        // Phase function is 0 at phase angle = π (satellite between observer and sun)
        magnitude = Infinity;
      }

      return {
        magnitude,
        range,
        phaseAngle: phaseAngleDeg,
        isInShadow: false,
        phaseFunction: phaseFn,
        standardMag: stdMag,
      };
    } catch (error) {
      console.warn("Failed to estimate visual magnitude:", error);
      return null;
    }
  }

  /**
   * Estimate peak brightness during a pass
   * Finds the minimum magnitude (brightest point) during a pass
   * @param {Object} pass - Pass object with start, end, maxElevation times
   * @param {Object} observerGeodetic - Ground station position
   * @param {number|null} intrinsicMag - Intrinsic magnitude. If null, uses STANDARD_MAGNITUDES lookup
   * @param {number} samples - Number of samples to check (default 10)
   * @returns {Object|null} Peak brightness data with time, or null if not calculable
   */
  estimatePeakBrightness(pass, observerGeodetic, intrinsicMag = null, samples = 10) {
    if (!pass || !pass.start || !pass.end) return null;

    // Handle both Date objects and timestamps (numbers)
    const startTime = typeof pass.start === "number" ? pass.start : pass.start.getTime();
    const endTime = typeof pass.end === "number" ? pass.end : pass.end.getTime();
    const step = (endTime - startTime) / samples;

    let peakData = null;
    let peakTime = null;

    for (let t = startTime; t <= endTime; t += step) {
      const date = new Date(t);
      const brightness = this.estimateVisualMagnitude(date, observerGeodetic, intrinsicMag);

      if (brightness && !brightness.isInShadow) {
        if (!peakData || brightness.magnitude < peakData.magnitude) {
          peakData = brightness;
          peakTime = date;
        }
      }
    }

    if (peakData && peakTime) {
      return {
        ...peakData,
        time: peakTime,
      };
    }

    return null;
  }
}
