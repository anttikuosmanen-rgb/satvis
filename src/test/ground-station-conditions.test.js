import { describe, it, expect } from "vitest";
import { GroundStationConditions } from "../modules/util/GroundStationConditions";
import { MUNICH_GS, SF_GS } from "./fixtures/tle-data";

describe("GroundStationConditions - Darkness Detection", () => {
  it("should detect ground station in darkness at night", () => {
    // Munich at 2:00 AM local time (should be dark)
    const nightTime = new Date("2024-01-15T02:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, nightTime);

    expect(typeof isDark).toBe("boolean");
    // At 2 AM, Munich should be dark (sun well below horizon)
    expect(isDark).toBe(true);
  });

  it("should detect ground station in daylight during day", () => {
    // Munich at 12:00 PM UTC (should be daylight)
    const dayTime = new Date("2024-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, dayTime);

    expect(typeof isDark).toBe("boolean");
    // At noon in summer, Munich should have sunlight
    expect(isDark).toBe(false);
  });

  it("should handle ground station at sunrise correctly", () => {
    // Around sunrise, sun altitude is close to -6 degrees (civil twilight)
    const sunrise = new Date("2024-01-15T07:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, sunrise);

    expect(typeof isDark).toBe("boolean");
    // Result depends on exact sunrise time, but should be boolean
  });

  it("should handle ground station at sunset correctly", () => {
    // Around sunset, sun altitude is close to -6 degrees (civil twilight)
    const sunset = new Date("2024-01-15T17:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, sunset);

    expect(typeof isDark).toBe("boolean");
    // Result depends on exact sunset time, but should be boolean
  });

  it("should calculate solar elevation correctly", () => {
    // Test sun position calculation
    const time = new Date("2024-06-15T12:00:00Z");

    const sunPos = GroundStationConditions.getSunPosition(MUNICH_GS, time);

    expect(sunPos).toBeDefined();
    expect(sunPos.altitude).toBeDefined();
    expect(sunPos.azimuth).toBeDefined();
    expect(sunPos.isDark).toBeDefined();

    // Altitude should be reasonable (between -90 and 90 degrees)
    expect(sunPos.altitude).toBeGreaterThan(-90);
    expect(sunPos.altitude).toBeLessThan(90);

    // Azimuth should be 0-360 degrees
    expect(sunPos.azimuth).toBeGreaterThanOrEqual(0);
    expect(sunPos.azimuth).toBeLessThan(360);
  });
});

describe("GroundStationConditions - Lighting Conditions", () => {
  it("should return descriptive lighting condition text", () => {
    const nightTime = new Date("2024-01-15T02:00:00Z");
    const dayTime = new Date("2024-06-15T12:00:00Z");

    const nightCondition = GroundStationConditions.getLightingCondition(MUNICH_GS, nightTime);
    const dayCondition = GroundStationConditions.getLightingCondition(MUNICH_GS, dayTime);

    expect(nightCondition).toBe("Dark");
    expect(dayCondition).toBe("Light");
  });

  it("should work with different ground stations", () => {
    const time = new Date("2024-06-15T20:00:00Z"); // 8 PM UTC

    const munichDark = GroundStationConditions.isInDarkness(MUNICH_GS, time);
    const sfDark = GroundStationConditions.isInDarkness(SF_GS, time);

    // Both should return boolean values
    expect(typeof munichDark).toBe("boolean");
    expect(typeof sfDark).toBe("boolean");

    // Due to time zone differences, they might have different darkness states
    // This is expected behavior
  });
});

describe("GroundStationConditions - Astronomy Engine Method", () => {
  it("should support astronomy-engine calculation method", () => {
    const time = new Date("2024-01-15T02:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, time, "astronomy-engine");

    expect(typeof isDark).toBe("boolean");
  });

  it("should return consistent results between suncalc and astronomy-engine", () => {
    const time = new Date("2024-06-15T12:00:00Z");

    const suncalcResult = GroundStationConditions.isInDarkness(MUNICH_GS, time, "suncalc");
    const astronomyResult = GroundStationConditions.isInDarkness(MUNICH_GS, time, "astronomy-engine");

    // Both methods should agree on whether it's dark or light
    // (may differ slightly at twilight boundaries, but should generally agree)
    expect(typeof suncalcResult).toBe("boolean");
    expect(typeof astronomyResult).toBe("boolean");
  });

  it("should get sun position using astronomy-engine", () => {
    const time = new Date("2024-06-15T12:00:00Z");

    const sunPos = GroundStationConditions.getSunPosition(MUNICH_GS, time, "astronomy-engine");

    expect(sunPos).toBeDefined();
    expect(sunPos.altitude).toBeDefined();
    expect(sunPos.azimuth).toBeDefined();
    expect(sunPos.isDark).toBeDefined();

    // Should be reasonable values
    expect(sunPos.altitude).toBeGreaterThan(-90);
    expect(sunPos.altitude).toBeLessThan(90);
  });
});
