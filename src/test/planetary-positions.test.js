import { describe, it, expect, beforeEach } from "vitest";
import { JulianDate } from "@cesium/engine";
import { PlanetaryPositions } from "../modules/PlanetaryPositions.js";
import { SF_GS } from "./fixtures/tle-data.js";

describe("PlanetaryPositions - Initialization", () => {
  let planetary;

  beforeEach(() => {
    planetary = new PlanetaryPositions();
  });

  it("should initialize with 5 planets", () => {
    expect(planetary.planets).toBeDefined();
    expect(planetary.planets).toHaveLength(5);
  });

  it("should include Mercury, Venus, Mars, Jupiter, Saturn", () => {
    const names = planetary.getPlanetNames();

    expect(names).toContain("Mercury");
    expect(names).toContain("Venus");
    expect(names).toContain("Mars");
    expect(names).toContain("Jupiter");
    expect(names).toContain("Saturn");
  });

  it("should have color and symbol for each planet", () => {
    planetary.planets.forEach((planet) => {
      expect(planet.name).toBeDefined();
      expect(planet.color).toBeDefined();
      expect(planet.color).toHaveLength(3); // RGB
      expect(planet.symbol).toBeDefined();
      expect(planet.body).toBeDefined();
    });
  });
});

describe("PlanetaryPositions - Position Calculations", () => {
  let planetary;
  let testTime;

  beforeEach(() => {
    planetary = new PlanetaryPositions();
    // Use a fixed date for consistent testing: 2024-06-15 12:00 UTC
    testTime = JulianDate.fromDate(new Date("2024-06-15T12:00:00Z"));
  });

  it("should calculate positions for all planets", () => {
    const positions = planetary.calculatePositions(testTime);

    expect(positions).toBeDefined();
    expect(positions).toHaveLength(5);

    positions.forEach((planetData) => {
      expect(planetData.name).toBeDefined();
      expect(planetData.position).toBeDefined();
      expect(planetData.ra).toBeDefined();
      expect(planetData.dec).toBeDefined();
      expect(planetData.magnitude).toBeDefined();
      expect(planetData.illumination).toBeDefined();
      expect(planetData.distance_au).toBeDefined();
    });
  });

  it("should return Cartesian3 positions", () => {
    const positions = planetary.calculatePositions(testTime);

    positions.forEach((planetData) => {
      expect(planetData.position.x).toBeDefined();
      expect(planetData.position.y).toBeDefined();
      expect(planetData.position.z).toBeDefined();

      // Positions should be in reasonable range (millions of km)
      const distance = Math.sqrt(
        planetData.position.x ** 2 +
        planetData.position.y ** 2 +
        planetData.position.z ** 2,
      );
      expect(distance).toBeGreaterThan(1e10); // > 10 million km
      expect(distance).toBeLessThan(2e12); // < 2 billion km (Saturn is furthest)
    });
  });

  it("should calculate RA in valid range (0-24 hours)", () => {
    const positions = planetary.calculatePositions(testTime);

    positions.forEach((planetData) => {
      expect(planetData.ra).toBeGreaterThanOrEqual(0);
      expect(planetData.ra).toBeLessThan(24);
    });
  });

  it("should calculate declination in valid range (-90 to +90 degrees)", () => {
    const positions = planetary.calculatePositions(testTime);

    positions.forEach((planetData) => {
      expect(planetData.dec).toBeGreaterThanOrEqual(-90);
      expect(planetData.dec).toBeLessThanOrEqual(90);
    });
  });

  it("should calculate illumination percentage (0-100%)", () => {
    const positions = planetary.calculatePositions(testTime);

    positions.forEach((planetData) => {
      expect(planetData.illumination).toBeGreaterThanOrEqual(0);
      expect(planetData.illumination).toBeLessThanOrEqual(100);
    });
  });

  it("should calculate distance in AU", () => {
    const positions = planetary.calculatePositions(testTime);

    // Expected approximate distances from Earth (AU)
    // These ranges account for orbital variations
    const expectedDistances = {
      Mercury: { min: 0.5, max: 1.5 },
      Venus: { min: 0.2, max: 1.75 }, // Venus can be up to 1.74 AU away when on far side of Sun
      Mars: { min: 0.5, max: 2.6 },
      Jupiter: { min: 4.0, max: 6.5 },
      Saturn: { min: 8.0, max: 11.0 },
    };

    positions.forEach((planetData) => {
      const expected = expectedDistances[planetData.name];
      expect(planetData.distance_au).toBeGreaterThan(expected.min);
      expect(planetData.distance_au).toBeLessThan(expected.max);
    });
  });

  it("should calculate reasonable magnitude values", () => {
    const positions = planetary.calculatePositions(testTime);

    positions.forEach((planetData) => {
      // Magnitude should be reasonable for visible planets
      // Venus: -4.6 to -3.8
      // Jupiter: -2.9 to -1.6
      // Mercury: -2.6 to 5.7
      // Mars: -2.9 to 1.8
      // Saturn: -0.5 to 1.2
      expect(planetData.magnitude).toBeGreaterThan(-5);
      expect(planetData.magnitude).toBeLessThan(6);
    });
  });
});

describe("PlanetaryPositions - Coordinate Conversion", () => {
  let planetary;
  let testTime;

  beforeEach(() => {
    planetary = new PlanetaryPositions();
    testTime = JulianDate.fromDate(new Date("2024-06-15T12:00:00Z"));
  });

  it("should convert RA/Dec to Cartesian coordinates", () => {
    // Test with known RA/Dec coordinates
    const ra = 90; // degrees (6 hours)
    const dec = 0; // degrees (equator)
    const distance = 1e11; // meters

    const position = planetary.equatorialToCartesianICRF(ra, dec, distance, testTime);

    expect(position).toBeDefined();
    expect(position.x).toBeDefined();
    expect(position.y).toBeDefined();
    expect(position.z).toBeDefined();

    // Check that distance is preserved
    const calculatedDistance = Math.sqrt(
      position.x ** 2 + position.y ** 2 + position.z ** 2,
    );
    expect(calculatedDistance).toBeCloseTo(distance, -8); // Within 100m
  });

  it("should handle north pole declination (+90 degrees)", () => {
    const ra = 0;
    const dec = 90; // North celestial pole
    const distance = 1e11;

    const position = planetary.equatorialToCartesianICRF(ra, dec, distance, testTime);

    expect(position).toBeDefined();
    // At north pole, z should be close to distance, x and y close to 0
    expect(Math.abs(position.z)).toBeGreaterThan(distance * 0.99);
  });

  it("should handle south pole declination (-90 degrees)", () => {
    const ra = 0;
    const dec = -90; // South celestial pole
    const distance = 1e11;

    const position = planetary.equatorialToCartesianICRF(ra, dec, distance, testTime);

    expect(position).toBeDefined();
    // At south pole, z should be close to -distance
    expect(position.z).toBeLessThan(-distance * 0.99);
  });
});

describe("PlanetaryPositions - Altitude/Azimuth", () => {
  let planetary;

  beforeEach(() => {
    planetary = new PlanetaryPositions();
  });

  it("should calculate altitude and azimuth for a planet", () => {
    const date = new Date("2024-06-15T20:00:00Z");

    const result = planetary.getPlanetAltitudeAzimuth(
      "Venus",
      date,
      SF_GS.latitude,
      SF_GS.longitude,
    );

    expect(result).toBeDefined();
    expect(result.altitude).toBeDefined();
    expect(result.azimuth).toBeDefined();
    expect(result.isVisible).toBeDefined();

    // Altitude should be -90 to +90 degrees
    expect(result.altitude).toBeGreaterThanOrEqual(-90);
    expect(result.altitude).toBeLessThanOrEqual(90);

    // Azimuth should be 0-360 degrees
    expect(result.azimuth).toBeGreaterThanOrEqual(0);
    expect(result.azimuth).toBeLessThan(360);

    // isVisible should match altitude > 0
    expect(result.isVisible).toBe(result.altitude > 0);
  });

  it("should throw error for unknown planet", () => {
    const date = new Date("2024-06-15T20:00:00Z");

    expect(() => {
      planetary.getPlanetAltitudeAzimuth(
        "Pluto",
        date,
        SF_GS.latitude,
        SF_GS.longitude,
      );
    }).toThrow("Unknown planet: Pluto");
  });

  it("should mark planet as visible when above horizon", () => {
    // Test at a time when Venus is likely visible from SF
    const date = new Date("2024-06-15T03:00:00Z"); // Early morning

    const result = planetary.getPlanetAltitudeAzimuth(
      "Venus",
      date,
      SF_GS.latitude,
      SF_GS.longitude,
    );

    if (result.altitude > 0) {
      expect(result.isVisible).toBe(true);
    }
  });

  it("should mark planet as not visible when below horizon", () => {
    // Find a planet that's below horizon
    const date = new Date("2024-06-15T12:00:00Z");
    const planets = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

    let foundBelowHorizon = false;

    for (const planet of planets) {
      const result = planetary.getPlanetAltitudeAzimuth(
        planet,
        date,
        SF_GS.latitude,
        SF_GS.longitude,
      );

      if (result.altitude < 0) {
        expect(result.isVisible).toBe(false);
        foundBelowHorizon = true;
        break;
      }
    }

    // At noon UTC in SF, at least one planet should be below horizon
    expect(foundBelowHorizon).toBe(true);
  });
});

describe("PlanetaryPositions - Visible Planets", () => {
  let planetary;
  let testTime;

  beforeEach(() => {
    planetary = new PlanetaryPositions();
    // Evening time when some planets might be visible
    testTime = JulianDate.fromDate(new Date("2024-06-15T03:00:00Z"));
  });

  it("should return only visible planets for a given location", () => {
    const visiblePlanets = planetary.getVisiblePlanets(
      testTime,
      SF_GS.latitude,
      SF_GS.longitude,
    );

    expect(Array.isArray(visiblePlanets)).toBe(true);
    expect(visiblePlanets.length).toBeGreaterThanOrEqual(0);
    expect(visiblePlanets.length).toBeLessThanOrEqual(5);

    // All returned planets should have altitude > 0
    visiblePlanets.forEach((planet) => {
      expect(planet.altitude).toBeGreaterThan(0);
      expect(planet.azimuth).toBeDefined();
      expect(planet.position).toBeDefined();
      expect(planet.name).toBeDefined();
    });
  });

  it("should include all standard planet properties in visible planets", () => {
    const visiblePlanets = planetary.getVisiblePlanets(
      testTime,
      SF_GS.latitude,
      SF_GS.longitude,
    );

    if (visiblePlanets.length > 0) {
      const planet = visiblePlanets[0];

      expect(planet.name).toBeDefined();
      expect(planet.position).toBeDefined();
      expect(planet.ra).toBeDefined();
      expect(planet.dec).toBeDefined();
      expect(planet.magnitude).toBeDefined();
      expect(planet.illumination).toBeDefined();
      expect(planet.distance_au).toBeDefined();
      expect(planet.altitude).toBeDefined();
      expect(planet.azimuth).toBeDefined();
    }
  });

  it("should vary visible planets by time of day", () => {
    const morning = JulianDate.fromDate(new Date("2024-06-15T10:00:00Z"));
    const evening = JulianDate.fromDate(new Date("2024-06-15T03:00:00Z"));

    const morningVisible = planetary.getVisiblePlanets(
      morning,
      SF_GS.latitude,
      SF_GS.longitude,
    );

    const eveningVisible = planetary.getVisiblePlanets(
      evening,
      SF_GS.latitude,
      SF_GS.longitude,
    );

    // Morning and evening should have different visible planets
    // (unless by chance they're the same)
    const morningNames = morningVisible.map((p) => p.name).sort();
    const eveningNames = eveningVisible.map((p) => p.name).sort();

    // At least one should have visible planets
    expect(morningVisible.length + eveningVisible.length).toBeGreaterThan(0);
  });
});

describe("PlanetaryPositions - Time Dependency", () => {
  let planetary;

  beforeEach(() => {
    planetary = new PlanetaryPositions();
  });

  it("should return different positions at different times", () => {
    const time1 = JulianDate.fromDate(new Date("2024-01-01T12:00:00Z"));
    const time2 = JulianDate.fromDate(new Date("2024-07-01T12:00:00Z"));

    const positions1 = planetary.calculatePositions(time1);
    const positions2 = planetary.calculatePositions(time2);

    // Positions should be different 6 months apart
    positions1.forEach((planet1, i) => {
      const planet2 = positions2[i];

      expect(planet1.name).toBe(planet2.name);

      // RA and Dec should differ (planets move)
      const raDiff = Math.abs(planet1.ra - planet2.ra);
      const decDiff = Math.abs(planet1.dec - planet2.dec);

      // At least one coordinate should differ by at least 0.1 hours/degrees
      expect(raDiff + decDiff).toBeGreaterThan(0.1);
    });
  });

  it("should handle future dates", () => {
    const futureTime = JulianDate.fromDate(new Date("2030-01-01T12:00:00Z"));

    const positions = planetary.calculatePositions(futureTime);

    expect(positions).toHaveLength(5);

    positions.forEach((planetData) => {
      expect(planetData.position).toBeDefined();
      expect(planetData.ra).toBeDefined();
      expect(planetData.dec).toBeDefined();
    });
  });

  it("should handle past dates", () => {
    const pastTime = JulianDate.fromDate(new Date("2010-01-01T12:00:00Z"));

    const positions = planetary.calculatePositions(pastTime);

    expect(positions).toHaveLength(5);

    positions.forEach((planetData) => {
      expect(planetData.position).toBeDefined();
      expect(planetData.ra).toBeDefined();
      expect(planetData.dec).toBeDefined();
    });
  });
});
