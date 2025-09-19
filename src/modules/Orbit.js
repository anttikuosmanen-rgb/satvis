import * as satellitejs from "satellite.js";
import dayjs from "dayjs";
import { GroundStationConditions } from "./util/GroundStationConditions.js";
import * as Astronomy from "astronomy-engine";

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
        velocity: Math.sqrt(velocityVector.x * velocityVector.x +
          velocityVector.y * velocityVector.y +
          velocityVector.z * velocityVector.z),
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
        z: satEci.z
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
        z: sunGeoVector.z * auToKm
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
      z: satPos.z - sunPos.z
    };

    // Vector from Sun to Earth center (opposite of sunPos since Earth is at origin)
    const sunToEarth = {
      x: -sunPos.x,
      y: -sunPos.y,
      z: -sunPos.z
    };

    // Distance from satellite to Sun-Earth line
    const sunToEarthMag = Math.sqrt(sunToEarth.x * sunToEarth.x + sunToEarth.y * sunToEarth.y + sunToEarth.z * sunToEarth.z);
    const sunToSatMag = Math.sqrt(sunToSat.x * sunToSat.x + sunToSat.y * sunToSat.y + sunToSat.z * sunToSat.z);

    // Dot product to find projection
    const dotProduct = sunToSat.x * sunToEarth.x + sunToSat.y * sunToEarth.y + sunToSat.z * sunToEarth.z;
    const projection = dotProduct / sunToEarthMag;

    // Check if satellite is on the day side of Earth (between Sun and Earth)
    if (projection < 0) {
      return false; // Satellite is on day side (between Sun and Earth), cannot be in shadow
    }

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

    let currentDate = new Date(startDate);
    let wasInEclipse = this.isInEclipse(currentDate);

    while (currentDate < endDate) {
      currentDate.setSeconds(currentDate.getSeconds() + timeStep);
      const isInEclipse = this.isInEclipse(currentDate);

      if (isInEclipse !== wasInEclipse) {
        // Eclipse state changed - record transition
        transitions.push({
          time: currentDate.getTime(),
          fromShadow: wasInEclipse, // true if transitioning from shadow to sunlight
          toShadow: isInEclipse     // true if transitioning from sunlight to shadow
        });
        wasInEclipse = isInEclipse;
      }
    }

    return transitions;
  }
}
