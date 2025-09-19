import * as SunCalc from "../../../suncalc/suncalc.js";

const deg2rad = Math.PI / 180;

/**
 * Ground station lighting and weather conditions utilities
 */
export class GroundStationConditions {
  /**
   * Determines if ground station is in darkness (suitable for visual satellite observation)
   * @param {Object} position - Ground station position {latitude, longitude, height}
   * @param {Date} time - Time to check conditions
   * @returns {boolean} True if ground station is in darkness (sun altitude < -6°)
   */
  static isInDarkness(position, time) {
    const sunPosition = SunCalc.getPosition(time, position.latitude, position.longitude);
    // Sun altitude below -6 degrees indicates civil twilight (darkness for visual observation)
    return sunPosition.altitude < (-6 * deg2rad);
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
   * @returns {Object} Sun position data {altitude, azimuth, isDark}
   */
  static getSunPosition(position, time) {
    const sunPosition = SunCalc.getPosition(time, position.latitude, position.longitude);
    return {
      altitude: sunPosition.altitude,
      azimuth: sunPosition.azimuth,
      isDark: sunPosition.altitude < (-6 * deg2rad),
    };
  }
}