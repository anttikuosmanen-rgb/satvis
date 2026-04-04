import { Cartesian3, Matrix3, Transforms } from "@cesium/engine";
import * as Astronomy from "astronomy-engine";

const AU_TO_METERS = 1.496e11;
const DEG_TO_RAD = Math.PI / 180;
export const OBLIQUITY_J2000 = 23.4392911 * DEG_TO_RAD; // Mean obliquity of ecliptic at J2000

// Pre-computed rotation matrix: ecliptic J2000 → equatorial J2000 (ICRF)
const cosObl = Math.cos(OBLIQUITY_J2000);
const sinObl = Math.sin(OBLIQUITY_J2000);

/**
 * 2-body Kepler propagation from classical orbital elements to positions.
 * Converts heliocentric ecliptic J2000 → geocentric ICRF → ECEF Cartesian3.
 */
export class KeplerPropagator {
  /**
   * Solve Kepler's equation M = E - e*sin(E) for eccentric anomaly E (elliptical).
   * Uses Newton-Raphson iteration.
   * @param {number} M - Mean anomaly in radians
   * @param {number} e - Eccentricity (must be < 1)
   * @param {number} tolerance - Convergence tolerance
   * @returns {number} Eccentric anomaly E in radians
   */
  static solveKeplerEquation(M, e, tolerance = 1e-12) {
    // Initial guess
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 50; i++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < tolerance) {
        return E;
      }
    }
    return E;
  }

  /**
   * Solve hyperbolic Kepler's equation M = e*sinh(H) - H for hyperbolic anomaly H.
   * Uses Newton-Raphson iteration.
   * @param {number} M - Mean anomaly in radians
   * @param {number} e - Eccentricity (must be > 1)
   * @param {number} tolerance - Convergence tolerance
   * @returns {number} Hyperbolic anomaly H
   */
  static solveHyperbolicKepler(M, e, tolerance = 1e-12) {
    // Initial guess: for large M, H ≈ sign(M)*ln(2|M|/e)
    let H = Math.abs(M) > 1 ? Math.sign(M) * Math.log((2 * Math.abs(M)) / e) : M;
    for (let i = 0; i < 50; i++) {
      const dH = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
      H -= dH;
      if (Math.abs(dH) < tolerance) {
        return H;
      }
    }
    return H;
  }

  /**
   * Compute heliocentric ecliptic J2000 position from orbital elements.
   * @param {Object} elements - Orbital elements
   * @param {number} elements.epoch_jd - Epoch in Julian Date (TDB)
   * @param {number} elements.e - Eccentricity
   * @param {number} elements.a_au - Semi-major axis in AU
   * @param {number} elements.i_deg - Inclination in degrees
   * @param {number} elements.om_deg - Longitude of ascending node (Ω) in degrees
   * @param {number} elements.w_deg - Argument of perihelion (ω) in degrees
   * @param {number} elements.ma_deg - Mean anomaly at epoch in degrees
   * @param {number} elements.n_deg_day - Mean motion in degrees/day
   * @param {number} julianDate - Target Julian Date (TDB)
   * @returns {{x: number, y: number, z: number}} Heliocentric ecliptic J2000 position in AU
   */
  static computeHeliocentricPosition(elements, julianDate) {
    const { e, a_au, i_deg, om_deg, w_deg, ma_deg, n_deg_day, epoch_jd } = elements;

    // Propagate mean anomaly
    const dt = julianDate - epoch_jd; // days
    const M = (ma_deg + n_deg_day * dt) * DEG_TO_RAD;

    let v, r;

    if (e < 1) {
      // Elliptical orbit
      const E = KeplerPropagator.solveKeplerEquation(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
      const sinV = (Math.sqrt(1 - e * e) * Math.sin(E)) / (1 - e * Math.cos(E));
      const cosV = (Math.cos(E) - e) / (1 - e * Math.cos(E));
      v = Math.atan2(sinV, cosV);
      r = a_au * (1 - e * Math.cos(E));
    } else {
      // Hyperbolic orbit (e > 1, a_au is negative)
      const H = KeplerPropagator.solveHyperbolicKepler(M, e);
      const sqrtEm1 = Math.sqrt(e - 1);
      const sqrtEp1 = Math.sqrt(e + 1);
      v = 2 * Math.atan2(sqrtEp1 * Math.sinh(H / 2), sqrtEm1 * Math.cosh(H / 2));
      r = a_au * (1 - e * Math.cosh(H)); // a_au < 0, e*cosh(H) > 1, so r > 0
    }

    // Position in orbital plane
    const xOrb = r * Math.cos(v);
    const yOrb = r * Math.sin(v);

    // Rotation angles
    const w = w_deg * DEG_TO_RAD;
    const om = om_deg * DEG_TO_RAD;
    const i = i_deg * DEG_TO_RAD;

    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const cosOm = Math.cos(om);
    const sinOm = Math.sin(om);
    const cosI = Math.cos(i);
    const sinI = Math.sin(i);

    // Rotate to ecliptic J2000 frame
    const x = (cosOm * cosW - sinOm * sinW * cosI) * xOrb + (-cosOm * sinW - sinOm * cosW * cosI) * yOrb;
    const y = (sinOm * cosW + cosOm * sinW * cosI) * xOrb + (-sinOm * sinW + cosOm * cosW * cosI) * yOrb;
    const z = sinW * sinI * xOrb + cosW * sinI * yOrb;

    return { x, y, z };
  }

  /**
   * Convert heliocentric ecliptic J2000 position to geocentric equatorial ICRF.
   * Subtracts Earth's heliocentric position and rotates ecliptic → equatorial.
   * @param {{x: number, y: number, z: number}} helioPos - Heliocentric ecliptic position in AU
   * @param {number} julianDate - Julian Date for Earth position lookup
   * @returns {Cartesian3} Geocentric ICRF position in meters
   */
  static heliocentricToGeocentric(helioPos, julianDate) {
    // Get Earth's heliocentric position from astronomy-engine
    // HelioVector returns equatorial J2000 (ICRF) coordinates in AU
    const jdOffset = julianDate - 2451545.0; // days from J2000
    const jsDate = new Date(Date.UTC(2000, 0, 1, 12, 0, 0) + jdOffset * 86400000);
    const earthHelio = Astronomy.HelioVector(Astronomy.Body.Earth, jsDate);

    // Convert NEO heliocentric ecliptic → equatorial (ICRF)
    const xEq = helioPos.x;
    const yEq = cosObl * helioPos.y - sinObl * helioPos.z;
    const zEq = sinObl * helioPos.y + cosObl * helioPos.z;

    // Subtract Earth position (already in equatorial ICRF from astronomy-engine)
    const dx = (xEq - earthHelio.x) * AU_TO_METERS;
    const dy = (yEq - earthHelio.y) * AU_TO_METERS;
    const dz = (zEq - earthHelio.z) * AU_TO_METERS;

    return new Cartesian3(dx, dy, dz);
  }

  /**
   * Full pipeline: orbital elements → ECEF Cartesian3 for Cesium entity positioning.
   * @param {Object} elements - Orbital elements (see computeHeliocentricPosition)
   * @param {JulianDate} cesiumJulianDate - Cesium JulianDate
   * @returns {Cartesian3|null} ECEF position in meters, or null if transform unavailable
   */
  static computeGeocentricCartesian(elements, cesiumJulianDate) {
    // Convert Cesium JulianDate to numeric JD
    const jd = cesiumJulianDate.dayNumber + cesiumJulianDate.secondsOfDay / 86400;

    // Compute heliocentric ecliptic position
    const helioPos = KeplerPropagator.computeHeliocentricPosition(elements, jd);

    // Convert to geocentric ICRF
    const icrfPos = KeplerPropagator.heliocentricToGeocentric(helioPos, jd);

    // Transform ICRF → ECEF (Fixed frame)
    const icrfToFixed = Transforms.computeIcrfToFixedMatrix(cesiumJulianDate);
    if (!icrfToFixed) {
      return null;
    }

    const result = new Cartesian3();
    Matrix3.multiplyByVector(icrfToFixed, icrfPos, result);
    return result;
  }

  /**
   * Compute heliocentric equatorial ICRF position in meters (for orbit rendering).
   * Used by CelestialOrbitRenderer with heliocentric=true.
   * @param {Object} elements - Orbital elements
   * @param {JulianDate} cesiumJulianDate - Cesium JulianDate
   * @returns {Cartesian3} Heliocentric ICRF position in meters
   */
  static computeHeliocentricICRF(elements, cesiumJulianDate) {
    const jd = cesiumJulianDate.dayNumber + cesiumJulianDate.secondsOfDay / 86400;
    const helioPos = KeplerPropagator.computeHeliocentricPosition(elements, jd);

    // Ecliptic → equatorial rotation
    const x = helioPos.x * AU_TO_METERS;
    const y = (cosObl * helioPos.y - sinObl * helioPos.z) * AU_TO_METERS;
    const z = (sinObl * helioPos.y + cosObl * helioPos.z) * AU_TO_METERS;

    return new Cartesian3(x, y, z);
  }

  /**
   * Compute heliocentric ICRF position directly from eccentric anomaly E (elliptical only).
   * For hyperbolic orbits, use computeHeliocentricICRFByH instead.
   * @param {Object} elements - Orbital elements (must have e < 1)
   * @param {number} E - Eccentric anomaly in radians
   * @returns {Cartesian3} Heliocentric ICRF position in meters
   */
  static computeHeliocentricICRFByE(elements, E) {
    const { e, a_au, i_deg, om_deg, w_deg } = elements;

    // True anomaly from eccentric anomaly
    const sinV = (Math.sqrt(1 - e * e) * Math.sin(E)) / (1 - e * Math.cos(E));
    const cosV = (Math.cos(E) - e) / (1 - e * Math.cos(E));
    const v = Math.atan2(sinV, cosV);

    // Heliocentric distance
    const r = a_au * (1 - e * Math.cos(E));

    // Position in orbital plane
    const xOrb = r * Math.cos(v);
    const yOrb = r * Math.sin(v);

    // Rotation angles
    const w = w_deg * DEG_TO_RAD;
    const om = om_deg * DEG_TO_RAD;
    const i = i_deg * DEG_TO_RAD;

    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const cosOm = Math.cos(om);
    const sinOm = Math.sin(om);
    const cosI = Math.cos(i);
    const sinI = Math.sin(i);

    // Rotate to ecliptic J2000 frame
    const xEcl = (cosOm * cosW - sinOm * sinW * cosI) * xOrb + (-cosOm * sinW - sinOm * cosW * cosI) * yOrb;
    const yEcl = (sinOm * cosW + cosOm * sinW * cosI) * xOrb + (-sinOm * sinW + cosOm * cosW * cosI) * yOrb;
    const zEcl = sinW * sinI * xOrb + cosW * sinI * yOrb;

    // Ecliptic → equatorial (ICRF), AU → meters
    const x = xEcl * AU_TO_METERS;
    const y = (cosObl * yEcl - sinObl * zEcl) * AU_TO_METERS;
    const z = (sinObl * yEcl + cosObl * zEcl) * AU_TO_METERS;

    return new Cartesian3(x, y, z);
  }

  /**
   * Compute heliocentric ICRF position from hyperbolic anomaly H (hyperbolic orbits).
   * @param {Object} elements - Orbital elements (must have e > 1, a_au < 0)
   * @param {number} H - Hyperbolic anomaly
   * @returns {Cartesian3} Heliocentric ICRF position in meters
   */
  static computeHeliocentricICRFByH(elements, H) {
    const { e, a_au, i_deg, om_deg, w_deg } = elements;

    // True anomaly from hyperbolic anomaly
    const sqrtEm1 = Math.sqrt(e - 1);
    const sqrtEp1 = Math.sqrt(e + 1);
    const v = 2 * Math.atan2(sqrtEp1 * Math.sinh(H / 2), sqrtEm1 * Math.cosh(H / 2));

    // Heliocentric distance (a_au < 0, e*cosh(H) > 1, so r > 0)
    const r = a_au * (1 - e * Math.cosh(H));

    // Position in orbital plane
    const xOrb = r * Math.cos(v);
    const yOrb = r * Math.sin(v);

    // Rotation angles
    const w = w_deg * DEG_TO_RAD;
    const om = om_deg * DEG_TO_RAD;
    const i = i_deg * DEG_TO_RAD;

    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const cosOm = Math.cos(om);
    const sinOm = Math.sin(om);
    const cosI = Math.cos(i);
    const sinI = Math.sin(i);

    // Rotate to ecliptic J2000 frame
    const xEcl = (cosOm * cosW - sinOm * sinW * cosI) * xOrb + (-cosOm * sinW - sinOm * cosW * cosI) * yOrb;
    const yEcl = (sinOm * cosW + cosOm * sinW * cosI) * xOrb + (-sinOm * sinW + cosOm * cosW * cosI) * yOrb;
    const zEcl = sinW * sinI * xOrb + cosW * sinI * yOrb;

    // Ecliptic → equatorial (ICRF), AU → meters
    const x = xEcl * AU_TO_METERS;
    const y = (cosObl * yEcl - sinObl * zEcl) * AU_TO_METERS;
    const z = (sinObl * yEcl + cosObl * zEcl) * AU_TO_METERS;

    return new Cartesian3(x, y, z);
  }

  /**
   * Convert a Cesium JulianDate to eccentric/hyperbolic anomaly for given orbital elements.
   * For elliptical orbits returns E normalized to [0, 2π).
   * For hyperbolic orbits returns H (not normalized — can be any real number).
   * @param {Object} elements - Orbital elements
   * @param {JulianDate} cesiumJulianDate - Cesium JulianDate
   * @returns {number} Anomaly value
   */
  static timeToEccentricAnomaly(elements, cesiumJulianDate) {
    const { e, ma_deg, n_deg_day, epoch_jd } = elements;
    const jd = cesiumJulianDate.dayNumber + cesiumJulianDate.secondsOfDay / 86400;
    const dt = jd - epoch_jd;
    const M = (ma_deg + n_deg_day * dt) * DEG_TO_RAD;

    if (e >= 1) {
      return KeplerPropagator.solveHyperbolicKepler(M, e);
    }

    const TWO_PI = 2 * Math.PI;
    const Mnorm = ((M % TWO_PI) + TWO_PI) % TWO_PI;
    const E = KeplerPropagator.solveKeplerEquation(Mnorm, e);
    return ((E % TWO_PI) + TWO_PI) % TWO_PI;
  }
}
