/**
 * Test fixture TLE data for unit tests
 * All TLEs use real orbital elements for accurate testing
 */

// ISS (3-line format with name) - December 2018
export const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   18342.69352573  .00002284  00000-0  41838-4 0  9992
2 25544  51.6407 229.0798 0005166 124.8351 329.3296 15.54069892145658`;

// ISS (2-line format without name) - Same epoch
export const ISS_TLE_NO_NAME = `1 25544U 98067A   18342.69352573  .00002284  00000-0  41838-4 0  9992
2 25544  51.6407 229.0798 0005166 124.8351 329.3296 15.54069892145658`;

// Starlink satellite (lower altitude, faster orbit)
export const STARLINK_TLE = `STARLINK-1007
1 44713U 19074A   25113.54166667  .00001234  00000-0  98765-4 0  9998
2 44713  53.0536 123.4567 0001234  45.6789 314.5432 15.06491234567890`;

// Future epoch satellite (prelaunch - epoch in future)
// Using NORAD 00083 from test example
export const FUTURE_EPOCH_TLE = `1 00083U 58002B   25350.00000000  .00000000  00000+0  00000-0 0  9999
2 00083  34.2500 123.4567 0012345  67.8901 292.1234 13.45678901234567`;

// Geostationary satellite (very long orbital period ~1436 minutes)
export const GEO_SATELLITE_TLE = `GOES-16
1 41866U 16071A   25113.50000000  .00000012  00000-0  00000+0 0  9991
2 41866   0.0123  85.3456 0000987 123.4567 236.5432  1.00271234567890`;

// ONEWEB satellite (from test example)
export const ONEWEB_TLE = `ONEWEB-0010
1 44058U 19011B   25113.45678901  .00000567  00000-0  12345-3 0  9997
2 44058  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234`;

// Test satellite #330 (from test example)
export const SAT_330_TLE = `Satellite  330°
1 39634U 14016A   25294.87619147  .00000382  00000+0  90745-4 0  9993
2 39634  98.1822 300.8762 0001320  89.7975 270.3376 14.59200968615266`;

// Multiple satellites concatenated (2 satellites)
export const TWO_SATS_CONCATENATED = ISS_TLE_NO_NAME + STARLINK_TLE.split("\n").slice(1).join("\n");

// Multiple satellites concatenated (5 satellites) - no separators, just back-to-back
export const FIVE_SATS_CONCATENATED = `ONEWEB-00011 44058U 19011B   25113.45678901  .00000567  00000-0  12345-3 0  99972 44058  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234ONEWEB-00021 44059U 19011C   25113.45678901  .00000567  00000-0  12345-3 0  99972 44059  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234ONEWEB-00031 44060U 19011D   25113.45678901  .00000567  00000-0  12345-3 0  99972 44060  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234ONEWEB-00041 44061U 19011E   25113.45678901  .00000567  00000-0  12345-3 0  99972 44061  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234ONEWEB-00051 44062U 19011F   25113.45678901  .00000567  00000-0  12345-3 0  99972 44062  87.4012 234.5678 0001987  98.7654 261.2345 13.12345678901234`;

// Invalid TLE examples for error handling tests
export const INVALID_TLE_MISSING_LINE2 = `TEST SAT
1 12345U 12345A   25113.50000000  .00000000  00000-0  00000-0 0  9999`;

export const INVALID_TLE_WRONG_START = `TEST SAT
3 12345U 12345A   25113.50000000  .00000000  00000-0  00000-0 0  9999
2 12345  45.0000 123.4567 0001234  67.8901 292.1234 15.12345678901234`;

export const INVALID_TLE_TOO_SHORT = `TEST SAT
1 12345U 12345A
2 12345  45.0000`;

// Expected parsed values for ISS TLE (for position calculation tests)
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

// Test dates
export const TEST_DATES = {
  ISS_EPOCH: new Date("2018-12-08"),
  ISS_TEST: new Date("2018-12-01"),
  PASS_START: new Date("2018-12-08"),
  PASS_END: new Date("2018-12-22"),
};
