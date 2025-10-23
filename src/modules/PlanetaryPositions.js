import * as Astronomy from "astronomy-engine";
import { Cartesian3, JulianDate, Transforms, Matrix3, Matrix4, Simon1994PlanetaryPositions } from "@cesium/engine";

/**
 * Calculate positions for the 5 brightest planets visible to the naked eye
 * Mercury, Venus, Mars, Jupiter, Saturn
 */
export class PlanetaryPositions {
  constructor() {
    // Define the 5 brightest planets
    this.planets = [
      { body: Astronomy.Body.Mercury, name: "Mercury", color: [169, 169, 169], symbol: "☿" }, // Gray
      { body: Astronomy.Body.Venus, name: "Venus", color: [255, 230, 170], symbol: "♀" }, // Pale yellow
      { body: Astronomy.Body.Mars, name: "Mars", color: [255, 100, 70], symbol: "♂" }, // Red-orange
      { body: Astronomy.Body.Jupiter, name: "Jupiter", color: [255, 220, 180], symbol: "♃" }, // Pale orange
      { body: Astronomy.Body.Saturn, name: "Saturn", color: [255, 235, 200], symbol: "♄" }, // Pale yellow-white
    ];
  }

  /**
   * Calculate planetary positions at a given time
   * @param {JulianDate} julianDate - Cesium JulianDate
   * @returns {Array} Array of planet data with positions
   */
  calculatePositions(julianDate) {
    // Convert Cesium JulianDate to JavaScript Date
    const jsDate = JulianDate.toDate(julianDate);

    const positions = [];

    for (const planet of this.planets) {
      try {
        // Get equatorial coordinates (RA and Dec) for the planet
        // Use a geocentric observer (Earth center) by passing an Observer at (0,0,0)
        const observer = new Astronomy.Observer(0, 0, 0);
        const equatorial = Astronomy.Equator(planet.body, jsDate, observer, true, true);

        // Convert equatorial coordinates to Cartesian position
        // RA is in hours (0-24), Dec is in degrees (-90 to +90)
        const ra = equatorial.ra * 15; // Convert hours to degrees (15 degrees per hour)
        const dec = equatorial.dec;

        // Convert RA/Dec to Cartesian coordinates in ICRF frame
        // Use actual distance from Earth in AU, converted to meters
        const distance = equatorial.dist * 1.496e11; // AU to meters (1 AU = 149.6 million km)

        const position = this.equatorialToCartesianICRF(ra, dec, distance, julianDate);

        // Get illumination data to determine brightness
        const illum = Astronomy.Illumination(planet.body, jsDate);

        positions.push({
          name: planet.name,
          body: planet.body,
          position,
          ra: equatorial.ra,
          dec: equatorial.dec,
          magnitude: illum.mag, // Visual magnitude
          illumination: illum.phase_fraction * 100, // Percentage illuminated
          distance_au: equatorial.dist, // Distance from Earth in AU
          color: planet.color,
          symbol: planet.symbol,
        });
      } catch (error) {
        console.error(`Error calculating position for ${planet.name}:`, error);
      }
    }

    return positions;
  }

  /**
   * Convert equatorial coordinates (RA, Dec) to Cesium Cartesian3
   * Uses the same approach as Cesium's Sun/Moon positioning
   * @param {number} ra - Right Ascension in degrees
   * @param {number} dec - Declination in degrees
   * @param {number} distance - Distance from origin
   * @param {JulianDate} time - Cesium JulianDate for frame transformation
   * @returns {Cartesian3} Cartesian position in Earth-Inertial frame
   */
  equatorialToCartesianICRF(ra, dec, distance, time) {
    // Convert degrees to radians
    const raRad = (ra * Math.PI) / 180;
    const decRad = (dec * Math.PI) / 180;

    // Convert spherical coordinates to Cartesian in ICRF (Earth-Inertial) frame
    // Standard astronomical convention: X-axis points to vernal equinox, Z-axis to north celestial pole
    const xInertial = distance * Math.cos(decRad) * Math.cos(raRad);
    const yInertial = distance * Math.cos(decRad) * Math.sin(raRad);
    const zInertial = distance * Math.sin(decRad);

    const positionInertial = new Cartesian3(xInertial, yInertial, zInertial);

    // Transform from ICRF (inertial) to Fixed (Earth-fixed) frame
    // This is needed because Cesium's entity positions are in Fixed frame by default
    const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time);
    if (!icrfToFixed) {
      // Fallback if transformation fails
      return positionInertial;
    }

    const positionFixed = Matrix3.multiplyByVector(icrfToFixed, positionInertial, new Cartesian3());
    return positionFixed;
  }

  /**
   * Check if a planet is above the horizon for a given observer location
   * @param {string} planetName - Name of the planet
   * @param {Date} date - JavaScript Date
   * @param {number} latitude - Observer latitude in degrees
   * @param {number} longitude - Observer longitude in degrees
   * @returns {Object} Object with altitude, azimuth, and isVisible flag
   */
  getPlanetAltitudeAzimuth(planetName, date, latitude, longitude) {
    const planet = this.planets.find((p) => p.name === planetName);
    if (!planet) {
      throw new Error(`Unknown planet: ${planetName}`);
    }

    // Create observer object
    const observer = new Astronomy.Observer(latitude, longitude, 0);

    // Get horizontal coordinates (altitude and azimuth)
    const equatorial = Astronomy.Equator(planet.body, date, observer, true, true);
    const horizontal = Astronomy.Horizon(date, observer, equatorial.ra, equatorial.dec, "normal");

    return {
      altitude: horizontal.altitude, // Degrees above horizon
      azimuth: horizontal.azimuth, // Degrees from North
      isVisible: horizontal.altitude > 0, // Above horizon
    };
  }

  /**
   * Get all visible planets for a given observer location and time
   * @param {JulianDate} julianDate - Cesium JulianDate
   * @param {number} latitude - Observer latitude in degrees
   * @param {number} longitude - Observer longitude in degrees
   * @returns {Array} Array of visible planets with positions and horizontal coordinates
   */
  getVisiblePlanets(julianDate, latitude, longitude) {
    const jsDate = JulianDate.toDate(julianDate);
    const positions = this.calculatePositions(julianDate);

    const visiblePlanets = [];

    for (const planetData of positions) {
      const horizData = this.getPlanetAltitudeAzimuth(planetData.name, jsDate, latitude, longitude);

      if (horizData.isVisible) {
        visiblePlanets.push({
          ...planetData,
          altitude: horizData.altitude,
          azimuth: horizData.azimuth,
        });
      }
    }

    return visiblePlanets;
  }

  /**
   * Get planet names
   * @returns {Array<string>} Array of planet names
   */
  getPlanetNames() {
    return this.planets.map((p) => p.name);
  }
}
