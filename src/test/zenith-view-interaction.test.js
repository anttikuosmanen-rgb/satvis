import { SMART_PATH_LABELS, formatZenithTooltip, formatSunTooltip, azimuthDiff, azimuthInRange } from "../modules/util/zenithViewHelper";
import { GroundStationConditions } from "../modules/util/GroundStationConditions";
import { MUNICH_GS } from "./fixtures/tle-data";

describe("SMART_PATH_LABELS", () => {
  it("state 0 is null (below horizon)", () => expect(SMART_PATH_LABELS[0]).toBeNull());
  it("states 1 and 3 are 'in shadow'", () => {
    expect(SMART_PATH_LABELS[1]).toBe("Satellite in shadow");
    expect(SMART_PATH_LABELS[3]).toBe("Satellite in shadow");
  });
  it("states 2 and 4 are 'sunlit'", () => {
    expect(SMART_PATH_LABELS[2]).toBe("Satellite sunlit");
    expect(SMART_PATH_LABELS[4]).toBe("Satellite sunlit");
  });
  it("does not contain 'eclipsed'", () => {
    SMART_PATH_LABELS.forEach((l) => {
      if (l) expect(l).not.toContain("eclipsed");
    });
  });
});

describe("formatZenithTooltip", () => {
  it("two-line format without state", () => {
    const text = formatZenithTooltip(45.2, 270.0, undefined);
    expect(text).toBe("Alt: 45.2°\nAz: 270.0°");
  });
  it("three-line format with sunlit state", () => {
    const text = formatZenithTooltip(45.2, 270.0, 2);
    expect(text).toBe("Alt: 45.2°\nAz: 270.0°\nSatellite sunlit");
  });
  it("three-line format with in-shadow state", () => {
    const text = formatZenithTooltip(12.3, 90.0, 1);
    expect(text).toBe("Alt: 12.3°\nAz: 90.0°\nSatellite in shadow");
  });
  it("two-line format for state 0 (below horizon — no third line)", () => {
    const text = formatZenithTooltip(-5.0, 180.0, 0);
    expect(text).toBe("Alt: -5.0°\nAz: 180.0°");
  });
  it("rounds values to 1 decimal", () => {
    const text = formatZenithTooltip(45.123, 270.456, undefined);
    expect(text).toContain("Alt: 45.1°");
    expect(text).toContain("Az: 270.5°");
  });
});

describe("formatSunTooltip", () => {
  it("two-line Alt/Az format", () => {
    expect(formatSunTooltip(-5.3, 270.0)).toBe("Alt: -5.3°\nAz: 270.0°");
  });
});

describe("azimuthDiff", () => {
  it("returns 0 for identical azimuths", () => {
    expect(azimuthDiff(90, 90)).toBe(0);
  });
  it("returns positive for clockwise difference", () => {
    expect(azimuthDiff(100, 90)).toBe(10);
  });
  it("returns negative for counter-clockwise difference", () => {
    expect(azimuthDiff(90, 100)).toBe(-10);
  });
  it("handles wraparound across 0°/360°", () => {
    expect(azimuthDiff(10, 350)).toBe(20);
    expect(azimuthDiff(350, 10)).toBe(-20);
  });
  it("returns ±180 for opposite azimuths", () => {
    expect(Math.abs(azimuthDiff(270, 90))).toBe(180);
  });
  it("handles large values", () => {
    expect(azimuthDiff(720, 0)).toBe(0);
  });
});

describe("azimuthInRange", () => {
  it("returns true when az is between leftAz and rightAz", () => {
    expect(azimuthInRange(180, 90, 270)).toBe(true);
  });
  it("returns false when az is outside the arc", () => {
    expect(azimuthInRange(0, 90, 270)).toBe(false);
  });
  it("handles wraparound: arc from 350° to 10° (crossing north)", () => {
    expect(azimuthInRange(0, 350, 10)).toBe(true);
    expect(azimuthInRange(355, 350, 10)).toBe(true);
    expect(azimuthInRange(5, 350, 10)).toBe(true);
    expect(azimuthInRange(180, 350, 10)).toBe(false);
  });
  it("returns true on exact boundaries", () => {
    expect(azimuthInRange(90, 90, 270)).toBe(true);
    expect(azimuthInRange(270, 90, 270)).toBe(true);
  });
  it("full circle: leftAz === rightAz includes only that point", () => {
    expect(azimuthInRange(90, 90, 90)).toBe(true);
  });
});

describe("GroundStationConditions — sun azimuth is north-based 0–360", () => {
  // Known: Munich, June 21 at 06:00 UTC — sun is roughly east (azimuth 60-120°)
  it("morning sun has easterly azimuth (~60-150°)", () => {
    const pos = GroundStationConditions.getSunPosition(MUNICH_GS, new Date("2024-06-21T06:00:00Z"));
    expect(pos.azimuth).toBeGreaterThanOrEqual(60);
    expect(pos.azimuth).toBeLessThan(150);
  });
  // Known: Munich, June 21 at 18:00 UTC — sun is roughly west (azimuth 240-320°)
  it("evening sun has westerly azimuth (~240-320°)", () => {
    const pos = GroundStationConditions.getSunPosition(MUNICH_GS, new Date("2024-06-21T18:00:00Z"));
    expect(pos.azimuth).toBeGreaterThan(240);
    expect(pos.azimuth).toBeLessThan(320);
  });
  it("azimuth is always 0–360", () => {
    const times = ["06:00", "12:00", "18:00", "00:00"].map((t) => new Date(`2024-06-21T${t}:00Z`));
    times.forEach((t) => {
      const pos = GroundStationConditions.getSunPosition(MUNICH_GS, t);
      expect(pos.azimuth).toBeGreaterThanOrEqual(0);
      expect(pos.azimuth).toBeLessThan(360);
    });
  });
});
