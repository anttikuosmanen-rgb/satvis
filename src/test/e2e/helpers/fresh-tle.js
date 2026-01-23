/**
 * E2E Test Helper: Fresh TLE Generation
 *
 * Generates TLE data with current epoch dates to ensure satellites
 * are never flagged as stale during E2E testing.
 */

/**
 * Generate a fresh TLE epoch string for "today"
 * Format: YYDDD.DDDDDDDD (2-digit year, day of year with fractional day)
 * @returns {string} TLE epoch in standard format
 */
export function generateFreshEpoch() {
  const now = new Date();
  const year = now.getUTCFullYear() % 100; // 2-digit year
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const fractionOfDay = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86400;
  return `${year.toString().padStart(2, "0")}${(dayOfYear + fractionOfDay).toFixed(8).padStart(12, "0")}`;
}

/**
 * Generate ISS TLE with fresh epoch
 * Uses real ISS orbital elements for accurate testing
 * @returns {string} 3-line TLE string
 */
export function generateFreshIssTle() {
  return `ISS (ZARYA)
1 25544U 98067A   ${generateFreshEpoch()}  .00016717  00000-0  10270-3 0  9991
2 25544  51.6416 247.4627 0006703  85.5961 274.6009 15.49478733123456`;
}

/**
 * Generate a custom test satellite TLE with fresh epoch
 * @param {string} name - Satellite name
 * @param {number} noradId - NORAD catalog ID
 * @returns {string} 3-line TLE string
 */
export function generateFreshCustomTle(name = "CUSTOM TEST SAT", noradId = 99999) {
  return `${name}
1 ${noradId.toString().padStart(5, "0")}U 24001A   ${generateFreshEpoch()}  .00001000  00000-0  10000-4 0  9999
2 ${noradId.toString().padStart(5, "0")}  98.0000 180.0000 0010000 100.0000 260.0000 14.50000000100000`;
}

/**
 * Generate Starlink TLE with fresh epoch
 * @returns {string} 3-line TLE string
 */
export function generateFreshStarlinkTle() {
  return `STARLINK-1007
1 44713U 19074A   ${generateFreshEpoch()}  .00001234  00000-0  98765-4 0  9998
2 44713  53.0536 123.4567 0001234  45.6789 314.5432 15.06491234567890`;
}

// Pre-generated fresh TLEs for convenience (regenerated on each test run)
export const FRESH_ISS_TLE = generateFreshIssTle();
export const FRESH_CUSTOM_TLE = generateFreshCustomTle();
export const FRESH_STARLINK_TLE = generateFreshStarlinkTle();

/**
 * Generate a TLE epoch string for 30 days in the future
 * Used to test pre-launch satellite handling (future-epoch satellites)
 * @returns {string} TLE epoch in standard format
 */
export function generateFutureEpoch() {
  const future = new Date();
  future.setDate(future.getDate() + 30); // 30 days from now
  const year = future.getUTCFullYear() % 100;
  const startOfYear = new Date(Date.UTC(future.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((future - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const fractionOfDay = (future.getUTCHours() * 3600 + future.getUTCMinutes() * 60 + future.getUTCSeconds()) / 86400;
  return `${year.toString().padStart(2, "0")}${(dayOfYear + fractionOfDay).toFixed(8).padStart(12, "0")}`;
}

/**
 * Generate a pre-launch satellite TLE with future epoch
 * These satellites get a " *" suffix in their name (see SatelliteProperties.js)
 * @param {string} name - Satellite name (will have " *" appended by the app)
 * @returns {string} 3-line TLE string with epoch 30 days in future
 */
export function generateFutureEpochTle(name = "PRELAUNCH-SAT") {
  return `${name}
1 00083U 58002B   ${generateFutureEpoch()}  .00000000  00000+0  00000-0 0  9999
2 00083  34.2500 123.4567 0012345  67.8901 292.1234 13.45678901234567`;
}

// Pre-generated future-epoch TLE for convenience
export const FRESH_FUTURE_TLE = generateFutureEpochTle();

/**
 * Build a URL with fresh ISS TLE data
 * Use this instead of `sats=ISS~(ZARYA)` to ensure fresh epoch
 * @param {Object} options - URL options
 * @param {string} [options.gs] - Ground station (e.g., "48.1351,11.5820,Munich")
 * @param {boolean} [options.hideLight] - Hide passes in daylight
 * @param {boolean} [options.onlyLit] - Show only lit satellites
 * @returns {string} URL with fresh ISS TLE
 */
export function buildFreshIssUrl(options = {}) {
  const tle = encodeURIComponent(generateFreshIssTle());
  let url = `/?sat=${tle}`;

  if (options.gs) {
    url += `&gs=${options.gs}`;
  }
  if (options.hideLight !== undefined) {
    url += `&hideLight=${options.hideLight ? 1 : 0}`;
  }
  if (options.onlyLit !== undefined) {
    url += `&onlyLit=${options.onlyLit ? 1 : 0}`;
  }

  return url;
}
