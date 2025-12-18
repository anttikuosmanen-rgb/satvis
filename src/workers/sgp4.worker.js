import * as satellitejs from "satellite.js";

const deg2rad = Math.PI / 180;
const rad2deg = 180 / Math.PI;

/**
 * WebWorker for SGP4 satellite propagation calculations
 * Offloads expensive orbital mechanics calculations from the main thread
 */

// Cache for satellite records to avoid repeated TLE parsing
const satrecCache = new Map();

/**
 * Get or create a satellite record from TLE
 */
function getSatrec(tle) {
  const cacheKey = tle[1] + tle[2];
  if (satrecCache.has(cacheKey)) {
    return satrecCache.get(cacheKey);
  }
  const satrec = satellitejs.twoline2satrec(tle[1], tle[2]);
  satrecCache.set(cacheKey, satrec);
  return satrec;
}

/**
 * Propagate satellite positions for multiple time stamps
 */
function propagatePositions(tle, timestamps) {
  const satrec = getSatrec(tle);
  const results = [];

  for (const timestamp of timestamps) {
    const date = new Date(timestamp);
    const positionEci = satellitejs.propagate(satrec, date);

    if (positionEci && positionEci.position) {
      const gmst = satellitejs.gstime(date);
      const positionEcf = satellitejs.eciToEcf(positionEci.position, gmst);

      results.push({
        timestamp,
        eci: {
          x: positionEci.position.x * 1000, // Convert km to meters
          y: positionEci.position.y * 1000,
          z: positionEci.position.z * 1000,
        },
        ecf: {
          x: positionEcf.x * 1000,
          y: positionEcf.y * 1000,
          z: positionEcf.z * 1000,
        },
      });
    } else {
      results.push({
        timestamp,
        error: true,
      });
    }
  }

  return results;
}

/**
 * Calculate geodetic position (lat/lon/alt) for a timestamp
 */
function propagateGeodetic(tle, timestamp) {
  const satrec = getSatrec(tle);
  const date = new Date(timestamp);
  const result = satellitejs.propagate(satrec, date);

  if (!result || !result.position) {
    return null;
  }

  const gmst = satellitejs.gstime(date);
  const positionGd = satellitejs.eciToGeodetic(result.position, gmst);

  return {
    timestamp,
    longitude: positionGd.longitude * rad2deg,
    latitude: positionGd.latitude * rad2deg,
    height: positionGd.height * 1000, // Convert km to meters
  };
}

/**
 * Calculate satellite passes over a ground station using elevation angle
 */
function computePassesElevation(tle, groundStationPosition, startDateMs, endDateMs, minElevation = 5, maxPasses = 50, collectStats = false) {
  // Performance instrumentation
  const stats = collectStats
    ? {
        totalTime: 0,
        propagationTime: 0,
        propagationCalls: 0,
        coordConversionTime: 0,
        lookAnglesTime: 0,
        iterations: 0,
        passesFound: 0,
      }
    : null;
  const totalStart = collectStats ? performance.now() : 0;

  const satrec = getSatrec(tle);

  // Get orbital period
  const meanMotionRad = satrec.no;
  const orbitalPeriod = (2 * Math.PI) / meanMotionRad;

  // Skip pass calculation for satellites with very long orbital periods
  if (orbitalPeriod > 600) {
    return collectStats ? { passes: [], stats } : [];
  }

  // For satellites with future epochs, ensure we don't calculate before epoch
  const epochDate = new Date((satrec.jdsatepoch - 2440587.5) * 86400000);
  const epochMinus1Hour = new Date(epochDate.getTime() - 3600000);
  const effectiveStartDate = new Date(Math.max(startDateMs, epochMinus1Hour.getTime()));

  // Convert ground station position to radians
  const groundStation = {
    latitude: groundStationPosition.latitude * deg2rad,
    longitude: groundStationPosition.longitude * deg2rad,
    height: groundStationPosition.height / 1000, // Convert meters to km
  };

  const date = new Date(effectiveStartDate);
  const endDate = new Date(endDateMs);
  const passes = [];
  let ongoingPass = false;
  let pass = null;
  let lastElevation = 0;

  while (date < endDate) {
    if (collectStats) stats.iterations++;

    // Propagate satellite position
    let propStart;
    if (collectStats) propStart = performance.now();
    const positionResult = satellitejs.propagate(satrec, date);
    if (collectStats) {
      stats.propagationTime += performance.now() - propStart;
      stats.propagationCalls++;
    }

    if (!positionResult || !positionResult.position) {
      date.setMinutes(date.getMinutes() + 1);
      continue;
    }

    let convStart;
    if (collectStats) convStart = performance.now();
    const gmst = satellitejs.gstime(date);
    const positionEcf = satellitejs.eciToEcf(positionResult.position, gmst);
    if (collectStats) stats.coordConversionTime += performance.now() - convStart;

    let lookStart;
    if (collectStats) lookStart = performance.now();
    const lookAngles = satellitejs.ecfToLookAngles(groundStation, positionEcf);
    if (collectStats) stats.lookAnglesTime += performance.now() - lookStart;

    const elevation = lookAngles.elevation / deg2rad;

    if (elevation > minElevation) {
      if (!ongoingPass) {
        // Start of new pass
        pass = {
          start: date.getTime(),
          azimuthStart: lookAngles.azimuth,
          maxElevation: elevation,
          azimuthApex: lookAngles.azimuth,
        };
        ongoingPass = true;
      } else if (elevation > pass.maxElevation) {
        // Update peak conditions
        pass.maxElevation = elevation;
        pass.apex = date.getTime();
        pass.azimuthApex = lookAngles.azimuth;
      }
      date.setSeconds(date.getSeconds() + 5);
    } else if (ongoingPass) {
      // End of pass
      pass.end = date.getTime();
      pass.duration = pass.end - pass.start;
      pass.azimuthEnd = lookAngles.azimuth;

      // Convert azimuths to degrees
      pass.azimuthStart /= deg2rad;
      pass.azimuthApex /= deg2rad;
      pass.azimuthEnd /= deg2rad;

      passes.push(pass);

      if (passes.length >= maxPasses) {
        break;
      }

      ongoingPass = false;
      lastElevation = -180;
      date.setMinutes(date.getMinutes() + orbitalPeriod * 0.5);
    } else {
      // Adaptive time stepping
      const deltaElevation = elevation - lastElevation;
      lastElevation = elevation;

      if (deltaElevation < 0) {
        date.setMinutes(date.getMinutes() + orbitalPeriod * 0.5);
        lastElevation = -180;
      } else if (elevation < -20) {
        date.setMinutes(date.getMinutes() + 5);
      } else if (elevation < -5) {
        date.setMinutes(date.getMinutes() + 1);
      } else if (elevation < -1) {
        date.setSeconds(date.getSeconds() + 5);
      } else {
        date.setSeconds(date.getSeconds() + 2);
      }
    }
  }

  if (collectStats) {
    stats.totalTime = performance.now() - totalStart;
    stats.passesFound = passes.length;
    return { passes, stats };
  }

  return passes;
}

/**
 * Calculate satellite passes over a ground station using swath width
 */
function computePassesSwath(tle, groundStationPosition, swathKm, startDateMs, endDateMs, maxPasses = 50, collectStats = false) {
  // Performance instrumentation
  const stats = collectStats
    ? {
        totalTime: 0,
        propagationTime: 0,
        propagationCalls: 0,
        coordConversionTime: 0,
        distanceCalcTime: 0,
        iterations: 0,
        passesFound: 0,
      }
    : null;
  const totalStart = collectStats ? performance.now() : 0;

  const satrec = getSatrec(tle);

  // For satellites with future epochs
  const epochDate = new Date((satrec.jdsatepoch - 2440587.5) * 86400000);
  const epochMinus1Hour = new Date(epochDate.getTime() - 3600000);
  const effectiveStartDate = new Date(Math.max(startDateMs, epochMinus1Hour.getTime()));

  const groundStation = {
    latitude: groundStationPosition.latitude * deg2rad,
    longitude: groundStationPosition.longitude * deg2rad,
    height: groundStationPosition.height / 1000,
  };

  const date = new Date(effectiveStartDate);
  const endDate = new Date(endDateMs);
  const passes = [];
  let ongoingPass = false;
  let pass = null;
  let lastDistance = Number.MAX_VALUE;

  // Get orbital period
  const meanMotionRad = satrec.no;
  const orbitalPeriod = (2 * Math.PI) / meanMotionRad;

  while (date < endDate) {
    if (collectStats) stats.iterations++;

    let propStart;
    if (collectStats) propStart = performance.now();
    const positionResult = satellitejs.propagate(satrec, date);
    if (collectStats) {
      stats.propagationTime += performance.now() - propStart;
      stats.propagationCalls++;
    }

    if (!positionResult || !positionResult.position) {
      date.setMinutes(date.getMinutes() + 1);
      continue;
    }

    let convStart;
    if (collectStats) convStart = performance.now();
    const gmst = satellitejs.gstime(date);
    const positionGd = satellitejs.eciToGeodetic(positionResult.position, gmst);
    if (collectStats) stats.coordConversionTime += performance.now() - convStart;

    const satLat = positionGd.latitude;
    const satLon = positionGd.longitude;

    // Calculate great circle distance
    let distStart;
    if (collectStats) distStart = performance.now();
    const deltaLat = satLat - groundStation.latitude;
    const deltaLon = satLon - groundStation.longitude;
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) + Math.cos(groundStation.latitude) * Math.cos(satLat) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const earthRadius = 6371;
    const distanceKm = earthRadius * c;
    if (collectStats) stats.distanceCalcTime += performance.now() - distStart;

    const halfSwath = swathKm / 2;
    const withinSwath = distanceKm <= halfSwath;

    if (withinSwath) {
      if (!ongoingPass) {
        pass = {
          start: date.getTime(),
          minDistance: distanceKm,
          minDistanceTime: date.getTime(),
          swathWidth: swathKm,
          maxElevation: 0,
          azimuthApex: 0,
        };
        ongoingPass = true;
      } else if (distanceKm < pass.minDistance) {
        pass.minDistance = distanceKm;
        pass.minDistanceTime = date.getTime();
      }
      date.setSeconds(date.getSeconds() + 30);
    } else if (ongoingPass) {
      pass.end = date.getTime();
      pass.duration = pass.end - pass.start;
      passes.push(pass);

      if (passes.length >= maxPasses) {
        break;
      }

      ongoingPass = false;
      lastDistance = Number.MAX_VALUE;
      date.setMinutes(date.getMinutes() + Math.max(5, orbitalPeriod * 0.1));
    } else {
      const deltaDistance = distanceKm - lastDistance;
      lastDistance = distanceKm;

      if (deltaDistance > 0 && distanceKm > halfSwath * 4) {
        date.setMinutes(date.getMinutes() + Math.max(10, orbitalPeriod * 0.2));
      } else if (distanceKm > halfSwath * 3) {
        date.setMinutes(date.getMinutes() + 5);
      } else if (distanceKm > halfSwath * 2) {
        date.setMinutes(date.getMinutes() + 2);
      } else if (distanceKm > halfSwath * 1.2) {
        date.setMinutes(date.getMinutes() + 1);
      } else {
        date.setSeconds(date.getSeconds() + 15);
      }
    }
  }

  if (collectStats) {
    stats.totalTime = performance.now() - totalStart;
    stats.passesFound = passes.length;
    return { passes, stats };
  }

  return passes;
}

// Message handler
self.onmessage = function (event) {
  const { id, type, data } = event.data;

  try {
    let result;

    switch (type) {
      case "PROPAGATE_POSITIONS":
        result = propagatePositions(data.tle, data.timestamps);
        break;

      case "PROPAGATE_GEODETIC":
        result = propagateGeodetic(data.tle, data.timestamp);
        break;

      case "COMPUTE_PASSES_ELEVATION":
        result = computePassesElevation(data.tle, data.groundStationPosition, data.startDateMs, data.endDateMs, data.minElevation, data.maxPasses, data.collectStats);
        break;

      case "COMPUTE_PASSES_SWATH":
        result = computePassesSwath(data.tle, data.groundStationPosition, data.swathKm, data.startDateMs, data.endDateMs, data.maxPasses, data.collectStats);
        break;

      case "CLEAR_CACHE":
        satrecCache.clear();
        result = { cleared: satrecCache.size === 0 };
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({
      id,
      type,
      result,
      success: true,
    });
  } catch (error) {
    self.postMessage({
      id,
      type,
      error: error.message,
      success: false,
    });
  }
};
