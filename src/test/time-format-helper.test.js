import { describe, test, expect } from "vitest";
import { TimeFormatHelper } from "../modules/util/TimeFormatHelper.js";

describe("TimeFormatHelper", () => {
  describe("getTimezoneFromCoordinates", () => {
    test("returns correct timezone for Helsinki, Finland", () => {
      const timezone = TimeFormatHelper.getTimezoneFromCoordinates(60.17, 24.94);
      expect(timezone).toBe("Europe/Helsinki");
    });

    test("returns correct timezone for New York, USA", () => {
      const timezone = TimeFormatHelper.getTimezoneFromCoordinates(40.71, -74.01);
      expect(timezone).toBe("America/New_York");
    });

    test("returns correct timezone for Tokyo, Japan", () => {
      const timezone = TimeFormatHelper.getTimezoneFromCoordinates(35.68, 139.76);
      expect(timezone).toBe("Asia/Tokyo");
    });

    test("returns correct timezone for Sydney, Australia", () => {
      const timezone = TimeFormatHelper.getTimezoneFromCoordinates(-33.87, 151.21);
      expect(timezone).toBe("Australia/Sydney");
    });

    test("returns fallback timezone for Pacific Ocean coordinates", () => {
      // Middle of Pacific Ocean - should fallback to longitude-based offset
      const timezone = TimeFormatHelper.getTimezoneFromCoordinates(0, -170);
      // Longitude -170 / 15 = -11.33, rounds to -11, so Etc/GMT+11
      expect(timezone).toBe("Etc/GMT+11");
    });

    test("returns UTC for coordinates at 0,0 (Gulf of Guinea)", () => {
      const timezone = TimeFormatHelper.getTimezoneFromCoordinates(0, 0);
      // This is actually ocean, might return "Etc/GMT" or similar
      expect(timezone).toMatch(/UTC|GMT/);
    });
  });

  describe("getTimezoneOffset", () => {
    test("returns 'UTC' for null timezone", () => {
      const offset = TimeFormatHelper.getTimezoneOffset(null);
      expect(offset).toBe("UTC");
    });

    test("returns 'UTC' for UTC timezone", () => {
      const date = new Date("2025-01-15T12:00:00Z");
      const offset = TimeFormatHelper.getTimezoneOffset("UTC", date);
      expect(offset).toBe("UTC");
    });

    test("returns positive offset for Eastern European timezone", () => {
      const date = new Date("2025-01-15T12:00:00Z"); // Winter time
      const offset = TimeFormatHelper.getTimezoneOffset("Europe/Helsinki", date);
      // Helsinki is UTC+2 in winter
      expect(offset).toBe("UTC+2");
    });

    test("returns negative offset for US Eastern timezone", () => {
      const date = new Date("2025-01-15T12:00:00Z"); // Winter time
      const offset = TimeFormatHelper.getTimezoneOffset("America/New_York", date);
      // New York is UTC-5 in winter (EST)
      expect(offset).toBe("UTC-5");
    });

    test("returns fractional offset for India timezone", () => {
      const date = new Date("2025-01-15T12:00:00Z");
      const offset = TimeFormatHelper.getTimezoneOffset("Asia/Kolkata", date);
      // India is UTC+5:30
      expect(offset).toBe("UTC+5:30");
    });

    test("returns fractional offset for Nepal timezone", () => {
      const date = new Date("2025-01-15T12:00:00Z");
      const offset = TimeFormatHelper.getTimezoneOffset("Asia/Kathmandu", date);
      // Nepal is UTC+5:45
      expect(offset).toBe("UTC+5:45");
    });

    test("handles DST transitions correctly", () => {
      // Summer date when DST is active
      const summerDate = new Date("2025-07-15T12:00:00Z");
      const offset = TimeFormatHelper.getTimezoneOffset("Europe/Helsinki", summerDate);
      // Helsinki is UTC+3 in summer
      expect(offset).toBe("UTC+3");
    });
  });

  describe("getTimezoneAbbreviation", () => {
    test("returns timezone abbreviation for null timezone", () => {
      const abbr = TimeFormatHelper.getTimezoneAbbreviation(null);
      // Should return "Local" or system timezone abbreviation
      expect(abbr).toBeTruthy();
      expect(typeof abbr).toBe("string");
    });

    test("returns timezone abbreviation for UTC", () => {
      const abbr = TimeFormatHelper.getTimezoneAbbreviation("UTC");
      expect(abbr).toMatch(/UTC|GMT/);
    });

    test("returns timezone abbreviation for US Eastern", () => {
      const abbr = TimeFormatHelper.getTimezoneAbbreviation("America/New_York");
      // Could be EST or EDT depending on when test runs
      expect(abbr).toMatch(/EST|EDT/);
    });
  });

  describe("formatTime", () => {
    test("formats time in UTC mode with default format", () => {
      const timestamp = new Date("2025-01-15T14:30:45Z");
      const formatted = TimeFormatHelper.formatTime(timestamp, false);
      expect(formatted).toBe("15.01 14:30:45");
    });

    test("formats time in UTC mode with timezone suffix", () => {
      const timestamp = new Date("2025-01-15T14:30:45Z");
      const formatted = TimeFormatHelper.formatTime(timestamp, false, "DD.MM HH:mm:ss", true);
      expect(formatted).toBe("15.01 14:30:45 UTC");
    });

    test("formats time in local time mode with ground station coordinates", () => {
      const timestamp = new Date("2025-01-15T12:00:00Z");
      const groundStationPosition = { latitude: 60.17, longitude: 24.94 }; // Helsinki
      const formatted = TimeFormatHelper.formatTime(timestamp, true, "DD.MM HH:mm:ss", false, groundStationPosition);

      // Helsinki is UTC+2 in winter, so 12:00 UTC = 14:00 local
      expect(formatted).toContain("14:00:00");
      expect(formatted).toContain("15.01");
    });

    test("formats time in local time mode with timezone suffix", () => {
      const timestamp = new Date("2025-01-15T12:00:00Z");
      const groundStationPosition = { latitude: 60.17, longitude: 24.94 }; // Helsinki
      const formatted = TimeFormatHelper.formatTime(timestamp, true, "DD.MM HH:mm:ss", true, groundStationPosition);

      expect(formatted).toContain("14:00:00");
      expect(formatted).toContain("UTC+2");
    });

    test("handles custom format string", () => {
      const timestamp = new Date("2025-01-15T14:30:45Z");
      const formatted = TimeFormatHelper.formatTime(timestamp, false, "YYYY-MM-DD HH:mm");
      expect(formatted).toBe("2025-01-15 14:30");
    });
  });

  describe("formatTransitionTime", () => {
    test("formats transition time in UTC mode", () => {
      const timestamp = new Date("2025-01-15T14:30:45Z");
      const formatted = TimeFormatHelper.formatTransitionTime(timestamp, false);
      expect(formatted).toBe("14:30:45 UTC");
    });

    test("formats transition time in local time mode", () => {
      const timestamp = new Date("2025-01-15T12:00:00Z");
      const groundStationPosition = { latitude: 60.17, longitude: 24.94 }; // Helsinki
      const formatted = TimeFormatHelper.formatTransitionTime(timestamp, true, groundStationPosition);

      // Should only include time, not date
      expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}/);
      expect(formatted).toContain("UTC+2");
      expect(formatted).toContain("14:00:00");
    });

    test("does not include date in output", () => {
      const timestamp = new Date("2025-01-15T14:30:45Z");
      const formatted = TimeFormatHelper.formatTransitionTime(timestamp, false);
      // Should not contain date components like "15.01" or "2025-01-15"
      expect(formatted).not.toContain("15.01");
      expect(formatted).not.toContain("2025");
      expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("formatPassTime", () => {
    test("formats pass time in UTC mode with timezone", () => {
      const timestamp = new Date("2025-01-15T14:30:45Z");
      const formatted = TimeFormatHelper.formatPassTime(timestamp, false);
      expect(formatted).toBe("15.01 14:30:45 UTC");
    });

    test("formats pass time in local time mode with ground station", () => {
      const timestamp = new Date("2025-01-15T12:00:00Z");
      const groundStationPosition = { latitude: 60.17, longitude: 24.94 }; // Helsinki
      const formatted = TimeFormatHelper.formatPassTime(timestamp, true, groundStationPosition);

      expect(formatted).toContain("14:00:00");
      expect(formatted).toContain("UTC+2");
      expect(formatted).toContain("15.01");
    });
  });

  describe("formatTLEEpoch", () => {
    test("formats TLE epoch time in UTC with full datetime", () => {
      const timestamp = new Date("2025-01-15T14:30:45Z");
      const formatted = TimeFormatHelper.formatTLEEpoch(timestamp);
      expect(formatted).toBe("2025-01-15 14:30:45 UTC");
    });

    test("always uses UTC regardless of local timezone", () => {
      const timestamp = new Date("2025-06-20T18:45:30Z");
      const formatted = TimeFormatHelper.formatTLEEpoch(timestamp);
      expect(formatted).toBe("2025-06-20 18:45:30 UTC");
      expect(formatted).toContain("UTC");
    });

    test("includes seconds in output", () => {
      const timestamp = new Date("2025-01-15T14:30:00Z");
      const formatted = TimeFormatHelper.formatTLEEpoch(timestamp);
      expect(formatted).toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(formatted).toContain(":00 UTC");
    });
  });
});
