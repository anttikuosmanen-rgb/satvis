import * as SunCalc from "suncalc";
import * as Astronomy from "astronomy-engine";

const deg2rad = Math.PI / 180;

/**
 * Ground station lighting and weather conditions utilities
 * Enhanced with astronomy-engine for high-precision calculations
 */
export class GroundStationConditions {
  /**
   * Determines if ground station is in darkness (suitable for visual satellite observation)
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} time - Time to check conditions
   * @param {string} method - Calculation method: "suncalc" (default) or "astronomy-engine"
   * @returns {boolean} True if ground station is in darkness (sun altitude < -6°)
   */
  static isInDarkness(position, time, method = "suncalc") {
    if (method === "astronomy-engine") {
      return this.isInDarknessAstronomyEngine(position, time);
    }

    // Default SunCalc method for backwards compatibility
    const sunPosition = SunCalc.getPosition(time, position.latitude, position.longitude);
    // Sun altitude below -6 degrees indicates civil twilight (darkness for visual observation)
    return sunPosition.altitude < -6 * deg2rad;
  }

  /**
   * High-precision darkness calculation using astronomy-engine
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} time - Time to check conditions
   * @returns {boolean} True if ground station is in darkness (sun altitude < -6°)
   */
  static isInDarknessAstronomyEngine(position, time) {
    try {
      const observer = new Astronomy.Observer(position.latitude, position.longitude, position.height || 0);
      const astroTime = new Astronomy.AstroTime(time);

      // Get Sun's equatorial coordinates
      const equ = Astronomy.Equator("Sun", astroTime, observer, true, true);

      // Convert to horizontal coordinates (altitude/azimuth)
      const hor = Astronomy.Horizon(astroTime, observer, equ.ra, equ.dec, "normal");

      // Civil twilight threshold: -6 degrees
      return hor.altitude < -6.0;
    } catch (error) {
      console.warn("Astronomy-engine calculation failed, falling back to SunCalc:", error);
      // Fallback to SunCalc
      const sunPosition = SunCalc.getPosition(time, position.latitude, position.longitude);
      return sunPosition.altitude < -6 * deg2rad;
    }
  }

  /**
   * Gets descriptive lighting condition text
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} time - Time to check conditions
   * @returns {string} "Dark" or "Light"
   */
  static getLightingCondition(position, time) {
    return this.isInDarkness(position, time) ? "Dark" : "Light";
  }

  /**
   * Gets lighting condition with emoji indicator
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} time - Time to check conditions
   * @returns {string} "🌙 Dark" or "☀️ Light"
   */
  static getLightingConditionWithEmoji(position, time) {
    const isDark = this.isInDarkness(position, time);
    return isDark ? "🌙 Dark" : "☀️ Light";
  }

  /**
   * Gets sun position information for ground station
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} time - Time to check conditions
   * @param {string} method - Calculation method: "suncalc" (default) or "astronomy-engine"
   * @returns {Object} Sun position data {altitude, azimuth, isDark}
   */
  static getSunPosition(position, time, method = "suncalc") {
    if (method === "astronomy-engine") {
      return this.getSunPositionAstronomyEngine(position, time);
    }

    // Default SunCalc method
    const sunPosition = SunCalc.getPosition(time, position.latitude, position.longitude);
    return {
      altitude: sunPosition.altitude * (180 / Math.PI), // Convert to degrees
      // SunCalc returns azimuth measured from south going west; convert to north-based clockwise (0=N, 90=E, 180=S, 270=W)
      azimuth: (sunPosition.azimuth * (180 / Math.PI) + 180) % 360,
      isDark: sunPosition.altitude < -6 * deg2rad,
    };
  }

  /**
   * High-precision sun position calculation using astronomy-engine
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} time - Time to check conditions
   * @returns {Object} Sun position data {altitude, azimuth, isDark}
   */
  static getSunPositionAstronomyEngine(position, time) {
    try {
      const observer = new Astronomy.Observer(position.latitude, position.longitude, position.height || 0);
      const astroTime = new Astronomy.AstroTime(time);

      // Get Sun's equatorial coordinates
      const equ = Astronomy.Equator("Sun", astroTime, observer, true, true);

      // Convert to horizontal coordinates (altitude/azimuth)
      const hor = Astronomy.Horizon(astroTime, observer, equ.ra, equ.dec, "normal");

      return {
        altitude: hor.altitude, // Already in degrees
        azimuth: hor.azimuth, // Already in degrees
        isDark: hor.altitude < -6.0,
      };
    } catch (error) {
      console.warn("Astronomy-engine sun position calculation failed, falling back to SunCalc:", error);
      // Fallback to SunCalc
      const sunPosition = SunCalc.getPosition(time, position.latitude, position.longitude);
      return {
        altitude: sunPosition.altitude * (180 / Math.PI),
        azimuth: (sunPosition.azimuth * (180 / Math.PI) + 180) % 360,
        isDark: sunPosition.altitude < -6 * deg2rad,
      };
    }
  }

  /**
   * Calculate twilight times (sunrise, sunset, dawn, dusk) for a ground station
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} date - Date for which to calculate twilight times
   * @returns {Object} Twilight times {sunrise, sunset, civilDawn, civilDusk, nauticalDawn, nauticalDusk, astronomicalDawn, astronomicalDusk}
   */
  static getTwilightTimes(position, date) {
    try {
      const observer = new Astronomy.Observer(position.latitude, position.longitude, position.height || 0);
      const astroTime = new Astronomy.AstroTime(date);

      // Search for various twilight events
      const results = {};

      // Sunrise/sunset (when sun's center crosses horizon)
      try {
        const riseSetInfo = Astronomy.SearchRiseSet("Sun", observer, +1, astroTime, 1);
        if (riseSetInfo) {
          results.sunrise = riseSetInfo.date;
        }
        const riseSetInfoSet = Astronomy.SearchRiseSet("Sun", observer, -1, astroTime, 1);
        if (riseSetInfoSet) {
          results.sunset = riseSetInfoSet.date;
        }
      } catch (e) {
        console.warn("Rise/set calculation failed:", e);
      }

      // Civil twilight (-6°)
      try {
        const civilDawn = Astronomy.SearchAltitude("Sun", observer, +1, astroTime, 1, -6.0);
        if (civilDawn) results.civilDawn = civilDawn.date;

        const civilDusk = Astronomy.SearchAltitude("Sun", observer, -1, astroTime, 1, -6.0);
        if (civilDusk) results.civilDusk = civilDusk.date;
      } catch (e) {
        console.warn("Civil twilight calculation failed:", e);
      }

      // Nautical twilight (-12°)
      try {
        const nauticalDawn = Astronomy.SearchAltitude("Sun", observer, +1, astroTime, 1, -12.0);
        if (nauticalDawn) results.nauticalDawn = nauticalDawn.date;

        const nauticalDusk = Astronomy.SearchAltitude("Sun", observer, -1, astroTime, 1, -12.0);
        if (nauticalDusk) results.nauticalDusk = nauticalDusk.date;
      } catch (e) {
        console.warn("Nautical twilight calculation failed:", e);
      }

      // Astronomical twilight (-18°)
      try {
        const astronomicalDawn = Astronomy.SearchAltitude("Sun", observer, +1, astroTime, 1, -18.0);
        if (astronomicalDawn) results.astronomicalDawn = astronomicalDawn.date;

        const astronomicalDusk = Astronomy.SearchAltitude("Sun", observer, -1, astroTime, 1, -18.0);
        if (astronomicalDusk) results.astronomicalDusk = astronomicalDusk.date;
      } catch (e) {
        console.warn("Astronomical twilight calculation failed:", e);
      }

      return results;
    } catch (error) {
      console.warn("Twilight calculation failed:", error);
      return {};
    }
  }

  /**
   * Get next darkness window (civil dusk to civil dawn) for ground station.
   * Used for bright satellite pass calculations.
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} fromDate - Starting date to search from
   * @returns {Object|null} {start: Date, end: Date, isOngoing: boolean} or null if polar day
   */
  static getNextDarknessWindow(position, fromDate) {
    const isDark = this.isInDarkness(position, fromDate);

    if (isDark) {
      // Currently dark - find when darkness ends (civil dawn)
      const twilight = this.getTwilightTimes(position, fromDate);
      if (twilight.civilDawn) {
        return { start: fromDate, end: twilight.civilDawn, isOngoing: true };
      }
      // Polar night - use 24 hour window
      return { start: fromDate, end: new Date(fromDate.getTime() + 24 * 60 * 60 * 1000), isOngoing: true };
    }

    // Currently light - find next civil dusk
    const twilight = this.getTwilightTimes(position, fromDate);

    if (!twilight.civilDusk) {
      // Polar day - no darkness
      return null;
    }

    // Find civil dawn after civil dusk
    // If civilDawn is before civilDusk, we need to get next day's dawn
    let dawnTime = twilight.civilDawn;
    if (!dawnTime || dawnTime < twilight.civilDusk) {
      // Get twilight times for next day
      const nextDay = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
      const nextTwilight = this.getTwilightTimes(position, nextDay);
      dawnTime = nextTwilight.civilDawn;
    }

    if (!dawnTime) {
      // Fallback: 12 hours after dusk
      dawnTime = new Date(twilight.civilDusk.getTime() + 12 * 60 * 60 * 1000);
    }

    return { start: twilight.civilDusk, end: dawnTime, isOngoing: false };
  }
}
