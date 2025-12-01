import { describe, test, expect, beforeEach, vi } from "vitest";
import { filterAndSortPasses } from "../modules/util/PassFilter.js";
import { setActivePinia, createPinia } from "pinia";

// Mock the sat store
vi.mock("../stores/sat", () => ({
  useSatStore: vi.fn(() => ({
    hideSunlightPasses: false,
    showOnlyLitPasses: false,
  })),
}));

describe("PassFilter", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    // Reset store mock to default values
    const { useSatStore } = await import("../stores/sat");
    useSatStore.mockReturnValue({
      hideSunlightPasses: false,
      showOnlyLitPasses: false,
    });
  });

  describe("filterAndSortPasses", () => {
    test("filters passes within default deltaHours (48h)", () => {
      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [
        { start: new Date("2025-01-15T14:00:00Z") }, // +2h - INCLUDE
        { start: new Date("2025-01-16T12:00:00Z") }, // +24h - INCLUDE
        { start: new Date("2025-01-17T12:00:00Z") }, // +48h - EXCLUDE
        { start: new Date("2025-01-18T12:00:00Z") }, // +72h - EXCLUDE
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T14:00:00Z"));
      expect(filtered[1].start).toEqual(new Date("2025-01-16T12:00:00Z"));
    });

    test("filters passes with custom deltaHours", () => {
      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [
        { start: new Date("2025-01-15T14:00:00Z") }, // +2h - INCLUDE
        { start: new Date("2025-01-15T23:00:00Z") }, // +11h - INCLUDE
        { start: new Date("2025-01-15T23:30:00Z") }, // +11.5h - INCLUDE
        { start: new Date("2025-01-16T01:00:00Z") }, // +13h - EXCLUDE
      ];

      const filtered = filterAndSortPasses(passes, currentTime, 12);

      expect(filtered).toHaveLength(3);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T14:00:00Z"));
      expect(filtered[2].start).toEqual(new Date("2025-01-15T23:30:00Z"));
    });

    test("excludes passes in the past", () => {
      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [
        { start: new Date("2025-01-15T11:00:00Z") }, // -1h - EXCLUDE
        { start: new Date("2025-01-15T12:00:00Z") }, // 0h - INCLUDE (hoursDiff >= 0)
        { start: new Date("2025-01-15T12:01:00Z") }, // +1min - INCLUDE
        { start: new Date("2025-01-15T14:00:00Z") }, // +2h - INCLUDE
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(3);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T12:00:00Z"));
      expect(filtered[1].start).toEqual(new Date("2025-01-15T12:01:00Z"));
    });

    test("filters passes before epoch-90min for future epoch satellites", () => {
      const currentTime = new Date("2025-01-15T12:00:00Z");
      const epochTime = new Date("2025-01-15T16:00:00Z"); // Epoch at 16:00
      const epochMinus90 = new Date("2025-01-15T14:30:00Z"); // Epoch - 90min = 14:30

      const passes = [
        {
          start: new Date("2025-01-15T14:00:00Z"), // Before epoch-90min - EXCLUDE
          epochInFuture: true,
          epochTime,
        },
        {
          start: new Date("2025-01-15T14:30:00Z"), // Exactly at epoch-90min - INCLUDE
          epochInFuture: true,
          epochTime,
        },
        {
          start: new Date("2025-01-15T15:00:00Z"), // After epoch-90min - INCLUDE
          epochInFuture: true,
          epochTime,
        },
        {
          start: new Date("2025-01-15T13:00:00Z"), // No epochInFuture flag - INCLUDE
          epochInFuture: false,
        },
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(3);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T13:00:00Z"));
      expect(filtered[1].start).toEqual(new Date("2025-01-15T14:30:00Z"));
      expect(filtered[2].start).toEqual(new Date("2025-01-15T15:00:00Z"));
    });

    test("hides sunlight passes when hideSunlightPasses is enabled", async () => {
      const { useSatStore } = await import("../stores/sat");
      useSatStore.mockReturnValue({
        hideSunlightPasses: true,
        showOnlyLitPasses: false,
      });

      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [
        {
          start: new Date("2025-01-15T14:00:00Z"),
          groundStationDarkAtStart: true,
          groundStationDarkAtEnd: false,
        }, // INCLUDE (dark at start)
        {
          start: new Date("2025-01-15T15:00:00Z"),
          groundStationDarkAtStart: false,
          groundStationDarkAtEnd: true,
        }, // INCLUDE (dark at end)
        {
          start: new Date("2025-01-15T16:00:00Z"),
          groundStationDarkAtStart: false,
          groundStationDarkAtEnd: false,
        }, // EXCLUDE (sunlight at both)
        {
          start: new Date("2025-01-15T17:00:00Z"),
          groundStationDarkAtStart: true,
          groundStationDarkAtEnd: true,
        }, // INCLUDE (dark at both)
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(3);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T14:00:00Z"));
      expect(filtered[1].start).toEqual(new Date("2025-01-15T15:00:00Z"));
      expect(filtered[2].start).toEqual(new Date("2025-01-15T17:00:00Z"));
    });

    test("shows only lit passes when showOnlyLitPasses is enabled", async () => {
      const { useSatStore } = await import("../stores/sat");
      useSatStore.mockReturnValue({
        hideSunlightPasses: false,
        showOnlyLitPasses: true,
      });

      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [
        {
          start: new Date("2025-01-15T14:00:00Z"),
          satelliteEclipsedAtStart: false,
          satelliteEclipsedAtEnd: true,
        }, // INCLUDE (lit at start)
        {
          start: new Date("2025-01-15T15:00:00Z"),
          satelliteEclipsedAtStart: true,
          satelliteEclipsedAtEnd: false,
        }, // INCLUDE (lit at end)
        {
          start: new Date("2025-01-15T16:00:00Z"),
          satelliteEclipsedAtStart: true,
          satelliteEclipsedAtEnd: true,
          eclipseTransitions: [],
        }, // EXCLUDE (eclipsed entire pass, no transitions)
        {
          start: new Date("2025-01-15T17:00:00Z"),
          satelliteEclipsedAtStart: true,
          satelliteEclipsedAtEnd: true,
          eclipseTransitions: [{ time: new Date("2025-01-15T17:05:00Z") }],
        }, // INCLUDE (has eclipse transition)
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(3);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T14:00:00Z"));
      expect(filtered[1].start).toEqual(new Date("2025-01-15T15:00:00Z"));
      expect(filtered[2].start).toEqual(new Date("2025-01-15T17:00:00Z"));
    });

    test("sorts passes by start time chronologically", () => {
      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [
        { start: new Date("2025-01-15T18:00:00Z") }, // +6h
        { start: new Date("2025-01-15T14:00:00Z") }, // +2h
        { start: new Date("2025-01-15T20:00:00Z") }, // +8h
        { start: new Date("2025-01-15T16:00:00Z") }, // +4h
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(4);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T14:00:00Z"));
      expect(filtered[1].start).toEqual(new Date("2025-01-15T16:00:00Z"));
      expect(filtered[2].start).toEqual(new Date("2025-01-15T18:00:00Z"));
      expect(filtered[3].start).toEqual(new Date("2025-01-15T20:00:00Z"));
    });

    test("handles empty pass array", () => {
      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(0);
      expect(Array.isArray(filtered)).toBe(true);
    });

    test("handles passes exactly at deltaHours boundary", () => {
      const currentTime = new Date("2025-01-15T12:00:00Z");
      const passes = [
        { start: new Date("2025-01-17T11:59:59Z") }, // Just under 48h - INCLUDE
        { start: new Date("2025-01-17T12:00:00Z") }, // Exactly 48h - EXCLUDE
        { start: new Date("2025-01-17T12:00:01Z") }, // Just over 48h - EXCLUDE
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].start).toEqual(new Date("2025-01-17T11:59:59Z"));
    });

    test("applies combined filters correctly", async () => {
      const { useSatStore } = await import("../stores/sat");
      useSatStore.mockReturnValue({
        hideSunlightPasses: true,
        showOnlyLitPasses: true,
      });

      const currentTime = new Date("2025-01-15T12:00:00Z");
      const epochTime = new Date("2025-01-15T16:00:00Z");

      const passes = [
        {
          start: new Date("2025-01-15T15:00:00Z"), // +3h
          groundStationDarkAtStart: true,
          groundStationDarkAtEnd: false,
          satelliteEclipsedAtStart: false,
          satelliteEclipsedAtEnd: false,
          epochInFuture: true,
          epochTime,
        }, // INCLUDE (after epoch-90min, dark at GS, sat lit)
        {
          start: new Date("2025-01-15T17:00:00Z"), // +5h
          groundStationDarkAtStart: false,
          groundStationDarkAtEnd: false,
          satelliteEclipsedAtStart: false,
          satelliteEclipsedAtEnd: false,
        }, // EXCLUDE (sunlight at GS)
        {
          start: new Date("2025-01-15T19:00:00Z"), // +7h
          groundStationDarkAtStart: true,
          groundStationDarkAtEnd: true,
          satelliteEclipsedAtStart: true,
          satelliteEclipsedAtEnd: true,
          eclipseTransitions: [],
        }, // EXCLUDE (sat eclipsed entire pass)
      ];

      const filtered = filterAndSortPasses(passes, currentTime);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].start).toEqual(new Date("2025-01-15T15:00:00Z"));
    });
  });
});
