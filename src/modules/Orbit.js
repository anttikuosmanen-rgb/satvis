import * as satellitejs from "satellite.js";
import dayjs from "dayjs";
import * as SunCalc from "../../suncalc/suncalc.js";

const deg2rad = Math.PI / 180;
const rad2deg = 180 / Math.PI;

// Helper function to determine if ground station is in darkness
function isGroundStationInDarkness(groundStationPosition, time) {
  const sunPosition = SunCalc.getPosition(time, groundStationPosition.latitude, groundStationPosition.longitude);
  // Sun altitude below -6 degrees indicates civil twilight (darkness for visual observation)
  return sunPosition.altitude < (-6 * deg2rad);
}

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

  computePassesElevation(
    groundStationPosition,
    startDate = dayjs().toDate(),
    endDate = dayjs(startDate).add(7, "day").toDate(),
    minElevation = 5,
    maxPasses = 50,
  ) {
    // Keep original position for sun calculations (degrees)
    const originalGroundStation = { ...groundStationPosition };

    // Convert ground station position to radians and proper units for satellite.js
    const groundStation = { ...groundStationPosition };
    groundStation.latitude *= deg2rad;
    groundStation.longitude *= deg2rad;
    groundStation.height /= 1000; // Convert meters to kilometers

    // Initialize tracking variables
    const date = new Date(startDate);
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
            name: this.name,
            start: date.getTime(),
            azimuthStart: lookAngles.azimuth,
            maxElevation: elevation,
            azimuthApex: lookAngles.azimuth,
            groundStationDarkAtStart: isGroundStationInDarkness(originalGroundStation, date),
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
        pass.groundStationDarkAtEnd = isGroundStationInDarkness(originalGroundStation, date);
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

  computePassesSwath(groundStationPosition, swathKm, startDate = dayjs().toDate(), endDate = dayjs(startDate).add(7, "day").toDate(), maxPasses = 50) {
    const groundStation = { ...groundStationPosition };
    groundStation.latitude *= deg2rad;
    groundStation.longitude *= deg2rad;
    groundStation.height /= 1000;

    const date = new Date(startDate);
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
          // Start of new pass
          pass = {
            name: this.name,
            start: date.getTime(),
            minDistance: distanceKm,
            minDistanceTime: date.getTime(),
            swathWidth: swathKm,
          };
          ongoingPass = true;
        } else if (distanceKm < pass.minDistance) {
          // Update minimum distance (closest approach)
          pass.minDistance = distanceKm;
          pass.minDistanceTime = date.getTime();
        }
        date.setSeconds(date.getSeconds() + 30); // 30 second steps during pass
      } else if (ongoingPass) {
        // End of pass
        pass.end = date.getTime();
        pass.duration = pass.end - pass.start;
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

        if (deltaDistance > 0 && distanceKm > halfSwath * 3) {
          // Moving away and far from swath, skip ahead more
          date.setMinutes(date.getMinutes() + Math.max(10, this.orbitalPeriod * 0.2));
        } else if (distanceKm > halfSwath * 2) {
          // Moderately far from swath
          date.setMinutes(date.getMinutes() + 5);
        } else {
          // Getting closer to swath, use smaller time steps
          date.setMinutes(date.getMinutes() + 1);
        }
      }
    }

    return passes;
  }
}
