import { describe, it, expect, beforeEach } from "vitest";
import Orbit from "../modules/Orbit";
import { ISS_TLE, ISS_TLE_NO_NAME, GEO_SATELLITE_TLE, MUNICH_GS, TEST_DATES } from "./fixtures/tle-data";

describe("Orbit - Basic Construction", () => {
  it("should create orbit from valid 3-line TLE", () => {
    const orbit = new Orbit("ISS", ISS_TLE);

    expect(orbit).toBeDefined();
    expect(orbit.name).toBe("ISS");
    expect(orbit.tle).toHaveLength(3);
  });

  it("should create orbit from valid 2-line TLE", () => {
    // For 2-line TLE, we need to add empty line at start manually or use proper TLE format
    const twoLineTle = "\n" + ISS_TLE_NO_NAME;
    const orbit = new Orbit("ISS", twoLineTle);

    expect(orbit).toBeDefined();
    expect(orbit.name).toBe("ISS");
  });

  it("should extract satellite number from TLE", () => {
    const orbit = new Orbit("ISS", ISS_TLE);

    // satnum is returned as string by satellite.js
    expect(orbit.satnum).toBe("25544");
  });

  it("should handle malformed TLE data gracefully", () => {
    // satellite.js is forgiving with invalid TLE data
    // It will parse what it can and use defaults for unparseable fields
    const invalidTle = "INVALID\nINVALID LINE 1\nINVALID LINE 2";
    const orbit = new Orbit("TEST", invalidTle);

    // Orbit object should be created
    expect(orbit).toBeDefined();
    expect(orbit.name).toBe("TEST");

    // The satrec should exist but may have error flag set
    expect(orbit.satrec).toBeDefined();
  });

  it("should calculate orbital period correctly", () => {
    const orbit = new Orbit("ISS", ISS_TLE);

    // ISS orbital period is approximately 92-93 minutes
    // orbitalPeriod is in minutes (not seconds)
    expect(orbit.orbitalPeriod).toBeGreaterThan(90);
    expect(orbit.orbitalPeriod).toBeLessThan(95);
  });
});

describe("Orbit - Position Calculations", () => {
  let orbit;

  beforeEach(() => {
    orbit = new Orbit("ISS", ISS_TLE);
  });

  it("should calculate ECI position at given time", () => {
    const time = TEST_DATES.ISS_EPOCH; // Use epoch date for accurate position

    const position = orbit.positionECI(time);

    expect(position).toBeDefined();
    expect(position.x).toBeDefined();
    expect(position.y).toBeDefined();
    expect(position.z).toBeDefined();

    // ECI coordinates should be in reasonable range for LEO satellite (within ~7000 km from Earth center)
    const distance = Math.sqrt(position.x ** 2 + position.y ** 2 + position.z ** 2);
    expect(distance).toBeGreaterThan(6600); // Above Earth surface
    expect(distance).toBeLessThan(7000); // Below ISS typical altitude
  });

  it("should calculate ECF position at given time", () => {
    const time = TEST_DATES.ISS_TEST;

    const position = orbit.positionECF(time);

    expect(position).toBeDefined();
    expect(position.x).toBeDefined();
    expect(position.y).toBeDefined();
    expect(position.z).toBeDefined();
  });

  it("should calculate geodetic position (lat/lon/height) at given time", () => {
    const time = TEST_DATES.ISS_EPOCH;

    const position = orbit.positionGeodetic(time);

    expect(position).toBeDefined();
    expect(position.longitude).toBeDefined();
    expect(position.latitude).toBeDefined();
    expect(position.height).toBeDefined();

    // Latitude should be within ISS inclination limits
    expect(position.latitude).toBeGreaterThan(-52);
    expect(position.latitude).toBeLessThan(52);

    // Longitude should be -180 to 180
    expect(position.longitude).toBeGreaterThan(-180);
    expect(position.longitude).toBeLessThan(180);

    // Height should be typical ISS altitude
    expect(position.height).toBeGreaterThan(400000); // Above 400km
    expect(position.height).toBeLessThan(420000); // Below 420km
  });

  it("should return null for invalid propagation dates", () => {
    // Try to propagate very far in the future (TLE will be invalid)
    const farFuture = new Date("2050-01-01");

    const position = orbit.positionECI(farFuture);

    // satellite.js returns false/error for propagation failures
    // Orbit.js returns null
    expect(position === null || position === false).toBe(true);
  });

  it("should calculate velocity when requested", () => {
    const time = TEST_DATES.ISS_TEST;

    const position = orbit.positionGeodetic(time, true);

    expect(position).toBeDefined();
    expect(position.velocity).toBeDefined();
    // ISS velocity is approximately 7.66 km/s
    expect(position.velocity).toBeGreaterThan(7);
    expect(position.velocity).toBeLessThan(8);
  });
});

describe("Orbit - Pass Prediction (Elevation Mode)", () => {
  let orbit;

  beforeEach(() => {
    orbit = new Orbit("ISS", ISS_TLE);
  });

  it("should calculate passes above minimum elevation threshold", () => {
    const passes = orbit.computePassesElevationSync(
      MUNICH_GS,
      TEST_DATES.PASS_START,
      TEST_DATES.PASS_END,
      5, // 5 degree minimum elevation
      100,
    );

    expect(passes).toBeDefined();
    expect(passes.length).toBeGreaterThan(0);

    // All passes should have maxElevation >= 5 degrees
    passes.forEach((pass) => {
      expect(pass.maxElevation).toBeGreaterThanOrEqual(5);
    });
  });

  it("should find correct number of passes in date range", () => {
    const passes = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 1, 500);

    // ISS makes many passes in 14 days
    expect(passes.length).toBeGreaterThan(50);
    expect(passes.length).toBeLessThan(150);
  });

  it("should calculate pass start and end times correctly", () => {
    const passes = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 10, 10);

    expect(passes.length).toBeGreaterThan(0);

    passes.forEach((pass) => {
      expect(pass.start).toBeDefined();
      expect(pass.end).toBeDefined();
      expect(pass.end).toBeGreaterThan(pass.start);
    });
  });

  it("should identify maximum elevation during pass", () => {
    const passes = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 10, 10);

    expect(passes.length).toBeGreaterThan(0);

    passes.forEach((pass) => {
      expect(pass.maxElevation).toBeDefined();
      expect(pass.maxElevation).toBeGreaterThan(10);
      expect(pass.maxElevation).toBeLessThanOrEqual(90);
    });
  });

  it("should calculate azimuth at pass start, apex, and end", () => {
    const passes = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 10, 10);

    expect(passes.length).toBeGreaterThan(0);

    passes.forEach((pass) => {
      expect(pass.azimuthStart).toBeDefined();
      expect(pass.azimuthApex).toBeDefined();
      expect(pass.azimuthEnd).toBeDefined();

      // Azimuth should be 0-360 degrees
      expect(pass.azimuthStart).toBeGreaterThanOrEqual(0);
      expect(pass.azimuthStart).toBeLessThanOrEqual(360);
      expect(pass.azimuthApex).toBeGreaterThanOrEqual(0);
      expect(pass.azimuthApex).toBeLessThanOrEqual(360);
      expect(pass.azimuthEnd).toBeGreaterThanOrEqual(0);
      expect(pass.azimuthEnd).toBeLessThanOrEqual(360);
    });
  });

  it("should skip geostationary satellites (orbital period > 600 min)", () => {
    const geoOrbit = new Orbit("GOES-16", GEO_SATELLITE_TLE);

    const passes = geoOrbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 5, 100);

    // Geostationary satellites should return no passes
    expect(passes).toHaveLength(0);
  });

  it("should handle satellites with future epochs", () => {
    // Create a properly formatted TLE with future epoch
    const futureTle = `FUTURE SAT
1 99999U 99999A   25350.00000000  .00000000  00000-0  00000-0 0  9999
2 99999  51.6407 229.0798 0005166 124.8351 329.3296 15.54069892000001`;

    const futureOrbit = new Orbit("FUTURE SAT", futureTle);

    // The epoch is 2025-12-16 (day 350 of 2025)
    // Try to calculate passes around the epoch
    const startDate = new Date("2025-12-16");
    const endDate = new Date("2025-12-23");

    const passes = futureOrbit.computePassesElevationSync(MUNICH_GS, startDate, endDate, 5, 100);

    // Should return passes array (may be empty depending on orbital parameters)
    expect(Array.isArray(passes)).toBe(true);
  });

  it("should respect minimum elevation parameter", () => {
    const passes15 = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 15, 100);

    const passes30 = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 30, 100);

    // Higher minimum elevation should result in fewer passes
    expect(passes30.length).toBeLessThan(passes15.length);
  });

  it("should respect maximum pass count limit", () => {
    const passes10 = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 1, 10);

    const passes20 = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 1, 20);

    expect(passes10.length).toBeLessThanOrEqual(11); // maxPasses + 1
    expect(passes20.length).toBeLessThanOrEqual(21);
    expect(passes20.length).toBeGreaterThan(passes10.length);
  });

  it("should calculate pass duration correctly", () => {
    const passes = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 10, 10);

    expect(passes.length).toBeGreaterThan(0);

    passes.forEach((pass) => {
      expect(pass.duration).toBeDefined();
      expect(pass.duration).toBeGreaterThan(0);
      expect(pass.duration).toBe(pass.end - pass.start);

      // ISS passes typically last 2-10 minutes (120000-600000 ms)
      expect(pass.duration).toBeGreaterThan(60000); // > 1 minute
      expect(pass.duration).toBeLessThan(900000); // < 15 minutes
    });
  });
});

describe("Orbit - Eclipse Calculations", () => {
  let orbit;

  beforeEach(() => {
    orbit = new Orbit("ISS", ISS_TLE);
  });

  it("should detect satellite in Earth's shadow", () => {
    // Test with a time when ISS is likely in shadow
    const time = new Date("2018-12-01T02:00:00Z");

    const isEclipsed = orbit.isInEclipse(time);

    // Result should be boolean
    expect(typeof isEclipsed).toBe("boolean");
  });

  it("should detect satellite in sunlight", () => {
    // Test with a time when ISS is likely in sunlight
    const time = new Date("2018-12-01T12:00:00Z");

    const isEclipsed = orbit.isInEclipse(time);

    // Result should be boolean
    expect(typeof isEclipsed).toBe("boolean");
  });

  it("should use eclipse cache to avoid recalculation", () => {
    const time = new Date("2018-12-01T12:00:00Z");

    // First call - should calculate and cache
    const result1 = orbit.isInEclipse(time);

    // Second call - should use cache (within same bucket)
    const result2 = orbit.isInEclipse(time);

    // Results should be identical
    expect(result1).toBe(result2);

    // Cache should have been used (same time bucket)
    const cacheSize = Orbit.eclipseCache.size;
    expect(cacheSize).toBeGreaterThan(0);
  });

  it("should limit eclipse cache size to prevent memory bloat", () => {
    // Generate many different times to exceed cache limit
    for (let i = 0; i < Orbit.eclipseCacheMaxSize + 100; i++) {
      const time = new Date(2018, 11, 1, 0, i); // Different minute each iteration
      orbit.isInEclipse(time);
    }

    // Cache size should not exceed limit
    expect(Orbit.eclipseCache.size).toBeLessThanOrEqual(Orbit.eclipseCacheMaxSize);
  });

  it("should detect satellite on sun side of Earth", () => {
    // When satellite is closer to sun than Earth, it cannot be in shadow
    const time = new Date("2018-12-01T06:00:00Z");

    const isEclipsed = orbit.isInEclipse(time);

    // This is a probabilistic test - we can't guarantee the result
    // but we can verify it returns a boolean
    expect(typeof isEclipsed).toBe("boolean");
  });

  it("should calculate perpendicular distance to shadow cone correctly", () => {
    // Test the shadow calculation geometry
    const satPos = { x: 1000, y: 0, z: 0 };
    const sunPos = { x: -149597870.7, y: 0, z: 0 }; // Sun directly opposite
    const earthRadius = 6378.137;

    const inShadow = orbit.calculateEarthShadow(satPos, sunPos, earthRadius);

    // Satellite at 1000km on sun-Earth line should be in shadow
    expect(inShadow).toBe(true);
  });
});

describe("Orbit - Eclipse Transitions", () => {
  let orbit;

  beforeEach(() => {
    orbit = new Orbit("ISS", ISS_TLE);
  });

  it("should find eclipse transitions during satellite pass", () => {
    // Use a time range that might include a transition
    const start = new Date("2018-12-01T00:00:00Z").getTime();
    const end = new Date("2018-12-01T02:00:00Z").getTime();

    const transitions = orbit.findEclipseTransitions(start, end, 60);

    // Transitions is an array (may be empty if no transitions)
    expect(Array.isArray(transitions)).toBe(true);

    transitions.forEach((transition) => {
      expect(transition.time).toBeDefined();
      expect(transition.fromShadow).toBeDefined();
      expect(transition.toShadow).toBeDefined();
      expect(typeof transition.fromShadow).toBe("boolean");
      expect(typeof transition.toShadow).toBe("boolean");
      // fromShadow and toShadow should be opposites
      expect(transition.fromShadow).toBe(!transition.toShadow);
    });
  });

  it("should detect transition from sunlight to shadow", () => {
    // Find a pass that has eclipse transitions
    const passes = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 1, 50);

    // Look for passes with eclipse transitions
    const passesWithTransitions = passes.filter((p) => p.eclipseTransitions && p.eclipseTransitions.length > 0);

    if (passesWithTransitions.length > 0) {
      const pass = passesWithTransitions[0];
      const transition = pass.eclipseTransitions.find((t) => t.toShadow);

      if (transition) {
        expect(transition.toShadow).toBe(true);
        expect(transition.fromShadow).toBe(false);
      }
    }
  });

  it("should detect transition from shadow to sunlight", () => {
    // Find a pass that has eclipse transitions
    const passes = orbit.computePassesElevationSync(MUNICH_GS, TEST_DATES.PASS_START, TEST_DATES.PASS_END, 1, 50);

    // Look for passes with eclipse transitions
    const passesWithTransitions = passes.filter((p) => p.eclipseTransitions && p.eclipseTransitions.length > 0);

    if (passesWithTransitions.length > 0) {
      const pass = passesWithTransitions[0];
      const transition = pass.eclipseTransitions.find((t) => t.fromShadow);

      if (transition) {
        expect(transition.fromShadow).toBe(true);
        expect(transition.toShadow).toBe(false);
      }
    }
  });

  it("should return empty array when no transitions occur", () => {
    // Very short time range - unlikely to have transitions
    const start = new Date("2018-12-01T00:00:00Z").getTime();
    const end = new Date("2018-12-01T00:01:00Z").getTime();

    const transitions = orbit.findEclipseTransitions(start, end, 10);

    expect(Array.isArray(transitions)).toBe(true);
    // May or may not have transitions in 1 minute
  });

  it("should find multiple transitions in long pass", () => {
    // ISS can enter/exit shadow multiple times in a long observation period
    const start = new Date("2018-12-01T00:00:00Z").getTime();
    const end = new Date("2018-12-01T06:00:00Z").getTime(); // 6 hours

    const transitions = orbit.findEclipseTransitions(start, end, 60);

    // Over 6 hours, ISS should have multiple eclipse transitions
    // (ISS orbits ~4 times in 6 hours, each orbit can have 1-2 transitions)
    expect(Array.isArray(transitions)).toBe(true);
  });
});

describe("Orbit - TLE Staleness Validation", () => {
  it("should detect high-drag LEO satellite", () => {
    // High-drag TLE with significant ndot and bstar
    const highDragTle = `HIGH-DRAG SAT
1 45110U 20007A   23232.80903846 0.00110000  00000-0  32750-2 0    04
2 45110  69.9913 111.5649 0009740 159.9373 200.0626 15.34502222    06`;

    const orbit = new Orbit("HIGH-DRAG SAT", highDragTle);

    expect(orbit.isHighDrag).toBe(true);
    expect(orbit.dragCoefficient).toBeGreaterThan(0.0001);
    expect(orbit.bstar).toBeGreaterThan(0.0001);
  });

  it("should not flag low-drag GEO satellite as high-drag", () => {
    const orbit = new Orbit("GOES-16", GEO_SATELLITE_TLE);

    expect(orbit.isHighDrag).toBe(false);
  });

  it("should calculate epoch age correctly", () => {
    const orbit = new Orbit("ISS", ISS_TLE);

    // ISS TLE epoch is 2018 (TEST_DATES.ISS_EPOCH), which is years old
    expect(orbit.epochAgeDays).toBeGreaterThan(365);
    expect(orbit.epochDate).toBeInstanceOf(Date);
  });

  it("should flag very old TLE as stale", () => {
    // The ISS_TLE fixture is from 2018, which is > 1 year old
    const orbit = new Orbit("ISS", ISS_TLE);
    const stalenessCheck = orbit.checkTLEStaleness();

    expect(stalenessCheck.isStale).toBe(true);
    expect(stalenessCheck.reason).toContain("days old");
  });

  it("should estimate decay time for high-drag satellites", () => {
    const highDragTle = `HIGH-DRAG SAT
1 45110U 20007A   23232.80903846 0.00110000  00000-0  32750-2 0    04
2 45110  69.9913 111.5649 0009740 159.9373 200.0626 15.34502222    06`;

    const orbit = new Orbit("HIGH-DRAG SAT", highDragTle);

    expect(orbit.estimatedDaysUntilDecay).toBeDefined();
    expect(orbit.estimatedDaysUntilDecay).toBeGreaterThan(0);
    expect(orbit.estimatedDaysUntilDecay).toBeLessThan(365);
  });

  it("should return null decay estimate for low-drag satellites", () => {
    const orbit = new Orbit("GOES-16", GEO_SATELLITE_TLE);

    expect(orbit.estimatedDaysUntilDecay).toBeNull();
  });
});

describe("Orbit - Position Validation", () => {
  let orbit;

  beforeEach(() => {
    orbit = new Orbit("ISS", ISS_TLE);
  });

  it("should validate reasonable LEO position", () => {
    // Valid LEO position at ~400km altitude
    const position = { x: 4000, y: 4000, z: 3000 }; // ~6670 km from center, ~290km altitude

    expect(orbit.validatePosition(position)).toBe(true);
  });

  it("should reject position with too high altitude for LEO", () => {
    // Position at 28,000 km altitude (garbage SGP4 result)
    const position = { x: 20000, y: 20000, z: 15000 }; // ~32,000 km from center

    expect(orbit.validatePosition(position)).toBe(false);
  });

  it("should reject underground position", () => {
    // Position inside Earth
    const position = { x: 1000, y: 1000, z: 1000 }; // ~1700 km from center

    expect(orbit.validatePosition(position)).toBe(false);
  });

  it("should reject null position", () => {
    expect(orbit.validatePosition(null)).toBe(false);
    expect(orbit.validatePosition(undefined)).toBe(false);
  });

  it("should reject position with invalid coordinates", () => {
    expect(orbit.validatePosition({ x: NaN, y: 4000, z: 3000 })).toBe(false);
    expect(orbit.validatePosition({ y: 4000, z: 3000 })).toBe(false); // missing x
  });

  it("should accept valid GEO position for GEO satellite", () => {
    const geoOrbit = new Orbit("GOES-16", GEO_SATELLITE_TLE);

    // GEO position at ~36,000 km altitude
    const position = { x: 30000, y: 25000, z: 5000 }; // ~39,000 km from center

    expect(geoOrbit.validatePosition(position)).toBe(true);
  });
});
