import { describe, test, expect } from "vitest";
import { SatelliteProperties } from "../modules/SatelliteProperties.js";

describe("SatelliteProperties.computeVisibilityRadius", () => {
  test("ISS at 400 km with 10° min elevation", () => {
    const radius = SatelliteProperties.computeVisibilityRadius(400, 10);
    expect(radius).toBeCloseTo(1344, -1);
  });

  test("ISS at 400 km with 0° (horizon) elevation", () => {
    const radius = SatelliteProperties.computeVisibilityRadius(400, 0);
    expect(radius).toBeCloseTo(2201, -1);
  });

  test("Iridium at 780 km with 10° min elevation", () => {
    const radius = SatelliteProperties.computeVisibilityRadius(780, 10);
    expect(radius).toBeCloseTo(2076, -1);
  });

  test("Very low satellite at 100 km with 80° min elevation", () => {
    const radius = SatelliteProperties.computeVisibilityRadius(100, 80);
    expect(radius).toBeCloseTo(17, 0);
  });

  test("Impossible geometry returns 0", () => {
    const radius = SatelliteProperties.computeVisibilityRadius(100, 90);
    expect(radius).toBe(0);
  });

  test("Zero elevation at 400 km", () => {
    const radius = SatelliteProperties.computeVisibilityRadius(400, 0);
    expect(radius).toBeCloseTo(2201, -1);
  });

  test("Higher altitude gives larger radius", () => {
    const low = SatelliteProperties.computeVisibilityRadius(400, 10);
    const high = SatelliteProperties.computeVisibilityRadius(800, 10);
    expect(high).toBeGreaterThan(low);
  });

  test("Higher min elevation gives smaller radius", () => {
    const lowElev = SatelliteProperties.computeVisibilityRadius(400, 5);
    const highElev = SatelliteProperties.computeVisibilityRadius(400, 20);
    expect(highElev).toBeLessThan(lowElev);
  });
});
