/**
 * Test fixture TLE data for unit tests
 * All TLEs use real orbital elements for accurate testing
 *
 * IMPORTANT: Most TLEs use dynamically generated epochs to ensure they're never flagged as stale.
 * Only ISS_TLE, ISS_TLE_NO_NAME, and ISS_TLE_UPDATED use fixed stale epochs for staleness tests.
 */

/**
 * Generate a fresh TLE epoch string for "today"
 * Format: YYDDD.DDDDDDDD (2-digit year, day of year with fractional day)
 * @returns {string} TLE epoch in standard format
 */
function generateFreshEpoch() {
  const now = new Date();
  const year = now.getUTCFullYear() % 100; // 2-digit year
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((now - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  const fractionOfDay = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86400;
  return `${year.toString().padStart(2, "0")}${(dayOfYear + fractionOfDay).toFixed(8).padStart(12, "0")}`;
}

/**
 * Generate a future TLE epoch string (30 days from now)
 * @returns {string} TLE epoch in standard format
 */
function generateFutureEpoch() {
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const year = future.getUTCFullYear() % 100;
  const startOfYear = new Date(Date.UTC(future.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((future - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
  return `${year.toString().padStart(2, "0")}${dayOfYear.toFixed(8).padStart(12, "0")}`;
}

// ============================================================================
// STALE TLEs - Fixed epochs for testing staleness detection
// ============================================================================

// ISS (3-line format with name) - December 2018 (STALE - used for staleness tests)
export const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   18342.69352573  .00002284  00000-0  41838-4 0  9992
2 25544  51.6407 229.0798 0005166 124.8351 329.3296 15.54069892145658`;

// ISS (2-line format without name) - Same epoch (STALE)
export const ISS_TLE_NO_NAME = `1 25544U 98067A   18342.69352573  .00002284  00000-0  41838-4 0  9992
2 25544  51.6407 229.0798 0005166 124.8351 329.3296 15.54069892145658`;

// ISS with updated orbital elements (simulates TLE data refresh) - STALE epoch
// Same NORAD number and name, but different orbital elements (mean motion changed)
export const ISS_TLE_UPDATED = `ISS (ZARYA)
1 25544U 98067A   18350.12345678  .00002500  00000-0  45000-4 0  9999
2 25544  51.6500 230.1234 0005200 125.0000 330.0000 15.54100000146000`;

// ============================================================================
// FRESH TLEs - Dynamically generated epochs (always current)
// ============================================================================

// ISS with dynamically generated fresh epoch - always recent for tests
export const ISS_TLE_FRESH = `ISS (ZARYA)
1 25544U 98067A   ${generateFreshEpoch()}  .00002284  00000-0  41838-4 0  9992
2 25544  51.6407 229.0798 0005166 124.8351 329.3296 15.54069892145658`;

// Starlink satellite (lower altitude, faster orbit) - FRESH epoch
export const STARLINK_TLE = `STARLINK-1007
1 44713U 19074A   ${generateFreshEpoch()}  .00001234  00000-0  98765-4 0  9998
2 44713  53.0536 123.4567 0001234  45.6789 314.5432 15.06491234567890`;

// Geostationary satellite (very long orbital period ~1436 minutes) - FRESH epoch
export const GEO_SATELLITE_TLE = `GOES-16
1 41866U 16071A   ${generateFreshEpoch()}  .00000012  00000-0  00000+0 0  9991
2 41866   0.0123  85.3456 0000987 123.4567 236.5432  1.00271234567890`;

// ONEWEB satellite (from test example) - FRESH epoch
export const ONEWEB_TLE = `ONEWEB-0010
1 44058U 19011B   ${generateFreshEpoch()}  .00000567  00000-0  12345-3 0  9997
2 44058  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234`;

// Test satellite #330 (from test example) - FRESH epoch
export const SAT_330_TLE = `Satellite  330°
1 39634U 14016A   ${generateFreshEpoch()}  .00000382  00000-0  90745-4 0  9993
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266`;

// Future epoch satellite (prelaunch - epoch in future) - Dynamic future epoch
export const FUTURE_EPOCH_TLE = `PRELAUNCH-SAT
1 00083U 58002B   ${generateFutureEpoch()}  .00000000  00000+0  00000-0 0  9999
2 00083  34.2500 123.4567 0012345  67.8901 292.1234 13.45678901234567`;

// ============================================================================
// Multiple satellites and invalid TLEs for edge case testing
// ============================================================================

// Multiple satellites concatenated (2 satellites) - uses fresh STARLINK
export const TWO_SATS_CONCATENATED = ISS_TLE_NO_NAME + STARLINK_TLE.split("\n").slice(1).join("\n");

// Multiple satellites concatenated (5 satellites) - FRESH epochs
const freshEpoch = generateFreshEpoch();
export const FIVE_SATS_CONCATENATED = `ONEWEB-0001
1 44058U 19011B   ${freshEpoch}  .00000567  00000-0  12345-3 0  9997
2 44058  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234
ONEWEB-0002
1 44059U 19011C   ${freshEpoch}  .00000567  00000-0  12345-3 0  9997
2 44059  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234
ONEWEB-0003
1 44060U 19011D   ${freshEpoch}  .00000567  00000-0  12345-3 0  9997
2 44060  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234
ONEWEB-0004
1 44061U 19011E   ${freshEpoch}  .00000567  00000-0  12345-3 0  9997
2 44061  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234
ONEWEB-0005
1 44062U 19011F   ${freshEpoch}  .00000567  00000-0  12345-3 0  9997
2 44062  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234`;

// Invalid TLE examples for error handling tests
export const INVALID_TLE_MISSING_LINE2 = `TEST SAT
1 12345U 12345A   25113.50000000  .00000000  00000-0  00000-0 0  9999`;

export const INVALID_TLE_WRONG_START = `TEST SAT
3 12345U 12345A   25113.50000000  .00000000  00000-0  00000-0 0  9999
2 12345  45.0000 123.4567 0001234  67.8901 292.1234 15.12345678901234`;

export const INVALID_TLE_TOO_SHORT = `TEST SAT
1 12345U 12345A
2 12345  45.0000`;

// TLE with space-padded NORAD ID (old satellites with catalog numbers < 10000)
// NORAD ID 694 is OV1-2 (launched 1963)
export const SPACE_PADDED_NORAD_TLE = `1   694U 63047A   ${generateFreshEpoch()}  .00001631  00000-0  18952-3 0  9996
2   694  30.3532 279.6750 0548805 100.0696 266.2251 14.11792095120382`;

// Duplicate name satellites (same name, different NORAD IDs) - for testing disambiguation
// Simulates classified catalog satellites like "StarSh" that have same name
export const DUPLICATE_NAME_SAT1 = `StarSh
1 55001U 23001A   ${generateFreshEpoch()}  .00001234  00000-0  98765-4 0  9998
2 55001  53.0536 123.4567 0001234  45.6789 314.5432 15.06491234567890`;

export const DUPLICATE_NAME_SAT2 = `StarSh
1 55002U 23002A   ${generateFreshEpoch()}  .00001234  00000-0  98765-4 0  9998
2 55002  53.0536 124.4567 0001234  46.6789 315.5432 15.06491234567890`;

export const DUPLICATE_NAME_SAT3 = `StarSh
1 55003U 23003A   ${generateFreshEpoch()}  .00001234  00000-0  98765-4 0  9998
2 55003  53.0536 125.4567 0001234  47.6789 316.5432 15.06491234567890`;

// ============================================================================
// Expected values and test data
// ============================================================================

// Expected parsed values for ISS TLE (for position calculation tests)
// Note: These values are for the STALE ISS_TLE epoch (2018-12-08)
export const ISS_EXPECTED = {
  name: "ISS (ZARYA)",
  satnum: 25544,
  // At 2018-12-01 00:00:00 UTC
  position_2018_12_01: {
    eci: {
      x: -990.91,
      y: -6651.59,
      z: -906.03,
    },
    geodetic: {
      longitude: -152.81, // degrees
      latitude: -7.48, // degrees
      height: 408000.64, // meters
    },
  },
  orbitalPeriod: 92.7, // minutes (approximate)
};

// Munich ground station (from test example)
export const MUNICH_GS = {
  latitude: 48.177,
  longitude: 11.7476,
  height: 0,
};

// San Francisco ground station
export const SF_GS = {
  latitude: 37.7749,
  longitude: -122.4194,
  height: 0,
};

// Test dates - for use with STALE ISS_TLE
export const TEST_DATES = {
  ISS_EPOCH: new Date("2018-12-08"),
  ISS_TEST: new Date("2018-12-01"),
  PASS_START: new Date("2018-12-08"),
  PASS_END: new Date("2018-12-22"),
};
