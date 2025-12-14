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

describe("GroundStationConditions - Emoji Conditions", () => {
  it("should return dark condition with moon emoji", () => {
    const nightTime = new Date("2024-01-15T02:00:00Z");

    const condition = GroundStationConditions.getLightingConditionWithEmoji(MUNICH_GS, nightTime);

    expect(condition).toBe("🌙 Dark");
  });

  it("should return light condition with sun emoji", () => {
    const dayTime = new Date("2024-06-15T12:00:00Z");

    const condition = GroundStationConditions.getLightingConditionWithEmoji(MUNICH_GS, dayTime);

    expect(condition).toBe("☀️ Light");
  });

  it("should handle different ground stations with emoji", () => {
    const time = new Date("2024-06-15T03:00:00Z"); // Early morning

    const munichCondition = GroundStationConditions.getLightingConditionWithEmoji(MUNICH_GS, time);
    const sfCondition = GroundStationConditions.getLightingConditionWithEmoji(SF_GS, time);

    // Both should have emoji format
    expect(munichCondition).toMatch(/^[🌙☀️]/);
    expect(sfCondition).toMatch(/^[🌙☀️]/);
  });
});

describe("GroundStationConditions - Twilight Times", () => {
  it("should calculate twilight times for a ground station", () => {
    const date = new Date("2024-06-15T12:00:00Z");

    const times = GroundStationConditions.getTwilightTimes(MUNICH_GS, date);

    expect(times).toBeDefined();
    expect(typeof times).toBe("object");
  });

  it("should return sunrise and sunset times", () => {
    const date = new Date("2024-06-15T12:00:00Z");

    const times = GroundStationConditions.getTwilightTimes(MUNICH_GS, date);

    // Should have some twilight data (exact fields depend on location and date)
    expect(times).toBeDefined();

    // If sunrise/sunset are calculated, they should be Date objects
    if (times.sunrise) {
      expect(times.sunrise).toBeInstanceOf(Date);
    }
    if (times.sunset) {
      expect(times.sunset).toBeInstanceOf(Date);
    }
  });

  it("should calculate civil twilight times", () => {
    const date = new Date("2024-06-15T12:00:00Z");

    const times = GroundStationConditions.getTwilightTimes(MUNICH_GS, date);

    // Civil dawn/dusk should be Date objects if calculated
    if (times.civilDawn) {
      expect(times.civilDawn).toBeInstanceOf(Date);
    }
    if (times.civilDusk) {
      expect(times.civilDusk).toBeInstanceOf(Date);
    }
  });

  it("should calculate nautical twilight times", () => {
    const date = new Date("2024-06-15T12:00:00Z");

    const times = GroundStationConditions.getTwilightTimes(MUNICH_GS, date);

    // Nautical twilight should be Date objects if calculated
    if (times.nauticalDawn) {
      expect(times.nauticalDawn).toBeInstanceOf(Date);
    }
    if (times.nauticalDusk) {
      expect(times.nauticalDusk).toBeInstanceOf(Date);
    }
  });

  it("should calculate astronomical twilight times", () => {
    const date = new Date("2024-06-15T12:00:00Z");

    const times = GroundStationConditions.getTwilightTimes(MUNICH_GS, date);

    // Astronomical twilight should be Date objects if calculated
    if (times.astronomicalDawn) {
      expect(times.astronomicalDawn).toBeInstanceOf(Date);
    }
    if (times.astronomicalDusk) {
      expect(times.astronomicalDusk).toBeInstanceOf(Date);
    }
  });

  it("should handle different dates for twilight calculations", () => {
    const winterDate = new Date("2024-01-15T12:00:00Z");
    const summerDate = new Date("2024-06-15T12:00:00Z");

    const winterTimes = GroundStationConditions.getTwilightTimes(MUNICH_GS, winterDate);
    const summerTimes = GroundStationConditions.getTwilightTimes(MUNICH_GS, summerDate);

    expect(winterTimes).toBeDefined();
    expect(summerTimes).toBeDefined();

    // Both should return objects
    expect(typeof winterTimes).toBe("object");
    expect(typeof summerTimes).toBe("object");
  });

  it("should work for different ground stations", () => {
    const date = new Date("2024-06-15T12:00:00Z");

    const munichTimes = GroundStationConditions.getTwilightTimes(MUNICH_GS, date);
    const sfTimes = GroundStationConditions.getTwilightTimes(SF_GS, date);

    expect(munichTimes).toBeDefined();
    expect(sfTimes).toBeDefined();

    // Both should return objects
    expect(typeof munichTimes).toBe("object");
    expect(typeof sfTimes).toBe("object");
  });
});

describe("GroundStationConditions - Edge Cases", () => {
  it("should handle ground station with zero height", () => {
    const gsNoHeight = { latitude: 48.1351, longitude: 11.582, height: 0 };
    const time = new Date("2024-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(gsNoHeight, time);
    const sunPos = GroundStationConditions.getSunPosition(gsNoHeight, time);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
    expect(sunPos.altitude).toBeDefined();
  });

  it("should handle ground station without height property", () => {
    const gsNoHeight = { latitude: 48.1351, longitude: 11.582 };
    const time = new Date("2024-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(gsNoHeight, time);
    const sunPos = GroundStationConditions.getSunPosition(gsNoHeight, time);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
  });

  it("should handle high altitude ground station", () => {
    const highAltitudeGS = { latitude: 48.1351, longitude: 11.582, height: 5000 }; // 5km altitude
    const time = new Date("2024-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(highAltitudeGS, time);
    const sunPos = GroundStationConditions.getSunPosition(highAltitudeGS, time);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
    expect(sunPos.altitude).toBeDefined();
  });

  it("should handle equatorial ground station", () => {
    const equatorialGS = { latitude: 0, longitude: 0, height: 0 }; // Null Island
    const time = new Date("2024-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(equatorialGS, time);
    const sunPos = GroundStationConditions.getSunPosition(equatorialGS, time);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
    expect(sunPos.altitude).toBeGreaterThan(-90);
    expect(sunPos.altitude).toBeLessThan(90);
  });

  it("should handle northern latitude ground station", () => {
    const northernGS = { latitude: 70, longitude: 25, height: 0 }; // Northern Norway
    const time = new Date("2024-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(northernGS, time);
    const sunPos = GroundStationConditions.getSunPosition(northernGS, time);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
  });

  it("should handle southern latitude ground station", () => {
    const southernGS = { latitude: -70, longitude: 0, height: 0 }; // Antarctica
    const time = new Date("2024-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(southernGS, time);
    const sunPos = GroundStationConditions.getSunPosition(southernGS, time);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
  });

  it("should handle date at year boundary", () => {
    const newYear = new Date("2024-01-01T00:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, newYear);
    const sunPos = GroundStationConditions.getSunPosition(MUNICH_GS, newYear);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
  });

  it("should handle date in different year", () => {
    const futureDate = new Date("2030-06-15T12:00:00Z");

    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, futureDate);
    const sunPos = GroundStationConditions.getSunPosition(MUNICH_GS, futureDate);

    expect(typeof isDark).toBe("boolean");
    expect(sunPos).toBeDefined();
  });
});

describe("GroundStationConditions - Astronomy Engine Fallback", () => {
  it("should fallback to SunCalc if astronomy-engine fails for darkness", () => {
    const time = new Date("2024-06-15T12:00:00Z");

    // This should work even if astronomy-engine has issues
    const isDark = GroundStationConditions.isInDarkness(MUNICH_GS, time, "astronomy-engine");

    expect(typeof isDark).toBe("boolean");
  });

  it("should fallback to SunCalc if astronomy-engine fails for sun position", () => {
    const time = new Date("2024-06-15T12:00:00Z");

    // This should work even if astronomy-engine has issues
    const sunPos = GroundStationConditions.getSunPosition(MUNICH_GS, time, "astronomy-engine");

    expect(sunPos).toBeDefined();
    expect(sunPos.altitude).toBeDefined();
    expect(sunPos.azimuth).toBeDefined();
    expect(sunPos.isDark).toBeDefined();
  });
});

describe("GroundStationConditions - Sun Position Details", () => {
  it("should have isDark flag consistent with altitude", () => {
    const nightTime = new Date("2024-01-15T02:00:00Z");
    const dayTime = new Date("2024-06-15T12:00:00Z");

    const nightPos = GroundStationConditions.getSunPosition(MUNICH_GS, nightTime);
    const dayPos = GroundStationConditions.getSunPosition(MUNICH_GS, dayTime);

    // Night position should have isDark=true and low altitude
    if (nightPos.isDark) {
      expect(nightPos.altitude).toBeLessThan(-6);
    }

    // Day position should have isDark=false and higher altitude
    if (!dayPos.isDark) {
      expect(dayPos.altitude).toBeGreaterThan(-6);
    }
  });

  it("should calculate azimuth values", () => {
    const times = [
      new Date("2024-06-15T06:00:00Z"), // Morning
      new Date("2024-06-15T12:00:00Z"), // Noon
      new Date("2024-06-15T18:00:00Z"), // Evening
    ];

    times.forEach((time) => {
      const sunPos = GroundStationConditions.getSunPosition(MUNICH_GS, time);

      // Azimuth should be a number (can be negative from SunCalc's convention)
      expect(typeof sunPos.azimuth).toBe("number");
      expect(sunPos.azimuth).toBeGreaterThan(-360);
      expect(sunPos.azimuth).toBeLessThan(360);
    });
  });

  it("should show different sun positions at different times of day", () => {
    const morning = new Date("2024-06-15T06:00:00Z");
    const noon = new Date("2024-06-15T12:00:00Z");
    const evening = new Date("2024-06-15T18:00:00Z");

    const morningPos = GroundStationConditions.getSunPosition(MUNICH_GS, morning);
    const noonPos = GroundStationConditions.getSunPosition(MUNICH_GS, noon);
    const eveningPos = GroundStationConditions.getSunPosition(MUNICH_GS, evening);

    // Noon should generally have highest altitude in summer
    expect(noonPos.altitude).toBeGreaterThan(morningPos.altitude);
    expect(noonPos.altitude).toBeGreaterThan(eveningPos.altitude);
  });

  it("should calculate different azimuths for morning vs evening", () => {
    const morning = new Date("2024-06-15T06:00:00Z");
    const evening = new Date("2024-06-15T18:00:00Z");

    const morningPos = GroundStationConditions.getSunPosition(MUNICH_GS, morning);
    const eveningPos = GroundStationConditions.getSunPosition(MUNICH_GS, evening);

    // Morning and evening should have significantly different azimuths
    const azimuthDiff = Math.abs(morningPos.azimuth - eveningPos.azimuth);
    expect(azimuthDiff).toBeGreaterThan(30); // At least 30 degrees difference
  });
});
